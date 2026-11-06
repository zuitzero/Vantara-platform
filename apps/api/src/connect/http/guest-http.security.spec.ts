import { enabled, trustedOrigin, requireGuestTransport, GuestRateLimit, guestSecret, csrf, checkCsrf } from './guest-http.security';
import { requestInput } from './guest-http.service';
import { randomBytes } from 'node:crypto';
describe('Guest HTTP fail-closed contracts', () => {
  const env = { NODE_ENV: 'test', VANTARA_ENV: 'local', CONNECT_GUEST_HTTP: 'synthetic-https-only', CONNECT_GUEST_POLICY_ACK: 'candidate-v1-synthetic-only', WEB_ORIGIN: 'https://localhost:3443' };
  const previous = { ...process.env };
  beforeEach(() => { Object.assign(process.env, env); });
  afterAll(() => { process.env = previous; });
  it('requires every local experimental opt-in and exact HTTPS loopback origin', () => {
    expect(enabled({})).toBe(false);
    for (const patch of [{ NODE_ENV: 'production' }, { VANTARA_ENV: 'staging' }, { CONNECT_GUEST_HTTP: '' }, { CONNECT_GUEST_POLICY_ACK: '' }]) expect(enabled({ ...env, ...patch })).toBe(false);
    for (const WEB_ORIGIN of ['http://localhost:3443', 'https://public.example.invalid', 'https://localhost:3443/', 'https://user@localhost:3443']) expect(() => trustedOrigin({ ...env, WEB_ORIGIN })).toThrow();
  });
  it('does not trust Origin/forwarding headers as proof of TLS or loopback transport', () => {
    const req = { socket: { localAddress: '127.0.0.1', remoteAddress: '127.0.0.1', encrypted: true }, originalUrl: '/api/guest-connect/stay', method: 'GET', rawHeaders: [], headers: { origin: env.WEB_ORIGIN, 'x-vantara-guest': '1', 'x-forwarded-proto': 'https' } };
    expect(() => requireGuestTransport(req as any)).not.toThrow();
    expect(() => requireGuestTransport({ ...req, socket: { ...req.socket, encrypted: false } } as any)).toThrow();
    expect(() => requireGuestTransport({ ...req, socket: { ...req.socket, remoteAddress: '192.0.2.1' } } as any)).toThrow();
  });
  it('rejects repeated and malformed cookie pairs from raw headers, without staff fallback', () => {
    const secret = randomBytes(32).toString('base64url');
    for (const value of [`__Host-vantara_guest=${secret}; __Host-vantara_guest=${secret}`, '__Host-vantara_guest', `vantara_session=${secret}`]) expect(() => guestSecret({ rawHeaders: ['Cookie', value] } as any)).toThrow();
    expect(guestSecret({ rawHeaders: ['Cookie', `vantara_session=ignored; __Host-vantara_guest=${secret}`] } as any)).toBe(secret);
    expect(() => checkCsrf({ headers: { 'x-vantara-csrf': 'é'.repeat(43) } } as any, secret)).toThrow('Guest request denied.');
    expect(() => checkCsrf({ headers: { 'x-vantara-csrf': csrf(secret) } } as any, secret)).not.toThrow();
  });
  it('bounds rate memory, attempts and expiry without using guest secrets as keys', () => {
    const rate = new GuestRateLimit();
    for (let i = 0; i < 120; i++) expect(rate.take('loopback:exchange', 1)).toBe(true);
    expect(rate.take('loopback:exchange', 2)).toBe(false);
    expect(rate.take('loopback:exchange', 60001)).toBe(true);
  });
  it('rejects ownership fields, excessive counts and empty free text; canonicalizes defaults', () => {
    const good = { title: 'Towels', message: 'SYNTHETIC please', category: 'HOUSEKEEPING' };
    for (const patch of [{ tenantId: 'foreign' }, { reservationId: 'foreign' }, { guestId: 'foreign' }, { guestCount: 101 }, { title: '  ' }, { category: 'INVENTED' }]) expect(() => requestInput({ ...good, ...patch })).toThrow();
    expect(requestInput(good)).toEqual(requestInput({ ...good, title: ' Towels ', priority: 'NORMAL', guestCount: 1 }));
  });
});
