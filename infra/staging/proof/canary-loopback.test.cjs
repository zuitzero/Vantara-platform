const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer, request } = require('node:http');
const { once } = require('node:events');
const { collect, matrix, sinks } = require('./canary.cjs');
const { target } = require('../showroom-policy.cjs');

test('HTTP14 actual disposable first parser omits canaries from seven local sinks', async () => {
  const logs = new Map(sinks.map(sink => [sink, ['SYNTHETIC_SAFE_CONTROL']]));
  const allowedIds = new Set(matrix().cases.map(row => row.id));
  const observedCases = []; let responseCanary, loginAttempts = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      // Fixture receiver owns its seven local diagnostic/export/support views.
      // No raw path, header, body, Set-Cookie or response is ever copied there.
      const id = allowedIds.has(req.headers['x-case']) ? req.headers['x-case'] : 'UNCLASSIFIED';
      let status = 404;
      if (req.headers.host === 'synthetic.example.invalid' && target(req.method, req.url, true) === 'api') {
        if (req.url === '/api/health') status = 200;
        if (req.url === '/api/auth/login') status = ++loginAttempts > 2 ? 429 : 401;
        if (req.url === '/api/guest-connect/session') { try { JSON.parse(body); status = 401; } catch { status = 400; } }
        if (req.url === '/api/showroom-admission/issue') status = 201;
      }
      observedCases.push(id);
      for (const lines of logs.values()) lines.push(id + ' ' + status);
      res.statusCode = status;
      res.setHeader('cache-control', 'no-store');
      if (status === 201) { res.setHeader('set-cookie', 'synthetic=' + responseCanary + '; Secure; HttpOnly'); res.end(responseCanary); }
      else res.end('constant');
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  function send(row) {
    return new Promise((done, fail) => {
      const req = request({ host: '127.0.0.1', port, method: row.method, path: row.path,
        headers: { host: 'synthetic.example.invalid', 'x-case': row.id, ...row.headers } }, res => {
        let body = ''; res.setEncoding('utf8').on('data', chunk => { body += chunk; });
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', error => fail(new Error('LOOPBACK_REQUEST_' + (/^[A-Z0-9_]+$/.test(error.code) ? error.code : 'FAILED'))));
      req.setTimeout(3000, () => req.destroy()); req.end(row.body);
    });
  }
  try {
    const health = await send({ id: 'HTTP01_APPROVED', method: 'GET', path: '/api/health', headers: {}, body: '' });
    assert.equal(health.status, 200);
    const evidence = await collect({ boundary: 'disposable-loopback-first-receiver',
      prePersistenceOmission: async () => true, // Inspectable receiver above, not vendor attestation.
      send: async (row, value) => {
        responseCanary = value;
        if (row.id === 'HTTP11_RATE_LIMIT') { await send(row); await send(row); }
        return send(row);
      },
      readSink: async name => ({ complete: true, observedCases, bytes: logs.get(name).join('\n') }),
    });
    assert.equal(evidence.status, 'PASS', evidence.failedCase); assert.equal(evidence.rows.length, 13);
    assert.equal(evidence.provider.status, 'BLOCKED');
  } finally { await new Promise(done => server.close(done)); }
});
