import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AuthController } from '../auth/auth.controller';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { PermissionsGuard } from '../auth/permissions.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { GuestsController } from '../guests/guests.controller';
import { GuestsService } from '../guests/guests.service';
import { OnboardingController } from '../onboarding/onboarding.controller';
import { OnboardingService } from '../onboarding/onboarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../rbac/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { securityMiddleware } from './cloud-security';

// Only synthetic, mocked records. The real HTTP guards/services derive tenant scope.
describe('Cloud HTTP origin, signup and two-tenant regression', () => {
  let app: INestApplication;
  let base: string;
  const previous = { ...process.env };
  const origin = 'https://hotel.example.invalid';
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const db = {
    $transaction: jest.fn(),
    session: { findFirst: jest.fn(async ({ where }: any) => {
      const key = ['a', 'b'].find(id => hash(`synthetic-${id}`) === where.tokenHash);
      if (!key) return null;
      return { activeTenantId: `hotel-${key}`, user: { id: `user-${key}`, name: 'Synthetic', email: `${key}@example.invalid`, memberships: [{ id: `membership-${key}`, tenantId: `hotel-${key}`, role: 'HOTEL_ADMIN', tenant: { id: `hotel-${key}`, name: 'Synthetic', slug: `hotel-${key}`, subscription: null } }] } };
    }), deleteMany: jest.fn() },
    membership: { findUnique: jest.fn(async ({ where }: any) => {
      const { userId, tenantId } = where.userId_tenantId;
      return userId.replace('user-', '') === tenantId.replace('hotel-', '') ? { role: 'HOTEL_ADMIN', tenant: { type: 'HOTEL' } } : null;
    }) },
    guest: { findFirst: jest.fn(async ({ where }: any) => where.id.replace('guest-', '') === where.tenantId.replace('hotel-', '') ? { id: where.id, tenantId: where.tenantId } : null) },
  };
  beforeAll(async () => {
    process.env.NODE_ENV = 'production'; process.env.WEB_ORIGIN = origin;
    delete process.env.VANTARA_ENV; delete process.env.ALLOW_LOCAL_WORKSPACE_SIGNUP;
    const module = await Test.createTestingModule({
      controllers: [AuthController, OnboardingController, GuestsController],
      providers: [NotificationsGateway, AuthService, AuthGuard, OnboardingService, GuestsService, TenantContextGuard, PermissionsGuard, RbacService,
        { provide: PrismaService, useValue: db }, { provide: AuditService, useValue: { record: jest.fn() } }],
    }).compile();
    app = module.createNestApplication(); app.use(securityMiddleware); app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    jest.spyOn(module.get(AuthService), 'login').mockResolvedValue({ token: 'synthetic-login', expiresAt: new Date() });
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  });
  afterAll(async () => { if (app) await app.close(); process.env = previous; });
  function request(path: string, token = 'a', method = 'GET', body?: object, requestOrigin: string | null = origin) {
    return fetch(`${base}/api${path}`, { method, headers: { Cookie: `vantara_session=synthetic-${token}`, ...(requestOrigin ? { Origin: requestOrigin } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  function upgrade(originValue?: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(`${base}/socket.io/?EIO=4&transport=websocket`, { headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'c3ludGhldGljLXRlc3QwMQ==',
        ...(originValue === undefined ? {} : { Origin: originValue }),
      } });
      req.on('upgrade', (response, socket) => { socket.destroy(); resolve({ status: response.statusCode!, body: '' }); });
      req.on('response', response => {
        let body = ''; response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      });
      req.on('error', reject); req.end();
    });
  }
  it.each([undefined, 'null', 'https://evil.example.invalid'])('rejects an actual Engine.IO WebSocket upgrade with origin %s', async value => {
    // Engine.IO abortUpgrade uses HTTP 400 even for its FORBIDDEN error code.
    expect(await upgrade(value)).toEqual({ status: 400, body: 'Forbidden' });
  });
  it('permits the trusted-origin transport upgrade; namespace session auth remains separate', async () => {
    expect((await upgrade(origin)).status).toBe(101);
  });
  it('denies public signup even with a trusted origin and performs no database writes', async () => {
    const response = await request('/onboarding/workspace', 'a', 'POST', { name: 'Synthetic', email: 'synthetic@example.invalid', password: 'synthetic-password', hotelName: 'Synthetic Hotel', slug: 'synthetic-hotel', propertyName: 'Synthetic Property' });
    expect(response.status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it.each([null, 'null', 'https://evil.example.invalid'])('rejects direct API login with untrusted origin %s', async value => {
    const response = await request('/auth/login', 'a', 'POST', { email: 'a@example.invalid', password: 'synthetic-password' }, value);
    expect(response.status).toBe(403);
  });
  it('sets a secure host-only session cookie through the real controller', async () => {
    const response = await request('/auth/login', 'a', 'POST', { email: 'a@example.invalid', password: 'synthetic-password' });
    expect(response.status).toBe(201);
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('; Secure'); expect(cookie).toContain('; HttpOnly'); expect(cookie).toContain('; SameSite=Lax'); expect(cookie).not.toContain('Domain=');
    expect(await response.json()).not.toHaveProperty('token');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });
  it.each([['a', 'b'], ['b', 'a']])('keeps hotel %s from reading hotel %s guests despite client tenant overrides', async (own, foreign) => {
    expect((await request(`/guests/guest-${own}`, own)).status).toBe(200);
    expect((await request(`/guests/guest-${foreign}?tenantId=hotel-${foreign}`, own)).status).toBe(404);
    expect(db.guest.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: `guest-${foreign}`, tenantId: `hotel-${own}` } }));
  });
  it('rejects client ownership fields on mutations and missing sessions on reads', async () => {
    expect((await request('/guests', 'a', 'POST', { firstName: 'Synthetic', lastName: 'Guest', tenantId: 'hotel-b' })).status).toBe(400);
    expect((await request('/guests/guest-a', 'missing')).status).toBe(401);
  });
});
