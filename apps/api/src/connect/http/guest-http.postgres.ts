// Invoked inside the guarded PostgreSQL18 suite; inherits its empty-target verification and two-hotel fixtures.
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { request as httpsRequest } from 'node:https';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestsService } from '../../requests/requests.service';
import { ReservationsService } from '../../reservations/reservations.service';
import { ConnectService } from '../connect.service';
import { RoomReadinessService } from '../../room-readiness/room-readiness.service';
import { configureGuestHttp, csrf, digest, GUEST_COOKIE } from './guest-http.security';
import { securityMiddleware } from '../../security/cloud-security';
import { GuestHttpService } from './guest-http.service';
import { PostgresGuestAccessRepository } from '../persistence/guest-access.repository';

type Context = { a: PrismaClient; b: PrismaClient; blocker: PrismaClient; monitor: PrismaClient; pidA: number; pidB: number; queue: (lock: 'reservation' | 'access', first: () => Promise<unknown>, second: () => Promise<unknown>) => Promise<boolean[]>; blocked: (pid: number) => Promise<void>; mint: (repo?: PostgresGuestAccessRepository) => Promise<any> };
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
export function guestHttpTests(context: () => Context) {
  describe('CONNECT-SEC-03 real Nest HTTPS and PostgreSQL', () => {
    let apps: NestExpressApplication[], bases: string[], certificate: Buffer;
    const old = { ...process.env }, logs: string[] = [], secrets: string[] = [];
    const tenant = 'cs02-a', res = 'cs02-res-a';
    const body = { title: 'SYNTHETIC towels', message: 'SYNTHETIC two towels', category: 'HOUSEKEEPING' };
    const opaque = () => randomBytes(32).toString('base64url');
    type Result = { status: number; body: any; cookie?: string; setCookie?: string; text: string; headers: any };
    async function call(path: string, method = 'GET', payload?: unknown, cookie?: string, headers: Record<string, string | string[]> = {}, index = 0, chunked = false): Promise<Result> {
      const data = payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload);
      return new Promise((resolve, reject) => {
        const request = httpsRequest(`${bases[index]}/api/${path}`, { ca: certificate, method, headers: {
          Origin: process.env.WEB_ORIGIN!, 'X-Vantara-Guest': '1', 'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}), ...(data && !chunked ? { 'Content-Length': Buffer.byteLength(data).toString() } : {}), ...headers,
        } }, response => {
          let text = ''; response.on('data', data => { text += data; }); response.on('end', () => {
            let parsed: unknown; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
            const setCookie = response.headers['set-cookie']?.[0]; resolve({ status: response.statusCode!, body: parsed, text, setCookie, cookie: setCookie?.split(';')[0], headers: response.headers });
          });
        });
        request.on('error', () => reject(new Error('SYNTHETIC_HTTPS_REQUEST_FAILED')));
        if (data && chunked) { request.write(data.slice(0, 100)); request.write(data.slice(100)); request.end(); } else request.end(data);
      });
    }
    async function session(index = 0, reservationId = res, tenantId = tenant) {
      const issued = await apps[index].get(GuestHttpService).issue(tenantId, reservationId); secrets.push(issued.code);
      const exchanged = await call('guest-connect/session', 'POST', { code: issued.code }, undefined, {}, index);
      check(exchanged.status === 200 && exchanged.cookie && exchanged.body.csrfToken, 'SESSION_EXCHANGE_FAILED');
      secrets.push(exchanged.cookie.split('=')[1], exchanged.body.csrfToken);
      return { ...exchanged, code: issued.code, csrf: { 'X-Vantara-CSRF': exchanged.body.csrfToken, 'Idempotency-Key': opaque() } };
    }
    beforeAll(async () => {
      process.env.NODE_ENV = 'test'; process.env.VANTARA_ENV = 'local'; process.env.CONNECT_GUEST_HTTP = 'synthetic-https-only'; process.env.CONNECT_GUEST_POLICY_ACK = 'candidate-v1-synthetic-only';
      certificate = readFileSync(process.env.CONNECT_SEC03_TLS_CERT!); const key = readFileSync(process.env.CONNECT_SEC03_TLS_KEY!);
      apps = []; bases = [];
      for (const db of [context().a, context().b]) {
        const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
        const app = module.createNestApplication<NestExpressApplication>({ rawBody: true, httpsOptions: { key, cert: certificate } });
        app.useLogger({ log: (...values: unknown[]) => logs.push(values.map(String).join(' ')), warn: (...values: unknown[]) => logs.push(values.map(String).join(' ')), error: (...values: unknown[]) => logs.push(values.map(String).join(' ')) });
        configureGuestHttp(app); app.use(securityMiddleware); app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.listen(0, '127.0.0.1'); apps.push(app); bases.push(await app.getUrl());
      }
      process.env.WEB_ORIGIN = bases[0];
    }, 30000);
    afterAll(async () => { await Promise.all(apps?.map(app => app.close()) ?? []); process.env = old; });
    it('is off by default and refuses Cloud, missing policy review and non-exact origins', async () => {
      for (const change of [{ CONNECT_GUEST_HTTP: '' }, { CONNECT_GUEST_POLICY_ACK: '' }, { VANTARA_ENV: 'staging' }, { NODE_ENV: 'production' }]) {
        const saved = { ...process.env }; Object.assign(process.env, change);
        check((await call('guest-connect/session', 'POST', { code: opaque() })).status === 404, 'GATE_BYPASSED'); process.env = saved;
      }
      for (const origin of ['', 'null', 'https://evil.example.invalid', bases[0] + '.evil']) check((await call('guest-connect/session', 'POST', { code: opaque() }, undefined, { Origin: origin })).status === 403, 'ORIGIN_BYPASSED');
      check((await call('guest-connect/session?code=synthetic-canary', 'POST', { code: opaque() })).status === 403, 'QUERY_ACCEPTED');
      check((await call('guest-connect/session', 'POST', { code: opaque() }, undefined, { 'Content-Type': 'text/plain' })).status === 403, 'SIMPLE_CONTENT_TYPE_ACCEPTED');
      check((await call('guest-connect/session', 'POST', { code: opaque() }, undefined, { 'Sec-Fetch-Site': 'cross-site' })).status === 403, 'FETCH_METADATA_BYPASSED');
    });
    it('authorizes bootstrap issuance through real staff RBAC and never rotates an existing legacy link', async () => {
      const db = context().a;
      await db.user.deleteMany({ where: { id: { in: ['cs03-admin', 'cs03-foreign', 'cs03-staff'] } } });
      const tokens: Record<string, string> = {};
      for (const [id, tenantId, role] of [['cs03-admin', tenant, 'HOTEL_ADMIN'], ['cs03-foreign', 'cs02-b', 'HOTEL_ADMIN'], ['cs03-staff', tenant, 'HOTEL_STAFF']] as const) {
        const token = opaque(); secrets.push(token); tokens[id] = token;
        await db.user.create({ data: { id, name: 'SYNTHETIC', email: id + '@example.invalid', passwordHash: 'disabled-synthetic-only', memberships: { create: { tenantId, role } } } });
        await db.session.create({ data: { userId: id, activeTenantId: tenantId, tokenHash: digest(token), expiresAt: new Date(Date.now() + 60000) } });
      }
      const before = await db.guestConnectAccess.findUniqueOrThrow({ where: { reservationId: res } });
      const path = `connect-admin/reservations/${res}/bootstrap`;
      check((await call(path, 'POST', {})).status === 401, 'ISSUANCE_WITHOUT_STAFF_AUTH');
      check((await call(path, 'POST', {}, `vantara_session=${tokens['cs03-staff']}`)).status === 403, 'STAFF_MUTATION_GRANTED');
      check((await call(path, 'POST', {}, `vantara_session=${tokens['cs03-foreign']}`)).status === 401, 'CROSS_TENANT_ISSUANCE');
      check((await call(path, 'POST', { tenantId: 'cs02-b' }, `vantara_session=${tokens['cs03-admin']}`)).status === 400, 'ISSUANCE_OWNERSHIP_ACCEPTED');
      const issued = await call(path, 'POST', {}, `vantara_session=${tokens['cs03-admin']}`);
      check(issued.status === 201 && typeof issued.body.code === 'string' && !issued.text.includes('tenantId'), 'ISSUANCE_DENIED'); secrets.push(issued.body.code);
      check((await db.guestConnectAccess.findUniqueOrThrow({ where: { reservationId: res } })).tokenHash === before.tokenHash, 'ISSUANCE_ROTATED_LEGACY');
      // New access root is created only when absent; no usable legacy bearer is delivered.
      await db.guestConnectAccess.delete({ where: { reservationId: 'cs02-res-b' } });
      const fresh = await call('connect-admin/reservations/cs02-res-b/bootstrap', 'POST', {}, `vantara_session=${tokens['cs03-foreign']}`);
      check(fresh.status === 201 && await db.guestConnectAccess.count({ where: { reservationId: 'cs02-res-b', generation: 1 } }) === 1, 'ROOT_ISSUANCE_FAILED'); secrets.push(fresh.body.code);
    });
    it('has one HTTP exchange winner on two observed PostgreSQL connections', async () => {
      const issued = await apps[0].get(GuestHttpService).issue(tenant, res); secrets.push(issued.code); const results: Result[] = [];
      await context().queue('reservation', async () => { results[0] = await call('guest-connect/session', 'POST', { code: issued.code }); }, async () => { results[1] = await call('guest-connect/session', 'POST', { code: issued.code }, undefined, {}, 1); });
      check(results[0].status === 200 && results[1].status === 401 && !results[1].cookie && await context().a.guestConnectSession.count() === 1, 'HTTP_REPLAY_RACE');
      secrets.push(results[0].cookie!.split('=')[1], results[0].body.csrfToken);
    });
    it('sets only an independent secure cookie and consumes a code once without returning private scope', async () => {
      const current = await session();
      check(current.setCookie?.includes('; Secure; HttpOnly; SameSite=Lax; Expires=') && !current.setCookie.includes('Domain=') && current.cookie?.startsWith(GUEST_COOKIE + '='), 'COOKIE_FLAGS_INVALID');
      check(!/codeHash|secretHash|tenantId|accessId|generation|vantara_session/.test(current.text), 'PRIVATE_EXCHANGE_PROJECTION');
      const replay = await call('guest-connect/session', 'POST', { code: current.code }); check(replay.status === 401 && !replay.cookie, 'CODE_REPLAY');
      const stay = await call('guest-connect/stay', 'GET', undefined, current.cookie);
      check(stay.status === 200 && stay.body.reservation.confirmationCode === 'SYNTHETIC-a' && !/tenantId|accessId|guestId|email|tokenHash/.test(stay.text), 'STAY_PROJECTION');
      check(stay.headers['cache-control'] === 'no-store' && stay.headers['referrer-policy'] === 'no-referrer', 'CACHE_HEADERS');
    });
    it('rejects duplicate cookies, staff-only authority and tenant ownership input', async () => {
      const current = await session(); const raw = current.cookie!.split('=')[1];
      for (const value of [current.cookie + '; ' + current.cookie, `${GUEST_COOKIE}=; ${current.cookie}`, `vantara_session=${raw}`]) check((await call('guest-connect/stay', 'GET', undefined, value)).status === 403, 'COOKIE_AMBIGUITY_OR_STAFF_FALLBACK');
      check((await call('guest-connect/stay', 'GET', undefined, current.cookie, { Cookie: [current.cookie!, current.cookie!] })).status === 403, 'MULTIPLE_COOKIE_HEADERS');
      check((await call('guest-connect/requests', 'POST', { ...body, tenantId: 'cs02-b' }, current.cookie, current.csrf)).status === 401, 'CLIENT_TENANT_ACCEPTED');
      check((await call('guest-connect/session', 'POST', { code: opaque(), reservationId: res })).status === 401, 'CLIENT_RESERVATION_ACCEPTED');
      check((await call('guest-connect/stay?tenantId=cs02-b', 'GET', undefined, current.cookie)).status === 403, 'QUERY_SCOPE_ACCEPTED');
    });
    it('enforces preallocation body limits for content length and chunked JSON, without echoing secrets', async () => {
      for (const chunked of [false, true]) {
        const result = await call('guest-connect/session', 'POST', JSON.stringify({ code: 'BODY_CANARY_' + 'x'.repeat(3000) }), undefined, {}, 0, chunked);
        check(result.status === 413 && !result.text.includes('BODY_CANARY'), 'EXCHANGE_SIZE_OR_BODY_ECHO');
      }
      const malformed = await call('guest-connect/session', 'POST', '{"code":"BODY_CANARY"');
      check(malformed.status === 400 && !malformed.text.includes('BODY_CANARY'), 'JSON_ERROR_ECHO');
    });
    it('requires session-bound CSRF and keeps each hotel/reservation scope isolated', async () => {
      const one = await session(), two = await session(1, 'cs02-res-b', 'cs02-b');
      check((await call('guest-connect/requests', 'POST', body, one.cookie, { ...one.csrf, 'X-Vantara-CSRF': two.body.csrfToken })).status === 403, 'CSRF_NOT_SESSION_BOUND');
      const created = await call('guest-connect/requests', 'POST', body, one.cookie, one.csrf);
      check(created.status === 200, 'REQUEST_CREATE');
      const foreign = await call('guest-connect/stay', 'GET', undefined, two.cookie, {}, 1);
      check(foreign.status === 200 && foreign.body.reservation.confirmationCode === 'SYNTHETIC-b' && !foreign.body.requests.some((row: any) => row.id === created.body.id), 'CROSS_TENANT_READ');
      check(await context().a.guestRequest.count({ where: { tenantId: 'cs02-b' } }) === 0, 'CROSS_TENANT_WRITE');
    });
    it('commits one request/automation for simultaneous duplicate HTTP submissions and rejects changed payload', async () => {
      const current = await session(); const { queue, a } = context(); const results: Result[] = [];
      check((await queue('reservation', async () => { results[0] = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf); if (results[0].status !== 200) throw new Error('HTTP_DENIED'); }, async () => { results[1] = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf, 1); if (results[1].status !== 200) throw new Error('HTTP_DENIED'); })).every(Boolean), 'HTTP_DUPLICATE_RACE');
      check(results[0].body.id === results[1].body.id && await a.guestRequest.count() === 1 && await a.housekeepingTask.count() === 1 && await a.guestConnectIdempotency.count() === 1, 'DUPLICATED_SIDE_EFFECTS');
      check((await call('guest-connect/requests', 'POST', { ...body, message: 'SYNTHETIC changed' }, current.cookie, current.csrf)).status === 409, 'PAYLOAD_CONFLICT');
      const retry = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf); check(retry.status === 200 && retry.body.id === results[0].body.id, 'LOST_RESPONSE_RETRY');
    });
    it.each(['revoke', 'rotate', 'checkout'])('denies queued HTTP mutation when %s wins, including cached retries', async operation => {
      const current = await session(); const { a, queue } = context();
      const first = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf); check(first.status === 200, 'SETUP_REQUEST');
      const legacy = new ConnectService(a as any, {} as any), reservations = new ReservationsService(a as any, new RoomReadinessService(a as any)); let denied!: Result;
      await queue('reservation', () => operation === 'revoke' ? legacy.revoke(tenant, res) : operation === 'rotate' ? legacy.issue(tenant, res) : reservations.updateStatusForTenant(tenant, res, 'CHECKED_OUT'), async () => { denied = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf, 1); });
      check(denied.status === 401 && await a.guestRequest.count() === 1, 'INVALIDATION_OR_CACHE_AUTH_RACE');
      check((await call('guest-connect/stay', 'GET', undefined, current.cookie)).status === 401, 'INVALID_SESSION_READ');
    });
    it.each(['revoke', 'rotate', 'checkout'])('keeps one committed HTTP mutation when %s follows it', async operation => {
      const current = await session(); const { b, queue, a } = context();
      const legacy = new ConnectService(b as any, {} as any), reservations = new ReservationsService(b as any, new RoomReadinessService(b as any)); let created!: Result;
      await queue('reservation', async () => { created = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf); }, () => operation === 'revoke' ? legacy.revoke(tenant, res) : operation === 'rotate' ? legacy.issue(tenant, res) : reservations.updateStatusForTenant(tenant, res, 'CHECKED_OUT'));
      check(created.status === 200 && await a.guestRequest.count() === 1 && await a.guestConnectIdempotency.count() === 1, 'COMMITTED_REQUEST_LOST');
      check((await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf)).status === 401, 'POST_INVALIDATION_RETRY');
    });
    it('rolls back claim, request and operational writes on actual expiry before commit', async () => {
      const { a, b } = context(); const short = new PostgresGuestAccessRepository(a, { bootstrapTtlMs: 300000, sessionTtlMs: 1000, idleTtlMs: 1800000, maxSessions: 3 });
      const code = await context().mint(short), secret = opaque(); secrets.push(secret); await short.exchangeOnce({ codeHash: code.codeHash, freshSessionHash: digest(secret) });
      const service = apps[1].get(RequestsService); const original = service.createReservationRequestInTransaction.bind(service);
      const spy = jest.spyOn(service, 'createReservationRequestInTransaction').mockImplementation(async (...args) => { const result = await original(...args); await new Promise(resolve => setTimeout(resolve, 1100)); return result; });
      try {
        const result = await call('guest-connect/requests', 'POST', body, `${GUEST_COOKIE}=${secret}`, { 'X-Vantara-CSRF': csrf(secret), 'Idempotency-Key': opaque() }, 1);
        check(result.status === 401 && await b.guestRequest.count() === 0 && await b.guestConnectIdempotency.count() === 0 && await b.housekeepingTask.count() === 0, 'EXPIRY_DID_NOT_ROLL_BACK');
      } finally { spy.mockRestore(); }
    });
    it('handles delayed post-commit delivery with an authorized cached result and no duplicate notifications', async () => {
      const current = await session(); const service = apps[0].get(RequestsService); const original = service.publishReservationRequest.bind(service);
      let ready!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; }), wait = new Promise<void>(resolve => { release = resolve; });
      const spy = jest.spyOn(service, 'publishReservationRequest').mockImplementation(async request => { ready(); await wait; await original(request); });
      const pending = call('guest-connect/requests', 'POST', body, current.cookie, current.csrf);
      await entered;
      try { const retry = await call('guest-connect/requests', 'POST', body, current.cookie, current.csrf, 1); check(retry.status === 200 && await context().b.guestRequest.count() === 1, 'DELAYED_RETRY_FAILED'); }
      finally { release(); spy.mockRestore(); }
      check((await pending).status === 200, 'DELAYED_RESPONSE_FAILED');
    });
    it('revokes only the guest session on logout and keeps secrets out of app logs, audit and storage', async () => {
      const current = await session(); const second = await session();
      const logout = await call('guest-connect/logout', 'POST', {}, current.cookie, current.csrf);
      check(logout.status === 204 && logout.setCookie?.includes('Max-Age=0') && !logout.setCookie.includes('vantara_session'), 'LOGOUT_COOKIE_SCOPE');
      check((await call('guest-connect/stay', 'GET', undefined, current.cookie)).status === 401 && (await call('guest-connect/stay', 'GET', undefined, second.cookie)).status === 200, 'LOGOUT_SCOPE');
      const db = context().a; const stored = JSON.stringify([await db.guestConnectAccess.findMany(), await db.guestConnectBootstrap.findMany(), await db.guestConnectSession.findMany(), await db.guestConnectIdempotency.findMany(), await db.auditLog.findMany()]);
      check(!secrets.some(secret => stored.includes(secret) || logs.some(log => log.includes(secret))), 'SECRET_LOG_OR_STORAGE_LEAK');
    });    it('preserves legacy Connect HTTP when the guest gate is disabled', async () => {
      delete process.env.CONNECT_GUEST_HTTP;
      try {
        const issued = await new ConnectService(context().a as any, {} as any).issue(tenant, res); secrets.push(issued.token);
        check((await call(`connect/${issued.token}`)).status === 200, 'LEGACY_READ_CHANGED');
        check((await call(`connect/${issued.token}/requests`, 'POST', body)).status === 201, 'LEGACY_CREATE_CHANGED');
        check((await call('guest-connect/session', 'POST', { code: opaque() })).status === 404, 'GATE_DEFAULT_CHANGED');
        // No keys configured: 503 proves raw bytes and signature reached the disabled verifier; missing rawBody would be400.
        check((await call('billing/webhooks/stripe', 'POST', '{\"synthetic\":true}', undefined, { 'stripe-signature': 'synthetic-not-a-signature' })).status === 503, 'LEGACY_RAW_BODY_PARSER_CHANGED');
      } finally { process.env.CONNECT_GUEST_HTTP = 'synthetic-https-only'; }
    });
    it('applies a bounded rate limit to actual HTTP exchange attempts', async () => {
      let result!: Result;
      for (let i = 0; i < 121; i++) result = await call('guest-connect/session', 'POST', { code: opaque() }, undefined, {}, 1);
      check(result.status === 429 && result.headers['retry-after'] === '60', 'RATE_LIMIT_MISSING');
    });

  });
}
