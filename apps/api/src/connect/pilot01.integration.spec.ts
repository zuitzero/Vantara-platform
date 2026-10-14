import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
// No compiler/build changes for the development-only fixture tool.
const { configuration, provision, ids, MARKER } = require('../../scripts/pilot01.cjs');
const integration = process.env.PILOT01_INTEGRATION === '1' ? describe : describe.skip;
function check(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }

integration('Pilot 01 real PostgreSQL / HTTP regression', () => {
  let app: INestApplication; let db: PrismaService; let base: string; let password: string;
  let cookieA: string; let cookieB: string; let reservationA: string; let reservationB: string;
  const logs: string[] = []; const sensitive: string[] = [];
  const envBefore = { ...process.env };
  async function api(path: string, method = 'GET', body?: unknown, cookie?: string) {
    const response = await fetch(`${base}/api/${path}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  beforeAll(async () => {
    // Check the dedicated local target BEFORE opening any connection. Random
    // ephemeral credentials for a synthetic-only database; never print them.
    password = process.env.PILOT01_PASSWORD ?? randomBytes(24).toString('base64url');
    process.env.PILOT01_PASSWORD = password;
    const config = configuration(process.env);
    db = new PrismaService({ datasources: { db: { url: config.url } } });
    await provision(db, 'setup', password); await provision(db, 'reset', password);
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db).compile();
    app = module.createNestApplication({ rawBody: true });
    app.useLogger({ log: (...items: unknown[]) => logs.push(items.map(String).join(' ')), error: (...items: unknown[]) => logs.push(items.map(String).join(' ')), warn: (...items: unknown[]) => logs.push(items.map(String).join(' ')) });
    app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    const a = await api('auth/login', 'POST', { email: ids('a').email, password });
    const b = await api('auth/login', 'POST', { email: ids('b').email, password });
    check(a.status === 201 && b.status === 201 && a.cookie && b.cookie, 'DEMO_LOGIN_FAILED');
    cookieA = a.cookie; cookieB = b.cookie;
    const [aStay, bStay] = await Promise.all(['a', 'b'].map(side => db.reservation.findFirst({ where: { tenantId: ids(side).tenant, notes: MARKER }, orderBy: { createdAt: 'desc' } })));
    check(aStay && bStay, 'DEMO_STAYS_MISSING'); reservationA = aStay.id; reservationB = bStay.id;
  }, 30000);
  afterAll(async () => { await app?.close(); await db?.$disconnect(); process.env = envBefore; });

  it('setup is idempotent; reset appends fresh stays and revokes old links without deleting history', async () => {
    const count = await db.reservation.count(); const users = await db.user.findMany({ select: { passwordHash: true } });
    await provision(db, 'setup', password); check(await db.reservation.count() === count, 'SETUP_NOT_IDEMPOTENT');
    check(JSON.stringify(users) === JSON.stringify(await db.user.findMany({ select: { passwordHash: true } })), 'SETUP_CHANGED_CREDENTIALS');
    let refused = false; try { await provision(db, 'reset', randomBytes(24).toString('hex')); } catch { refused = true; }
    check(refused && await db.reservation.count() === count, 'FOREIGN_PASSWORD_ADOPTED');
  });
  it('demonstrates guest -> persisted hotel notification -> accept/start/complete -> guest history', async () => {
    const issued = await api(`connect-admin/reservations/${reservationA}/access`, 'POST', undefined, cookieA);
    check(issued.status === 201, 'CONNECT_ISSUE_FAILED'); const token = issued.body.token; sensitive.push(token);
    const denied = await api(`connect/${token}/requests`, 'POST', { title: 'DEMO towels', message: 'Two synthetic towels', category: 'HOUSEKEEPING', tenantId: ids('b').tenant });
    check(denied.status === 400, 'CLIENT_TENANT_ACCEPTED');
    const request = await api(`connect/${token}/requests`, 'POST', { title: 'DEMO towels', message: 'Two synthetic towels', category: 'HOUSEKEEPING' });
    check(request.status === 201 && request.body.tenantId === ids('a').tenant && request.body.reservationId === reservationA, 'CONNECT_REQUEST_FAILED');
    const requestId = request.body.id;
    const notifications = await api('notifications/unread', 'GET', undefined, cookieA);
    check(notifications.status === 200 && notifications.body.some((row: any) => row.type === 'guest_request.created' && row.metadata.requestId === requestId), 'HOTEL_NOTIFICATION_MISSING');
    const foreignNotifications = await api('notifications', 'GET', undefined, cookieB);
    check(!foreignNotifications.body.some((row: any) => row.metadata?.requestId === requestId), 'NOTIFICATION_TENANT_LEAK');
    const foreignRead = await api(`requests/${requestId}`, 'GET', undefined, cookieB);
    const foreignWrite = await api(`requests/${requestId}`, 'PATCH', { status: 'COMPLETED' }, cookieB);
    check(foreignRead.status === 404 && foreignWrite.status === 404, 'REQUEST_TENANT_LEAK');
    for (const status of ['ACKNOWLEDGED', 'IN_PROGRESS', 'COMPLETED']) {
      const updated = await api(`requests/${requestId}`, 'PATCH', { status }, cookieA);
      const stay = await api(`connect/${token}`);
      check(updated.status === 200 && stay.status === 200 && stay.body.requests.some((row: any) => row.id === requestId && row.status === status), 'REQUEST_ROUND_TRIP_FAILED');
    }
    const task = await db.housekeepingTask.findFirst({ where: { tenantId: ids('a').tenant, title: 'DEMO towels' } });
    check(task && !task.blocksRoom, 'HOUSEKEEPING_SIDE_EFFECT_MISSING');
    check((await api(`requests/${requestId}`)).status === 401, 'HOTEL_AUTH_BYPASSED');
    const beforeReset = await db.reservation.count(); await provision(db, 'reset', password);
    check(await db.reservation.count() === beforeReset + 2 && await db.guestRequest.count({ where: { id: requestId } }) === 1, 'RESET_DELETED_HISTORY');
    check((await api(`connect/${token}`)).status === 404, 'RESET_LEFT_OLD_ACCESS_ACTIVE');
  });
  it('rejects cross-tenant issue/revoke/reservation reads; proves rotation, revocation and expiration for GET and POST', async () => {
    check((await api(`connect-admin/reservations/${reservationB}/access`, 'POST', undefined, cookieA)).status === 404, 'CONNECT_ISSUE_TENANT_LEAK');
    check((await api(`reservations/${reservationA}`, 'GET', undefined, cookieB)).status === 404, 'RESERVATION_TENANT_LEAK');
    const first = await api(`connect-admin/reservations/${reservationA}/access`, 'POST', undefined, cookieA);
    const second = await api(`connect-admin/reservations/${reservationA}/access`, 'POST', undefined, cookieA);
    check(first.status === 201 && second.status === 201 && first.body.token !== second.body.token, 'ROTATION_FAILED');
    sensitive.push(first.body.token, second.body.token);
    const input = { title: 'DEMO request', message: 'Synthetic only', category: 'AMENITIES' };
    for (const method of ['GET', 'POST']) check((await api(`connect/${first.body.token}${method === 'POST' ? '/requests' : ''}`, method, method === 'POST' ? input : undefined)).status === 404, 'ROTATED_ACCESS_VALID');
    check((await api(`connect/${second.body.token}`)).status === 200, 'NEW_ACCESS_INVALID');
    check((await api(`connect-admin/reservations/${reservationA}/access`, 'DELETE', undefined, cookieB)).status === 404, 'REVOCATION_TENANT_LEAK');
    check((await api(`connect-admin/reservations/${reservationA}/access`, 'DELETE', undefined, cookieA)).status === 200, 'REVOCATION_FAILED');
    for (const method of ['GET', 'POST']) check((await api(`connect/${second.body.token}${method === 'POST' ? '/requests' : ''}`, method, method === 'POST' ? input : undefined)).status === 404, 'REVOKED_ACCESS_VALID');
    const fresh = await api(`connect-admin/reservations/${reservationA}/access`, 'POST', undefined, cookieA); sensitive.push(fresh.body.token);
    await db.guestConnectAccess.update({ where: { reservationId: reservationA }, data: { expiresAt: new Date(0) } });
    for (const method of ['GET', 'POST']) check((await api(`connect/${fresh.body.token}${method === 'POST' ? '/requests' : ''}`, method, method === 'POST' ? input : undefined)).status === 404, 'EXPIRED_ACCESS_VALID');
    check(!logs.some(log => sensitive.some(token => log.includes(token))), 'TOKEN_IN_APPLICATION_LOGS');
    const audits = JSON.stringify(await db.auditLog.findMany()); check(!sensitive.some(token => audits.includes(token)), 'TOKEN_IN_AUDIT');
    const accesses = JSON.stringify(await db.guestConnectAccess.findMany()); check(!sensitive.some(token => accesses.includes(token)), 'RAW_TOKEN_PERSISTED');
  });
  const corruptions = ['property', 'guest', 'request', 'housekeeping', 'maintenance', 'notification', 'receipt', 'session', 'audit', 'reservation-link', 'guest-edit'];
  it.each(corruptions)('rejects foreign %s data before reset with a byte-equivalent database snapshot', async kind => {
    const a = (await db.reservation.findUnique({ where: { id: reservationA } }))!;
    const b = (await db.reservation.findUnique({ where: { id: reservationB } }))!;
    let cleanup: () => Promise<unknown>;
    const common = { tenantId: a.tenantId, propertyId: a.propertyId, roomId: a.roomId! };
    if (kind === 'property') {
      const row = await db.property.create({ data: { tenantId: a.tenantId, name: 'SYNTHETIC foreign property' } }); cleanup = () => db.property.delete({ where: { id: row.id } });
    } else if (kind === 'guest') {
      const row = await db.guest.create({ data: { tenantId: a.tenantId, propertyId: a.propertyId, firstName: 'SYNTHETIC outsider', lastName: 'Fixture', email: `sentinel-${randomUUID()}@example.invalid` } }); cleanup = () => db.guest.delete({ where: { id: row.id } });
    } else if (kind === 'request') {
      const row = await db.guestRequest.create({ data: { ...common, reservationId: a.id, guestId: b.guestId, title: 'DEMO inconsistent identity', message: 'Synthetic sentinel', category: 'AMENITIES' } }); cleanup = () => db.guestRequest.delete({ where: { id: row.id } });
    } else if (kind === 'housekeeping') {
      const row = await db.housekeepingTask.create({ data: { ...common, title: 'DEMO unlinked work', blocksRoom: false } }); cleanup = () => db.housekeepingTask.delete({ where: { id: row.id } });
    } else if (kind === 'maintenance') {
      const row = await db.maintenanceTicket.create({ data: { ...common, title: 'DEMO unlinked repair', description: 'Synthetic sentinel', blocksRoom: false } }); cleanup = () => db.maintenanceTicket.delete({ where: { id: row.id } });
    } else if (kind === 'notification') {
      const row = await db.notification.create({ data: { tenantId: a.tenantId, audience: 'HOTEL', severity: 'INFO', channel: 'IN_APP', type: 'foreign.synthetic', title: 'DEMO unlinked notification', message: 'Synthetic sentinel' } }); cleanup = () => db.notification.delete({ where: { id: row.id } });
    } else if (kind === 'receipt') {
      const notification = (await db.notification.findFirst({ where: { tenantId: a.tenantId, audience: 'HOTEL' } }))!;
      const row = await db.notificationRead.create({ data: { tenantId: a.tenantId, notificationId: notification.id, userId: ids('b').user } }); cleanup = () => db.notificationRead.delete({ where: { notificationId_userId: { notificationId: row.notificationId, userId: row.userId } } });
    } else if (kind === 'session') {
      const row = await db.session.create({ data: { userId: ids('a').user, activeTenantId: b.tenantId, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 1000) } }); cleanup = () => db.session.delete({ where: { id: row.id } });
    } else if (kind === 'audit') {
      const row = await db.auditLog.create({ data: { tenantId: a.tenantId, actorUserId: ids('b').user, action: 'READ', resourceType: 'reservation', resourceId: a.id } }); cleanup = () => db.auditLog.delete({ where: { id: row.id } });
    } else if (kind === 'reservation-link') {
      await db.reservation.update({ where: { id: a.id }, data: { guestId: b.guestId } }); cleanup = () => db.reservation.update({ where: { id: a.id }, data: { guestId: a.guestId } });
    } else {
      await db.guest.update({ where: { id: a.guestId }, data: { phone: 'SYNTHETIC foreign value' } }); cleanup = () => db.guest.update({ where: { id: a.guestId }, data: { phone: null } });
    }
    const snapshot = async () => {
      const rows = await Promise.all(Prisma.dmmf.datamodel.models.map(async model => {
        const name = model.name[0].toLowerCase() + model.name.slice(1);
        const entries = (await (db as any)[name].findMany()).map((row: unknown) => JSON.stringify(row)).sort();
        return `${name}:${createHash('sha256').update(JSON.stringify(entries)).digest('hex')}`;
      }));
      return rows.join('|'); // Hashes only: no credentials/tokens in assertion output.
    };
    try {
      const before = await snapshot();
      for (const command of ['reset', 'setup']) {
        let rejected = false; try { await provision(db, command, password); } catch { rejected = true; }
        check(rejected && before === await snapshot(), 'FOREIGN_DATA_MUTATED');
      }
    } finally { await cleanup(); }
  });
  it('refuses unrelated preexisting tenants without modifying their records', async () => {
    const unrelated = await db.tenant.create({ data: { name: 'SYNTHETIC collision sentinel', slug: 'synthetic-sentinel' } });
    const count = await db.reservation.count(); let refused = false;
    try { await provision(db, 'reset', password); } catch { refused = true; }
    check(refused && await db.reservation.count() === count && !!await db.tenant.findUnique({ where: { id: unrelated.id } }), 'UNRELATED_DATA_MODIFIED');
    // Remove only the empty sentinel created by this test, never reset a database.
    await db.tenant.delete({ where: { id: unrelated.id } });
  });
});

describe('Pilot 01 pre-connection safety guards', () => {
  const env = { NODE_ENV: 'test', PILOT01_DEMO: 'synthetic-local-only', DATABASE_URL: 'postgresql://vantara_pilot01_demo@localhost:5432/vantara_pilot01?schema=public', PILOT01_PASSWORD: randomBytes(24).toString('hex') };
  it.each([{ NODE_ENV: 'production' }, { NODE_ENV: '' }, { PILOT01_DEMO: '' }, { PILOT01_PASSWORD: '' }, { DATABASE_URL: 'postgresql://vantara_pilot01_demo@remote.example/vantara_pilot01' }, { DATABASE_URL: 'postgresql://vantara_pilot01_demo@localhost/vantara' }, { DATABASE_URL: 'postgresql://vantara_pilot01_demo@localhost/vantara_pilot01?host=production.example' }, { DATABASE_URL: 'postgresql://vantara_pilot01_demo@localhost/vantara_pilot01?schema=production' }, { STRIPE_SECRET_KEY: 'not-a-real-key' }, { PGHOST: 'remote.example' }, { PGSERVICE: 'production' }, { PGOPTIONS: '-c search_path=production' }, { PRISMA_ACCELERATE_URL: 'https://remote.example' }, { DATABASE_URL: 'postgresql://admin@localhost/vantara_pilot01' }, { DATABASE_URL: 'postgresql://vantara_pilot01_demo@localhost/vantara_pilot01#other' }])('rejects unsafe configuration before connection (%j)', change => { expect(() => configuration({ ...env, ...change })).toThrow(); });
  it('accepts explicit synthetic local development/test only', () => { expect(configuration(env).url).toBe(env.DATABASE_URL.replace('localhost', '127.0.0.1')); });
});
