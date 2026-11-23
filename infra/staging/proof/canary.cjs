// No network implementation here: callers may supply only a disposable first receiver.
// A future vendor adapter is a separate approval boundary, not a URL flag.
const { randomBytes } = require('node:crypto');
const sinks = Object.freeze(['access', 'error', 'security', 'rate-limit', 'platform', 'export', 'support']);
function matrix() {
  const value = 'SYNTHETIC_' + randomBytes(24).toString('hex');
  const cases = [
    ['HTTP01_APPROVED', 'GET', '/api/health', {}, '', [200]],
    ['HTTP02_PATH', 'GET', '/connect/' + value, {}, '', [400, 404]],
    ['HTTP03_QUERY', 'GET', '/connect?code=' + value, {}, '', [400, 404]],
    ['HTTP04_ENCODED', 'GET', '/%63onnect/%' + value.charCodeAt(0).toString(16) + value.slice(1), {}, '', [400, 404]],
    ['HTTP05_DOUBLE_ENCODED', 'GET', '/%2563onnect/' + value, {}, '', [400, 404]],
    ['HTTP06_MALFORMED', 'GET', '/connect/%ZZ' + value, {}, '', [400, 404]],
    ['HTTP07_INVITATION_BODY', 'POST', '/api/guest-connect/session', { 'content-type': 'application/json' }, JSON.stringify({ code: value }), [400, 401, 403, 404]],
    ['HTTP08_HEADERS', 'GET', '/api/health', { authorization: 'Bearer ' + value, cookie: 'probe=' + value,
      referer: 'https://synthetic.example.invalid/' + value, 'user-agent': value, 'x-probe': value }, '', [200, 400, 404]],
    ['HTTP09_NOT_FOUND', 'GET', '/unknown/' + value, {}, '', [400, 404]],
    ['HTTP10_ERROR', 'POST', '/api/guest-connect/session', { 'content-type': 'application/json' }, '{"code":"' + value, [400, 404]],
    ['HTTP11_RATE_LIMIT', 'POST', '/api/auth/login', { 'content-type': 'application/json' }, JSON.stringify({ email: value, password: value }), [429]],
    ['HTTP12_DEFAULT_HOST', 'GET', '/' + value, { host: 'default.example.invalid' }, '', [0, 400, 404, 421, 444]],
    // Authorized fixture handler must return sensitive output to prove response logging omission.
    ['HTTP13_RESPONSE', 'POST', '/api/showroom-admission/issue', {}, '', [201]],
  ].map(([id, method, path, headers, body, statuses]) => ({ id, method, path, headers, body, statuses }));
  return { value, cases };
}
function contains(bytes, values) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  return values.some(value => [value, encodeURIComponent(value), Buffer.from(value).toString('base64'),
    Buffer.from(value).toString('base64url'), [...value].map(c => '%' + c.charCodeAt(0).toString(16)).join('')]
    .some(variant => text.toLowerCase().includes(variant.toLowerCase())));
}
async function collect(adapter) {
  // All outward errors and evidence are fixed identifiers. Never serialize an adapter exception.
  if (adapter?.boundary !== 'disposable-loopback-first-receiver') return { id: 'HTTP_GATE', status: 'BLOCKED' };
  const { value, cases } = matrix();
  const rows = [];
  try {
    // This preflight MUST precede sending any value, even a synthetic one.
    if (await adapter.prePersistenceOmission() !== true) return { id: 'HTTP_GATE', status: 'BLOCKED' };
    for (const test of cases) {
      const result = await adapter.send(test, value);
      if (!test.statuses.includes(result.status)) throw new Error();
      if (test.id === 'HTTP13_RESPONSE') {
        if (!String(result.headers?.['set-cookie']).includes(value) || !String(result.body).includes(value)) throw new Error();
      } else if (contains(JSON.stringify(result), [value])) throw new Error();
      rows.push({ id: test.id, status: 'PASS' });
    }
    for (const sink of sinks) {
      const result = await adapter.readSink(sink);
      // Empty or inaccessible exports are not evidence. Include a safe positive control.
      if (result?.complete !== true || !Array.isArray(result.observedCases) ||
          !cases.every(test => result.observedCases.includes(test.id)) ||
          !String(result.bytes).includes('SYNTHETIC_SAFE_CONTROL') || contains(result.bytes, [value])) throw new Error();
    }
    return { id: 'HTTP_GATE', status: 'PASS', scope: 'disposable', rows,
      provider: { status: 'BLOCKED', reason: 'INDEPENDENT_PROVIDER_EVIDENCE_REQUIRED' } };
  } catch { return { id: 'HTTP_GATE', status: 'FAIL' }; }
}
module.exports = { matrix, contains, collect, sinks };
