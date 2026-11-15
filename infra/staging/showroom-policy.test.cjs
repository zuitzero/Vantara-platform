const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { configuration, target, admits, MARKER, HEADER } = require('./showroom-policy.cjs');
const { renderShowroom } = require('./showroom-gateway.cjs');
const example = require('./staging.example.json');

const key = randomBytes(32).toString('base64url');
const environment = {
  NODE_ENV: 'production', VANTARA_ENV: 'staging', WEB_ORIGIN: example.publicOrigin,
  SHOWROOM_MODE: 'cloud-05a', SHOWROOM_DATA_MARKER: MARKER, SHOWROOM_INGRESS_KEY: key,
};

test('Showroom requires explicit complete isolated settings and preserves ordinary startup', () => {
  assert.equal(configuration({ NODE_ENV: 'production', VANTARA_ENV: 'staging' }), null);
  assert.equal(configuration({ NODE_ENV: 'development', PILOT01_DEMO: 'synthetic-local-only' }), null);
  for (const patch of [
    { SHOWROOM_MODE: undefined }, { SHOWROOM_MODE: '' }, { SHOWROOM_DATA_MARKER: 'other' },
    { SHOWROOM_INGRESS_KEY: undefined }, { SHOWROOM_INGRESS_KEY: 'short' }, { NODE_ENV: 'test' },
    { VANTARA_ENV: 'local' }, { WEB_ORIGIN: 'https://unapproved.example.com' },
    { ALLOW_LOCAL_WORKSPACE_SIGNUP: 'true' }, { CONNECT_GUEST_HTTP: '1' },
    { PILOT01_DEMO: 'synthetic-local-only' }, { STRIPE_SECRET_KEY: 'synthetic' },
  ]) assert.throws(() => configuration({ ...environment, ...patch }), /^Error: SHOWROOM_CONFIGURATION_REJECTED$/);
  assert.equal(configuration(environment).origin, example.publicOrigin);
});

test('canonical route and proof checks reject direct requests and aliases', () => {
  const config = configuration(environment);
  const request = { url: '/api/health', method: 'GET', headers: { host: config.host } };
  assert.equal(admits(config, request, 'api'), false);
  request.headers['x-forwarded-proto'] = 'https';
  assert.equal(admits(config, request, 'api'), false);
  request.headers[HEADER] = key;
  assert.equal(admits(config, request, 'api'), true);
  assert.equal(admits(config, request, 'web'), false);
  for (const url of [
    '/api//health', '/api/health/', '/api/health?', '/api/%68ealth', '/api/%2568ealth',
    '/api/a/../health', '/api\\health', 'https://' + config.host + '/api/health',
    '/_next/static/build/chunk.js.map', '/api/other', '/connect/bearer',
    '/socket.io/?EIO=4&transport=websocket&sid=canary',
  ]) assert.equal(target('GET', url), undefined);
  assert.equal(target('POST', '/api/health'), undefined);
  assert.equal(target('GET', '/_next/static/chunks/chunk.js'), 'web');
  assert.equal(target('GET', '/socket.io/?EIO=4&transport=websocket'), 'socket');
  assert.equal(admits(config, { ...request, headers: { ...request.headers, host: 'foreign.invalid' } }, 'api'), false);
});

test('gateway renderer emits the raw request allowlist and requires the private include', () => {
  const nginx = renderShowroom(example);
  assert.ok(nginx.includes('map "$request_method:$request_uri" $showroom_target'));
  assert.ok(nginx.includes('default deny'));
  assert.ok(nginx.includes('include showroom-ingress.inc;'));
  assert.ok(!nginx.includes(key) && !nginx.includes(MARKER));
});

test('real Nginx validates the generated Showroom config with inert loopback upstreams', {
  skip: process.env.STAGING_NGINX_TEST !== '1',
}, () => {
  const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'showroom-nginx-config-'));
  try {
    const config = renderShowroom(example)
      .replace('error_log /dev/null crit;', 'error_log stderr notice;')
      .replaceAll('listen 8080', 'listen 127.0.0.1:38080')
      .replaceAll(example.webUpstream, 'http://127.0.0.1:3000')
      .replaceAll(example.apiUpstream, 'http://127.0.0.1:3001');
    writeFileSync(join(dir, 'nginx.conf'), config);
    writeFileSync(join(dir, 'showroom-ingress.inc'), 'proxy_set_header X-Vantara-Showroom-Ingress syntax-test;\n');
    const result = spawnSync(process.env.NGINX_BIN || 'nginx',
      ['-p', dir + '/', '-c', 'nginx.conf', '-t'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr?.replaceAll(dir, '<fixture-dir>'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
