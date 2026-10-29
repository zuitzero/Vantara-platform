import { assertLocalWorkspaceSignup, allowedOrigin, isLocal, securityMiddleware, sessionCookie, validateCloudEnvironment } from './cloud-security';
import { OnboardingService } from '../onboarding/onboarding.service';
import { AuthService } from '../auth/auth.service';

const cloud = { NODE_ENV: 'production', WEB_ORIGIN: 'https://hotel.example.invalid', DATABASE_URL: 'postgresql://synthetic:synthetic@db.internal/demo' };

describe('Cloud configuration and signup policy', () => {
  const original = { ...process.env };
  afterEach(() => { process.env = { ...original }; });
  it.each([{}, { NODE_ENV: 'production', ALLOW_LOCAL_WORKSPACE_SIGNUP: 'true' }, { NODE_ENV: 'test', VANTARA_ENV: 'staging', ALLOW_LOCAL_WORKSPACE_SIGNUP: 'true' }, { NODE_ENV: 'test', ALLOW_LOCAL_WORKSPACE_SIGNUP: 'TRUE' }, { NODE_ENV: 'test', VANTARA_ENV: 'typo', ALLOW_LOCAL_WORKSPACE_SIGNUP: 'true' }])('denies signup fail-closed for %j', env => {
    expect(() => assertLocalWorkspaceSignup(env)).toThrow('Public hotel registration is disabled');
  });
  it('permits only explicit local/test opt-in', () => {
    expect(() => assertLocalWorkspaceSignup({ NODE_ENV: 'test', ALLOW_LOCAL_WORKSPACE_SIGNUP: 'true' })).not.toThrow();
    expect(isLocal({ NODE_ENV: 'production', VANTARA_ENV: 'local' })).toBe(false);
  });
  it('denies the service directly without any database writes or audit side effects', async () => {
    delete process.env.ALLOW_LOCAL_WORKSPACE_SIGNUP;
    const db = { $transaction: jest.fn(), auditLog: { create: jest.fn() } };
    await expect(new OnboardingService(db as any).createWorkspace({} as any)).rejects.toThrow('Public hotel registration is disabled');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('validates Cloud without printing connection secrets', () => {
    expect(() => validateCloudEnvironment(cloud)).not.toThrow();
  });
  it.each([{ WEB_ORIGIN: undefined }, { WEB_ORIGIN: '*' }, { WEB_ORIGIN: 'https://a.example.invalid,https://b.example.invalid' }, { WEB_ORIGIN: 'https://hotel.example.invalid/path' }, { WEB_ORIGIN: 'http://hotel.example.invalid' }, { WEB_ORIGIN: 'https://localhost' }, { DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1/demo' }, { VANTARA_ENV: 'local' }, { VANTARA_ENV: 'typo' }, { ALLOW_LOCAL_WORKSPACE_SIGNUP: 'true' }, { ALLOW_LOCAL_WORKSPACE_SIGNUP: 'TRUE' }, { NODE_ENV: 'test', VANTARA_ENV: 'staging' }])('rejects unsafe Cloud configuration %j', invalid => {
    expect(() => validateCloudEnvironment({ ...cloud, ...invalid })).toThrow();
  });
  it('uses exact origins, rejecting missing/null/suffix and invalid config', () => {
    expect(allowedOrigin(cloud.WEB_ORIGIN, cloud)).toBe(true);
    for (const origin of [undefined, 'null', 'https://hotel.example.invalid.evil.invalid', 'http://hotel.example.invalid']) expect(allowedOrigin(origin, cloud)).toBe(false);
    expect(allowedOrigin('anything', { NODE_ENV: 'production' })).toBe(false);
  });
  it('keeps host-only Secure, HttpOnly and SameSite cookies for Cloud login and clearing', () => {
    for (const cookie of [sessionCookie('synthetic', 100, cloud), sessionCookie('', 0, cloud)]) {
      expect(cookie).toContain('; Secure'); expect(cookie).toContain('; HttpOnly');
      expect(cookie).toContain('; SameSite=Lax'); expect(cookie).not.toMatch(/Domain=/i);
    }
    expect(sessionCookie('synthetic', 100, { NODE_ENV: 'development' })).not.toContain('; Secure');
  });
  it.each([undefined, 'null', 'https://evil.example.invalid'])('blocks unsafe HTTP mutations with origin %s', origin => {
    process.env = { ...cloud };
    const response = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    securityMiddleware({ method: 'POST', path: '/api/auth/login', headers: { origin } } as any, response as any, next);
    expect(response.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
    expect(response.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
  });
  it('allows same-origin mutations and signed webhook processing without trusting forwarded headers', () => {
    process.env = { ...cloud };
    for (const request of [{ method: 'POST', path: '/api/auth/logout', headers: { origin: cloud.WEB_ORIGIN } }, { method: 'POST', path: '/api/billing/webhooks/stripe', headers: {} }]) {
      const next = jest.fn();
      securityMiddleware(request as any, { setHeader: jest.fn() } as any, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});

describe('HTTP session revocation primitives reused by realtime', () => {
  it('expiry and revoked sessions cannot authenticate, and lookup uses a hash and future expiry', async () => {
    const db = { session: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new AuthService(db as any).getWorkspace('synthetic')).rejects.toThrow('Session expired');
    const where = (db.session.findFirst.mock.calls as any)[0][0].where;
    expect(where.tokenHash).toMatch(/^[a-f0-9]{64}$/); expect(where.tokenHash).not.toBe('synthetic');
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });
  it('missing active membership cannot authenticate', async () => {
    const db = { session: { findFirst: jest.fn().mockResolvedValue({ activeTenantId: 'hotel-b', user: { memberships: [{ tenantId: 'hotel-a' }] } }) } };
    await expect(new AuthService(db as any).getWorkspace('synthetic')).rejects.toThrow('Active membership');
  });
  it('logout deletes only the current hashed session', async () => {
    const db = { session: { deleteMany: jest.fn() } };
    await new AuthService(db as any).logout('synthetic');
    expect(db.session.deleteMany).toHaveBeenCalledWith({ where: { tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });
});
