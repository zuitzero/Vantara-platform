const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { render } = require('./config.cjs');
const example = require('./staging.example.json');

test('real Nginx: routing, upgrade, deny rules, rate/body limits and capability-free access logs', { skip: process.env.STAGING_NGINX_TEST !== '1', timeout: 20000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vantara-staging-'));
  const calls = []; let nginx;
  const backend = label => http.createServer((req, res) => {
    calls.push({ label, url: req.url, headers: req.headers });
    req.resume(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ label, url: req.url }));
  });
  const web = backend('web'), api = backend('api');
  api.on('upgrade', (req, socket) => {
    calls.push({ label: 'upgrade', url: req.url, headers: req.headers });
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  });
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  const close = server => new Promise(resolve => server.close(resolve));
  try {
    const webPort = await listen(web), apiPort = await listen(api);
    const probe = http.createServer(); const port = await listen(probe); await close(probe);
    // Only the test substitutes loopback listeners/upstreams. The reviewed template has private DNS.
    const config = render(example).replaceAll('listen 8080', `listen 127.0.0.1:${port}`)
      .replaceAll(example.webUpstream, `http://127.0.0.1:${webPort}`)
      .replaceAll(example.apiUpstream, `http://127.0.0.1:${apiPort}`);
    await fs.writeFile(path.join(dir, 'nginx.conf'), config);
    nginx = spawn(process.env.NGINX_BIN || 'nginx', ['-p', dir + '/', '-c', 'nginx.conf', '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let startupError = ''; nginx.stderr.on('data', chunk => { startupError += chunk; });
    const request = (url, options = {}) => new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method: options.method || 'GET', headers: { Host: new URL(example.publicOrigin).host, ...options.headers } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
      });
      req.on('error', reject); req.end(options.body);
    });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (nginx.exitCode !== null) throw new Error('NGINX_START_FAILED');
      try { await request('/'); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 30)); }
    }
    assert.equal(ready, true, 'Nginx became ready without publishing any external port');
    assert.equal(startupError, '');
    const token = 'synthetic-capability-canary-012345';
    const secret = 'synthetic-header-body-canary';
    const headers = { Cookie: `vantara_session=${secret}`, Authorization: `Bearer ${secret}`, Referer: `https://example.invalid/${token}`, 'User-Agent': secret, Origin: example.publicOrigin, 'X-Forwarded-For': secret };
    const response = await request(`/api/connect/${token}?private=${secret}`, { headers });
    assert.equal(JSON.parse(response.body).label, 'api');
    assert.equal(JSON.parse(response.body).url, `/api/connect/${token}?private=${secret}`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(JSON.parse((await request(`/connect/${token}`)).body).label, 'web');
    await request(`/api/connect/${token}%2Fencoded`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: secret });
    const before = calls.length;
    for (const url of ['/api/onboarding/workspace', '/api/onboarding/workspace/', '/api/onboarding/%77orkspace', '/api/billing/webhooks/stripe']) assert.equal((await request(url, { method: 'POST' })).status, 403);
    assert.equal(calls.length, before);
    const admitted = calls.find(c => c.url.includes('?private='));
    assert.equal(admitted.headers.cookie, headers.Cookie);
    assert.equal(admitted.headers.origin, example.publicOrigin);
    assert.equal(admitted.headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(admitted.headers['x-forwarded-proto'], 'https');
    const upgradeStatus = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/socket.io/?EIO=4&transport=websocket', headers: { ...headers, Host: new URL(example.publicOrigin).host, Connection: 'Upgrade', Upgrade: 'websocket' } });
      req.on('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
      req.on('response', res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end();
    });
    assert.equal(upgradeStatus, 101);
    const upgraded = calls.find(c => c.label === 'upgrade');
    assert.equal(upgraded.url, '/socket.io/?EIO=4&transport=websocket');
    assert.equal(upgraded.headers.upgrade, 'websocket'); assert.equal(upgraded.headers.cookie, headers.Cookie);
    assert.equal((await request('/api/requests', { method: 'POST', body: 'x'.repeat(17000) })).status, 413);
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await request('/api/auth/login', { method: 'POST', headers: { 'X-Forwarded-For': `198.51.100.${i}` } })).status);
    assert.ok(statuses.includes(429), 'burst receives 429 even with spoofed client forwarding');
    await assert.rejects(request('/api/health', { headers: { Host: 'unapproved.example.invalid' } }));
    nginx.kill('SIGQUIT'); await once(nginx, 'exit'); nginx = null;
    const logs = await fs.readFile(path.join(dir, 'access.log'), 'utf8');
    assert.ok(logs.includes('connect-api')); assert.ok(logs.includes('socket')); assert.ok(logs.includes('429'));
    assert.ok(!logs.includes(token)); assert.ok(!logs.includes(secret)); assert.ok(!logs.includes('encoded'));
    assert.ok(!startupError.includes(token)); assert.ok(!startupError.includes(secret));
    for (const line of logs.trim().split('\n')) assert.deepEqual(Object.keys(JSON.parse(line)).sort(), ['route', 'status']);
  } finally {
    if (nginx && nginx.exitCode === null) { nginx.kill('SIGTERM'); await once(nginx, 'exit'); }
    await close(web); await close(api); await fs.rm(dir, { recursive: true, force: true });
  }
});
