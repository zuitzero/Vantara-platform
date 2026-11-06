import { assertExchangeRequest, assertGuestSession, BootstrapRecord, GUEST_PROTOCOL, GuestExchangeRepository, GuestProtocolDenied, GuestSessionRecord, isFingerprint, parseBootstrapFragment, parseExchangeBody, planExchange, StayAuthority } from './guest-access.contracts';

const now = 1_800_000_000_000;
const hash = (n: number) => n.toString(16).padStart(64, '0');
const code = Buffer.alloc(32, 7).toString('base64url'); // Synthetic syntax fixture, no issued capability.
function authority(): StayAuthority {
  return { tenantType: 'HOTEL', tenantId: 'hotel-a', accessId: 'access-a', generation: 1, expiresAt: now + 86_400_000, revokedAt: null,
    reservation: { id: 'stay-a', tenantId: 'hotel-a', propertyId: 'property-a', status: 'CONFIRMED', checkOut: now + 86_400_000 }, property: { id: 'property-a', tenantId: 'hotel-a' }, guest: { tenantId: 'hotel-a' } };
}
function bootstrap(n = 1): BootstrapRecord { return { codeHash: hash(n), scope: planScope(), issuedAt: now, expiresAt: now + GUEST_PROTOCOL.bootstrapTtlMs, consumedAt: null, revokedAt: null }; }
function planScope() { return { tenantId: 'hotel-a', propertyId: 'property-a', reservationId: 'stay-a', accessId: 'access-a', generation: 1 }; }
function session(): GuestSessionRecord { return { kind: 'CONNECT_GUEST', secretHash: hash(100), scope: planScope(), createdAt: now, lastSeenAt: now, expiresAt: now + GUEST_PROTOCOL.sessionTtlMs, revokedAt: null }; }

/** TEST-ONLY synchronous commit model after an async scheduling point. Not PostgreSQL,
 * not a lock implementation or evidence of multi-process/driver/HTTP atomicity.
 * Reuse these outcomes against a real repository in the persistence PR.
 */
class ReferenceExchange implements GuestExchangeRepository {
  access = authority(); codes = new Map([[hash(1), bootstrap()]]); sessions: GuestSessionRecord[] = []; failInsert = false;
  async exchangeOnce({ codeHash, freshSessionHash, now: at }: { codeHash: string; freshSessionHash: string; now: number }) {
    await Promise.resolve(); // Contenders arrive before the single model commit section.
    const b = this.codes.get(codeHash);
    if (!b || b.codeHash !== codeHash || !isFingerprint(freshSessionHash)) throw new GuestProtocolDenied();
    const plan = planExchange(b, this.access, at);
    const active = this.sessions.filter(s => { try { assertGuestSession(s, this.access, at); return true; } catch { return false; } });
    if (active.length >= GUEST_PROTOCOL.maxSessions || this.sessions.some(s => s.secretHash === freshSessionHash) || this.failInsert) throw new GuestProtocolDenied();
    const s: GuestSessionRecord = { kind: 'CONNECT_GUEST', secretHash: freshSessionHash, ...plan, createdAt: at, lastSeenAt: at, revokedAt: null };
    // No await or external operation between these paired model writes.
    b.consumedAt = at; this.sessions.push(s); return structuredClone(s);
  }
}

