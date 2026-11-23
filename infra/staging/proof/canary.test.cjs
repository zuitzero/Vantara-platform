const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collect, matrix, contains, sinks } = require('./canary.cjs');

function fixture(overrides = {}) {
  const observedCases = [];
  return { boundary: 'disposable-loopback-first-receiver',
    prePersistenceOmission: async () => true,
    send: async (row, value) => {
      observedCases.push(row.id);
      return row.id === 'HTTP13_RESPONSE' ? { status: 201, headers: { 'set-cookie': 'probe=' + value }, body: value }
        : { status: row.statuses[0], headers: {}, body: 'constant' };
    },
    readSink: async () => ({ complete: true, observedCases, bytes: 'SYNTHETIC_SAFE_CONTROL' }), ...overrides };
}
test('HTTP matrix has all 13 fixed cases and independent random synthetic values', () => {
  const first = matrix(), second = matrix();
  assert.equal(first.cases.length, 13); assert.notEqual(first.value, second.value);
  assert.equal(new Set(first.cases.map(row => row.id)).size, 13);
});
test('complete disposable collection cannot promote provider acceptance', async () => {
  const result = await collect(fixture());
  assert.equal(result.status, 'PASS'); assert.equal(result.rows.length, 13);
  assert.equal(result.provider.status, 'BLOCKED'); assert.equal(sinks.length, 7);
});
test('missing first-hop proof stops before any send', async () => {
  let sent = false;
  const result = await collect(fixture({ prePersistenceOmission: async () => false, send: async () => { sent = true; } }));
  assert.equal(result.status, 'BLOCKED'); assert.equal(sent, false);
  assert.equal((await collect({ boundary: 'provider' })).status, 'BLOCKED');
});
test('missing sink, omitted case and unreadable export fail closed', async () => {
  for (const bad of [undefined, { complete: false }, { complete: true, observedCases: [], bytes: 'SYNTHETIC_SAFE_CONTROL' }]) {
    assert.equal((await collect(fixture({ readSink: async () => bad }))).status, 'FAIL');
  }
});
test('sink leakage and response reflection fail with no raw output', async () => {
  let secret;
  const adapter = fixture(); const send = adapter.send;
  adapter.send = async (row, value) => { secret = value; return send(row, value); };
  adapter.readSink = async () => ({ complete: true, observedCases: matrix().cases.map(x => x.id), bytes: 'SYNTHETIC_SAFE_CONTROL ' + secret });
  assert.equal((await collect(adapter)).status, 'FAIL');
  assert.equal((await collect(fixture({ send: async (row, value) => ({ status: row.statuses[0], body: value }) }))).status, 'FAIL');
});
test('encoded leakage is detected; adapter exceptions cannot escape', async () => {
  const value = matrix().value;
  for (const bytes of [value, Buffer.from(value).toString('base64'), [...value].map(c => '%' + c.charCodeAt(0).toString(16)).join('')]) assert.equal(contains(bytes, [value]), true);
  assert.equal(contains('%53' + value.slice(1), [value]), true);
  assert.equal(contains('%2553' + value.slice(1), [value]), true);
  const failure = await collect(fixture({ send: async () => { throw new Error(value); } }));
  assert.equal(failure.status, 'FAIL'); assert.equal(JSON.stringify(failure).includes(value), false);
});
