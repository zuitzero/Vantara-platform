const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { OperatorCandidate, fingerprint } = require('./operator-candidate.cjs');
const { MARKER } = require('../showroom-policy.cjs');
function setup() {
  const keys = generateKeyPairSync('ed25519'); let now = Date.now();
  const actors = new Map(['issuer', 'recipient', 'foreign'].map(userId => [userId, { userId,
    tenantId: userId === 'foreign' ? 'B' : 'A', tenantType: 'HOTEL', role: 'HOTEL_STAFF', recipientVerified: true,
    email: userId + '@operator.example.invalid', permissions: userId === 'issuer' ? ['showroom.operator.invite'] : [] }]));
  const config = { mode: 'synthetic-candidate', marker: MARKER, publicKey: keys.publicKey,
    issuer: actors.get('issuer'), resolveSession: async token => actors.get(token), clock: () => now };
  const candidate = new OperatorCandidate(config);
  async function proof(session, action, overrides = {}) {
    const actor = actors.get(session); const nonce = await candidate.challenge(session, action);
    const value = { nonce, issuer: 'synthetic-mfa', audience: 'vantara-showroom-operator', amr: 'mfa', authTime: now, ...overrides };
    const payload = Buffer.from(JSON.stringify({ nonce, action, sessionHash: fingerprint(session), userId: actor.userId,
      tenantId: actor.tenantId, issuer: value.issuer, audience: value.audience, amr: value.amr, authTime: value.authTime }));
    return { ...value, signature: sign(null, payload, keys.privateKey).toString('base64url') };
  }
  const target = { userId: 'recipient', tenantId: 'A', email: 'recipient@operator.example.invalid' };
  const invite = async () => candidate.invite('issuer', await proof('issuer', 'invite'), target);
  return { candidate, actors, proof, invite, target, config, advance: ms => { now += ms; } };
}
test('OP01 candidate requires independent explicit gate and synthetic identity', async () => {
  const f = setup();
  for (const change of [{ mode: 'live' }, { marker: '' }, { publicKey: null }]) assert.throws(() => new OperatorCandidate({ ...f.config, ...change }), /DENIED/);
  f.actors.get('recipient').email = 'real@example.com';
  await assert.rejects(f.candidate.challenge('recipient', 'accept'), /DENIED/);
});
test('OP02 named MFA issuer invites verified existing recipient; only dedicated grant', async () => {
  const f = setup(), invitation = await f.invite();
  assert.equal(await f.candidate.authorized('recipient'), false);
  const result = await f.candidate.accept('recipient', await f.proof('recipient', 'accept'), invitation.code);
  assert.equal(result.permission, 'connect.showroom.invite'); assert.equal(result.role, 'HOTEL_STAFF');
  assert.equal(await f.candidate.authorized('recipient'), true);
  assert.equal(await f.candidate.authorized('foreign'), false);
  f.candidate.close(); assert.equal(await f.candidate.authorized('recipient'), false);
});
test('OP03 invitation replay, step-up replay and cross-tenant consumption denied', async () => {
  const f = setup(), invitation = await f.invite();
  await assert.rejects(f.candidate.accept('foreign', await f.proof('foreign', 'accept'), invitation.code), /DENIED/);
  const proof = await f.proof('recipient', 'accept');
  await f.candidate.accept('recipient', proof, invitation.code);
  await assert.rejects(f.candidate.accept('recipient', proof, invitation.code), /DENIED/);
  await assert.rejects(f.candidate.accept('recipient', await f.proof('recipient', 'accept'), invitation.code), /DENIED/);
});
test('OP04 invalid MFA, stale auth, audience and future auth are denied', async () => {
  for (const overrides of [{ amr: 'pwd' }, { audience: 'other' }, { issuer: 'other' }, { authTime: 0 }, { authTime: Number.MAX_SAFE_INTEGER }]) {
    const f = setup(); await assert.rejects(f.candidate.invite('issuer', await f.proof('issuer', 'invite', overrides), f.target), /DENIED/);
  }
  const f = setup(), proof = await f.proof('issuer', 'invite'); proof.signature = 'invalid';
  await assert.rejects(f.candidate.invite('issuer', proof, f.target), /DENIED/);
});
test('OP05 no self elevation, role injection or client-selected foreign tenant', async () => {
  const f = setup();
  await assert.rejects(f.candidate.invite('recipient', await f.proof('recipient', 'invite'), f.target), /DENIED/);
  for (const change of [{ role: 'OWNER' }, { tenantId: 'B' }]) await assert.rejects(f.candidate.invite('issuer', await f.proof('issuer', 'invite'), { ...f.target, ...change }), /DENIED/);
});
test('OP06 expiry, revoke and session disconnect remove candidate access', async () => {
  const f = setup(), first = await f.invite(); f.advance(300001);
  await assert.rejects(f.candidate.accept('recipient', await f.proof('recipient', 'accept'), first.code), /DENIED/);
  const second = await f.invite(); await f.candidate.accept('recipient', await f.proof('recipient', 'accept'), second.code);
  await f.candidate.revoke('issuer', await f.proof('issuer', 'revoke'), second.code);
  assert.equal(await f.candidate.authorized('recipient'), false);
  const third = await f.invite(); await f.candidate.accept('recipient', await f.proof('recipient', 'accept'), third.code);
  f.actors.delete('recipient'); assert.equal(await f.candidate.authorized('recipient'), false);
});
test('OP07 membership changes between challenge and consumption fail closed', async () => {
  const f = setup(), invitation = await f.invite(), proof = await f.proof('recipient', 'accept');
  f.actors.get('recipient').role = 'HOTEL_ADMIN';
  await assert.rejects(f.candidate.accept('recipient', proof, invitation.code), /DENIED/);
});
