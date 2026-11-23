// Separately gated reference candidate. No HTTP route, account provisioning,
// production session or membership writes. A real MFA adapter needs founder review.
const { randomBytes, createHash, verify } = require('node:crypto');
const { MARKER } = require('../showroom-policy.cjs');
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const deny = () => { throw new Error('OPERATOR_ADMISSION_DENIED'); };
class OperatorCandidate {
  #invitations = new Map(); #challenges = new Map(); #grants = new Map();
  constructor({ mode, marker, publicKey, resolveSession, issuer, clock = Date.now }) {
    if (mode !== 'synthetic-candidate' || marker !== MARKER || publicKey?.asymmetricKeyType !== 'ed25519' ||
        typeof resolveSession !== 'function' || !issuer?.userId || !issuer?.tenantId) deny();
    this.key = publicKey; this.resolve = resolveSession; this.issuer = Object.freeze({ ...issuer }); this.clock = clock;
  }
  async challenge(session, action) {
    if (!['invite', 'accept', 'revoke'].includes(action) || this.#challenges.size >= 100) deny();
    const actor = await this.resolve(session);
    if (!actor || actor.role !== 'HOTEL_STAFF' || actor.tenantType !== 'HOTEL' ||
        !actor.recipientVerified || !/^[^@\s]+@operator\.example\.invalid$/.test(actor.email)) deny();
    const nonce = randomBytes(32).toString('base64url');
    this.#challenges.set(nonce, { actor: { ...actor }, session: fingerprint(session), action, expiresAt: this.clock() + 60000 });
    return nonce;
  }
  async #step(session, action, proof) {
    if (!proof || typeof proof.nonce !== 'string') deny();
    const row = this.#challenges.get(proof.nonce);
    this.#challenges.delete(proof.nonce); // Failed attempts also consume the challenge.
    const now = this.clock();
    if (!row || row.action !== action || row.session !== fingerprint(session) || row.expiresAt <= now ||
        !Number.isSafeInteger(proof.authTime) || proof.authTime > now || now - proof.authTime > 60000 ||
        proof.issuer !== 'synthetic-mfa' || proof.audience !== 'vantara-showroom-operator' || proof.amr !== 'mfa') deny();
    const actor = await this.resolve(session);
    if (!actor || actor.userId !== row.actor.userId || actor.tenantId !== row.actor.tenantId ||
        actor.role !== 'HOTEL_STAFF' || actor.tenantType !== 'HOTEL' || actor.email !== row.actor.email || !actor.recipientVerified) deny();
    const payload = Buffer.from(JSON.stringify({ nonce: proof.nonce, action, sessionHash: fingerprint(session),
      userId: actor.userId, tenantId: actor.tenantId, issuer: proof.issuer, audience: proof.audience, amr: proof.amr, authTime: proof.authTime }));
    try { if (!verify(null, payload, this.key, Buffer.from(proof.signature, 'base64url'))) deny(); } catch { deny(); }
    return actor;
  }
  #issuer(actor) {
    if (actor.userId !== this.issuer.userId || actor.tenantId !== this.issuer.tenantId ||
        !actor.permissions?.includes('showroom.operator.invite')) deny();
  }
  async invite(session, proof, recipient) {
    const actor = await this.#step(session, 'invite', proof); this.#issuer(actor);
    if (this.#invitations.size >= 100 || !recipient || Object.keys(recipient).sort().join(',') !== 'email,tenantId,userId' ||
        recipient.tenantId !== actor.tenantId || !recipient.userId ||
        !/^[^@\s]+@operator\.example\.invalid$/.test(recipient.email)) deny();
    const code = randomBytes(32).toString('base64url');
    this.#invitations.set(fingerprint(code), { ...recipient, issuer: actor.userId, expiresAt: this.clock() + 300000, state: 'PENDING' });
    return { code, expiresAt: this.clock() + 300000 };
  }
  async accept(session, proof, code) {
    const actor = await this.#step(session, 'accept', proof);
    const row = this.#invitations.get(fingerprint(code));
    if (!row || row.state !== 'PENDING' || row.expiresAt <= this.clock() || row.userId !== actor.userId ||
        row.tenantId !== actor.tenantId || row.email !== actor.email) deny();
    row.state = 'CONSUMED';
    // Only this candidate's grant is created. It cannot mutate real app authority.
    this.#grants.set(actor.userId, { tenantId: actor.tenantId, expiresAt: this.clock() + 900000 });
    return { role: 'HOTEL_STAFF', permission: 'connect.showroom.invite', expiresAt: this.clock() + 900000 };
  }
  async revoke(session, proof, code) {
    const actor = await this.#step(session, 'revoke', proof); this.#issuer(actor);
    const row = this.#invitations.get(fingerprint(code));
    if (!row || row.tenantId !== actor.tenantId) deny();
    row.state = 'REVOKED'; this.#grants.delete(row.userId);
  }
  async authorized(session) {
    const actor = await this.resolve(session); const grant = actor && this.#grants.get(actor.userId);
    return Boolean(actor && actor.role === 'HOTEL_STAFF' && actor.tenantType === 'HOTEL' && actor.recipientVerified &&
      grant && grant.tenantId === actor.tenantId && grant.expiresAt > this.clock());
  }
  // Restart/recovery is fail-closed: no persisted grant can resurrect.
  close() { this.#invitations.clear(); this.#challenges.clear(); this.#grants.clear(); }
}
module.exports = { OperatorCandidate, fingerprint };
