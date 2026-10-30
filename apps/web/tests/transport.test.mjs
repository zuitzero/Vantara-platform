import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webTransport, realtimeUrl } from '../transport-config.ts';
const cloud = { NODE_ENV: 'production', WEB_ORIGIN: 'https://hotel.example.invalid', API_INTERNAL_URL: 'http://api.internal:3001' };
test('same-origin Cloud API prefix and socket namespace stay separate', () => {
  assert.equal(webTransport(cloud).upstream, 'http://api.internal:3001');
  assert.equal(realtimeUrl(undefined, true, cloud.WEB_ORIGIN), 'https://hotel.example.invalid/realtime');
});
test('Cloud fails closed on missing, loopback, credentials or cross-origin configuration', () => {
  for (const invalid of [{ API_INTERNAL_URL: undefined }, { API_INTERNAL_URL: 'http://localhost:3001' }, { WEB_ORIGIN: 'http://hotel.example.invalid' }, { WEB_ORIGIN: 'https://user:password@hotel.example.invalid' }, { NEXT_PUBLIC_API_URL: 'https://other.example.invalid/api' }, { NEXT_PUBLIC_REALTIME_URL: 'https://other.example.invalid' }]) {
    assert.throws(() => webTransport({ ...cloud, ...invalid }));
  }
  assert.throws(() => realtimeUrl('/api', true, cloud.WEB_ORIGIN));
  assert.throws(() => realtimeUrl('https://other.example.invalid', true, cloud.WEB_ORIGIN));
});
test('explicit local development keeps the API and realtime defaults', () => {
  assert.equal(webTransport({ NODE_ENV: 'development' }).upstream, 'http://localhost:3001');
  assert.equal(realtimeUrl(undefined, false, 'http://localhost:3000'), 'http://localhost:3001/realtime');
});