describe('CONNECT-SEC-01 inactive transport contracts', () => {
  it('accepts only canonical 32-byte bootstrap syntax', () => { expect(parseExchangeBody({ code })).toEqual({ code }); });
  it.each([null, [], {}, { code: 'short' }, { code: code + '=' }, { code: code + ' ' }, { code: 123 }, { code, tenantId: 'hotel-b' }, { code, reservationId: 'stay-b' }, { code, generation: 2 }, { code, userId: 'staff' }, { code, role: 'OWNER' }])('rejects malformed/ownership input without echoing it', input => {
    expect(() => parseExchangeBody(input)).toThrow('GUEST_ACCESS_DENIED');
  });
  it('parses only a fragment bootstrap, never a path/query or redirect field', () => {
    expect(parseBootstrapFragment('#code=' + code)).toEqual({ code });
    for (const value of ['?code=' + code, '/connect/' + code, '#token=' + code, '#code=' + code + '&redirect=evil', '#code=' + code + '&code=' + code]) expect(() => parseBootstrapFragment(value)).toThrow(GuestProtocolDenied);
  });
  it('requires explicit POST JSON and exact secure origin', () => { expect(() => assertExchangeRequest('POST', 'https://guest.example.invalid', 'application/json; charset=utf-8', 'https://guest.example.invalid')).not.toThrow(); });
  it.each([['GET', 'https://guest.example.invalid', 'application/json'], ['POST', undefined, 'application/json'], ['POST', 'null', 'application/json'], ['POST', 'https://evil.example.invalid', 'application/json'], ['POST', 'https://guest.example.invalid.evil.invalid', 'application/json'], ['POST', 'https://guest.example.invalid', 'text/plain']])('denies CSRF/link-preview transport %s %s', (method, origin, type) => {
    expect(() => assertExchangeRequest(method!, origin, type, 'https://guest.example.invalid')).toThrow(GuestProtocolDenied);
  });
  it('does not permit a local/plaintext escape in the future protocol', () => { expect(() => assertExchangeRequest('POST', 'http://localhost:3000', 'application/json', 'http://localhost:3000')).toThrow(GuestProtocolDenied); });
  it('keeps fixed guest paths and an independent Secure host-only HttpOnly cookie contract', () => {
    expect(GUEST_PROTOCOL.cookie).toEqual({ name: '__Host-vantara_guest', path: '/', secure: true, httpOnly: true, sameSite: 'lax' });
    expect(GUEST_PROTOCOL.cookie.name).not.toBe('vantara_session');
    for (const route of [GUEST_PROTOCOL.exchange, GUEST_PROTOCOL.stay, GUEST_PROTOCOL.requests, GUEST_PROTOCOL.logout]) { expect(route).toMatch(/^\/api\/guest-connect\/[a-z]+$/); expect(route).not.toMatch(/[?#:]/); }
  });
});

describe('Trusted scope, expiry and revocation preflights', () => {
  it.each(['tenantId', 'propertyId', 'reservationId', 'accessId', 'generation'] as const)('rejects mismatched %s for exchange and session', key => {
    const b = bootstrap(), s = session(); (b.scope as any)[key] = key === 'generation' ? 2 : 'foreign'; (s.scope as any)[key] = (b.scope as any)[key];
    expect(() => planExchange(b, authority(), now)).toThrow(GuestProtocolDenied);
    expect(() => assertGuestSession(s, authority(), now)).toThrow(GuestProtocolDenied);
  });
  it.each(['PENDING', 'CHECKED_OUT', 'CANCELED', 'NO_SHOW'])('denies new protocol access for %s without changing legacy rules', status => {
    const a = authority(); a.reservation.status = status;
    expect(() => planExchange(bootstrap(), a, now)).toThrow(GuestProtocolDenied); expect(() => assertGuestSession(session(), a, now)).toThrow(GuestProtocolDenied);
  });
  it.each(['tenant', 'property', 'guest', 'revoked', 'checkout', 'access-expiry', 'platform'])('rejects invalid live authority %s', reason => {
    const a = authority();
    if (reason === 'tenant') a.reservation.tenantId = 'hotel-b';
    if (reason === 'property') a.property.tenantId = 'hotel-b';
    if (reason === 'guest') a.guest.tenantId = 'hotel-b';
    if (reason === 'revoked') a.revokedAt = now;
    if (reason === 'checkout') a.reservation.checkOut = now;
    if (reason === 'access-expiry') a.expiresAt = now;
    if (reason === 'platform') (a as any).tenantType = 'PLATFORM';
    expect(() => planExchange(bootstrap(), a, now)).toThrow(GuestProtocolDenied);
  });
  it.each(['consumed', 'revoked', 'expiry-boundary', 'overlong', 'future', 'bad-clock'])('rejects bootstrap %s', reason => {
    const b = bootstrap();
    if (reason === 'consumed') b.consumedAt = now;
    if (reason === 'revoked') b.revokedAt = now;
    if (reason === 'expiry-boundary') b.expiresAt = now;
    if (reason === 'overlong') b.expiresAt++;
    if (reason === 'future') b.issuedAt++;
    expect(() => planExchange(b, authority(), reason === 'bad-clock' ? NaN : now)).toThrow(GuestProtocolDenied);
  });
  it('denies exactly at elapsed code and absolute session expiry boundaries', () => {
    expect(() => planExchange(bootstrap(), authority(), now + GUEST_PROTOCOL.bootstrapTtlMs)).toThrow(GuestProtocolDenied);
    const s = session(); s.lastSeenAt = s.expiresAt;
    expect(() => assertGuestSession(s, authority(), s.expiresAt)).toThrow(GuestProtocolDenied);
  });
  it('bounds a fresh session by server stay and access expiry', () => {
    const a = authority(); a.expiresAt = now + 1000; a.reservation.checkOut = now + 500;
    const b = bootstrap(); b.expiresAt = now + 400;
    expect(planExchange(b, a, now).expiresAt).toBe(now + 500);
  });
  it.each(['staff', 'revoked', 'idle-boundary', 'absolute-boundary', 'future-seen', 'overlong'])('rejects session %s', reason => {
    const s = session();
    if (reason === 'staff') (s as any).kind = 'STAFF';
    if (reason === 'revoked') s.revokedAt = now;
    if (reason === 'idle-boundary') { s.lastSeenAt = now - GUEST_PROTOCOL.idleTtlMs; s.createdAt = s.lastSeenAt - 1000; s.expiresAt = now + 1000; }
    if (reason === 'absolute-boundary') s.expiresAt = now;
    if (reason === 'future-seen') s.lastSeenAt++;
    if (reason === 'overlong') s.expiresAt++;
    expect(() => assertGuestSession(s, authority(), now)).toThrow(GuestProtocolDenied);
  });
});

describe('Reference-model repository obligations (not a database concurrency proof)', () => {
  it('admits exactly one simultaneous exchange and denies replay', async () => {
    const repo = new ReferenceExchange();
    const results = await Promise.allSettled([100, 101].map(n => repo.exchangeOnce({ codeHash: hash(1), freshSessionHash: hash(n), now })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(repo.sessions).toHaveLength(1);
    await expect(repo.exchangeOnce({ codeHash: hash(1), freshSessionHash: hash(102), now })).rejects.toThrow(GuestProtocolDenied);
  });
  it('models paired rollback on session insertion failure without burning the code', async () => {
    const repo = new ReferenceExchange(); repo.failInsert = true;
    await expect(repo.exchangeOnce({ codeHash: hash(1), freshSessionHash: hash(100), now })).rejects.toThrow(GuestProtocolDenied);
    expect(repo.codes.get(hash(1))!.consumedAt).toBeNull(); expect(repo.sessions).toHaveLength(0);
    repo.failInsert = false; await expect(repo.exchangeOnce({ codeHash: hash(1), freshSessionHash: hash(101), now })).resolves.toHaveProperty('kind', 'CONNECT_GUEST');
  });
  it.each(['revoked', 'rotated', 'checkout'])('checks live %s state at model commit, not a stale preflight', async reason => {
    const repo = new ReferenceExchange(); const pending = repo.exchangeOnce({ codeHash: hash(1), freshSessionHash: hash(100), now });
    if (reason === 'revoked') repo.access.revokedAt = now;
    if (reason === 'rotated') repo.access.generation++;
    if (reason === 'checkout') repo.access.reservation.status = 'CHECKED_OUT';
    await expect(pending).rejects.toThrow(GuestProtocolDenied); expect(repo.sessions).toHaveLength(0); expect(repo.codes.get(hash(1))!.consumedAt).toBeNull();
  });
  it('allows separate per-device codes but serializes the three-session cap', async () => {
    const repo = new ReferenceExchange(); for (const n of [2, 3, 4]) repo.codes.set(hash(n), bootstrap(n));
    const results = await Promise.allSettled([1, 2, 3, 4].map(n => repo.exchangeOnce({ codeHash: hash(n), freshSessionHash: hash(n + 100), now })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3); expect(repo.sessions).toHaveLength(3);
    expect([...repo.codes.values()].filter(c => c.consumedAt === null)).toHaveLength(1);
    repo.sessions[0].revokedAt = now; await expect(repo.exchangeOnce({ codeHash: hash(4), freshSessionHash: hash(200), now })).resolves.toHaveProperty('kind', 'CONNECT_GUEST');
  });
  it('denies unknown code hashes and duplicate session secrets without consuming a new code', async () => {
    const repo = new ReferenceExchange();
    await expect(repo.exchangeOnce({ codeHash: hash(999), freshSessionHash: hash(100), now })).rejects.toThrow(GuestProtocolDenied);
    await repo.exchangeOnce({ codeHash: hash(1), freshSessionHash: hash(100), now }); repo.codes.set(hash(2), bootstrap(2));
    await expect(repo.exchangeOnce({ codeHash: hash(2), freshSessionHash: hash(100), now })).rejects.toThrow(GuestProtocolDenied);
    expect(repo.codes.get(hash(2))!.consumedAt).toBeNull(); expect(repo.sessions).toHaveLength(1);
  });
  it.each([['a', 'b'], ['b', 'a']])('denies hotel %s session against hotel %s authority', (own, foreign) => {
    const scoped = (side: string) => {
      const a = authority(); a.tenantId = a.reservation.tenantId = a.property.tenantId = a.guest.tenantId = `hotel-${side}`;
      a.accessId = `access-${side}`; a.reservation.id = `stay-${side}`; a.property.id = a.reservation.propertyId = `property-${side}`; return a;
    };
    const s = session(); s.scope = { tenantId: `hotel-${own}`, propertyId: `property-${own}`, reservationId: `stay-${own}`, accessId: `access-${own}`, generation: 1 };
    expect(assertGuestSession(s, scoped(own), now).tenantId).toBe(`hotel-${own}`);
    expect(() => assertGuestSession(s, scoped(foreign), now)).toThrow(GuestProtocolDenied);
  });
  it('isolates A/B authorities and denies a session after generation rotation', () => {
    const b = authority(); b.tenantId = b.reservation.tenantId = b.property.tenantId = b.guest.tenantId = 'hotel-b';
    expect(() => assertGuestSession(session(), b, now)).toThrow(GuestProtocolDenied);
    const a = authority(); a.generation++; expect(() => assertGuestSession(session(), a, now)).toThrow(GuestProtocolDenied);
  });
});
