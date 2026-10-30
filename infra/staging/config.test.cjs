const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validate, render } = require('./config.cjs');
const example = require('./staging.example.json');
test('offline synthetic-only contract renders exact prefix-preserving HTTP and upgrade routes', () => {
  const text = render(example);
  assert.match(text, /location \/api\//); assert.match(text, /location \/socket.io\//);
  assert.match(text, /proxy_set_header Upgrade \$http_upgrade/);
  assert.match(text, /proxy_pass http:\/\/api.staging.internal:3001;/);
  assert.ok(!text.includes('/api/realtime')); assert.ok(!text.includes('@@'));
});
test('rejects production, local, secret-bearing, signup-enabled or drifted configs without echoing inputs', () => {
  const bad = [c => c.phase = 'B', c => c.dataMode = 'real', c => c.publicOrigin = 'https://real-hotel.com', c => c.apiUpstream = 'http://localhost:3001', c => c.apiUpstream = 'http://user:secret@api.staging.internal:3001', c => c.apiEnvironment.ALLOW_LOCAL_WORKSPACE_SIGNUP = 'true', c => c.apiEnvironment.WEB_ORIGIN = 'https://other.example.invalid', c => c.apiEnvironment.STRIPE_SECRET_KEY = 'synthetic-secret', c => c.database.tls = 'disable', c => c.database.runtimeRole = c.database.migrationRole, c => c.database.name = 'vantara_pilot01', c => c.database.DATABASE_URL = 'synthetic-secret', c => c.webEnvironment.NEXT_PUBLIC_API_URL = 'https://other.example.invalid/api'];
  for (const mutate of bad) { const c = structuredClone(example); mutate(c); assert.throws(() => validate(c), { message: 'STAGING_CONFIGURATION_REJECTED' }); }
});
