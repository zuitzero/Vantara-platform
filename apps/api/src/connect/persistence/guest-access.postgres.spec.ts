import { guestBrowserTests } from '../http/guest-browser.postgres';
import { guestHttpTests } from '../http/guest-http.postgres';
import { Prisma, PrismaClient } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PostgresGuestAccessRepository } from './guest-access.repository';
import { GUEST_PROTOCOL, GuestExchangeRepository, GuestProtocolDenied } from '../protocol/guest-access.contracts';
import { ConnectService } from '../connect.service';
import { ReservationsService } from '../../reservations/reservations.service';
import { RoomReadinessService } from '../../room-readiness/room-readiness.service';
const { configuration, verify } = require('../../../scripts/connect-sec02-target.cjs');
const integration = process.env.CONNECT_SEC02_DB_TEST === '1' ? describe : describe.skip;
const fingerprint = () => createHash('sha256').update(randomBytes(32)).digest('hex');
const ok = (p: Promise<unknown>) => p.then(() => true, () => false); // Never report raw returned credentials/errors.
const policy = { bootstrapTtlMs: GUEST_PROTOCOL.bootstrapTtlMs, sessionTtlMs: GUEST_PROTOCOL.sessionTtlMs, idleTtlMs: GUEST_PROTOCOL.idleTtlMs, maxSessions: GUEST_PROTOCOL.maxSessions };

integration('CONNECT-SEC-02 real PostgreSQL18: distinct backend connections', () => {
  let a: PrismaClient, b: PrismaClient, blocker: PrismaClient, monitor: PrismaClient;
  let repoA: PostgresGuestAccessRepository, repoB: PostgresGuestAccessRepository;
  let pidA: number, pidB: number;
  const res = 'cs02-res-a', tenant = 'cs02-a';
  beforeAll(async () => {
    const base = configuration(process.env);
    const client = (name: string) => {
      const url = new URL(base); url.searchParams.set('connection_limit', '1'); url.searchParams.set('application_name', name);
      return new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
    };
    a = client('connect-sec02-a'); b = client('connect-sec02-b'); blocker = client('connect-sec02-blocker'); monitor = client('connect-sec02-monitor');
    await Promise.all([a, b, blocker, monitor].map(async db => { await db.$connect(); await verify(db); }));
    for (const model of Prisma.dmmf.datamodel.models) expect(await (a as any)[model.name[0].toLowerCase() + model.name.slice(1)].count()).toBe(0);
    [pidA, pidB] = await Promise.all([a, b].map(async db => (await db.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`)[0].pid));
    expect(pidA).not.toBe(pidB);
    repoA = new PostgresGuestAccessRepository(a, policy); repoB = new PostgresGuestAccessRepository(b, policy);
  }, 30000);
  afterAll(async () => { await Promise.all([a, b, blocker, monitor].filter(Boolean).map(db => db.$disconnect())); });
  beforeEach(async () => {
    await a.guestConnectIdempotency.deleteMany(); await a.guestConnectSession.deleteMany(); await a.guestConnectBootstrap.deleteMany();
    await a.guestRequest.deleteMany(); await a.housekeepingTask.deleteMany(); await a.maintenanceTicket.deleteMany();
    await a.auditLog.deleteMany(); await a.user.deleteMany({ where: { id: 'cs02-staff' } }); await a.tenant.deleteMany({ where: { id: { in: ['cs02-a', 'cs02-b'] } } });
    for (const side of ['a', 'b']) {
      const id = `cs02-${side}`;
      await a.tenant.create({ data: { id, name: 'SYNTHETIC', slug: id, type: 'HOTEL' } });
      await a.property.create({ data: { id: `${id}-property`, tenantId: id, name: 'SYNTHETIC' } });
      await a.roomType.create({ data: { id: `${id}-type`, propertyId: `${id}-property`, name: 'SYNTHETIC', code: 'SYNTHETIC' } });
      await a.room.create({ data: { id: `${id}-room`, propertyId: `${id}-property`, roomTypeId: `${id}-type`, number: '101', occupancyStatus: 'OCCUPIED', readinessStatus: 'READY' } });
      await a.guest.create({ data: { id: `${id}-guest`, tenantId: id, propertyId: `${id}-property`, roomId: `${id}-room`, firstName: 'SYNTHETIC', lastName: 'SYNTHETIC', email: `${side}@example.invalid` } });
      await a.reservation.create({ data: { id: `cs02-res-${side}`, tenantId: id, propertyId: `${id}-property`, guestId: `${id}-guest`, roomTypeId: `${id}-type`, roomId: `${id}-room`, confirmationCode: `SYNTHETIC-${side}`, status: 'CHECKED_IN', checkIn: new Date(Date.now() - 3600000), checkOut: new Date(Date.now() + 86400000) } });
      await a.guestConnectAccess.create({ data: { id: `${id}-access`, tenantId: id, reservationId: `cs02-res-${side}`, tokenHash: fingerprint(), expiresAt: new Date(Date.now() + 86400000) } });
    }
    await a.property.create({ data: { id: 'cs02-a-other', tenantId: tenant, name: 'SYNTHETIC OTHER' } });
  });
  const mint = (repo = repoA) => repo.createBootstrap({ tenantId: tenant, reservationId: res, codeHash: fingerprint() });
  const exchange = (repo: PostgresGuestAccessRepository, codeHash: string, freshSessionHash = fingerprint()) => repo.exchangeOnce({ codeHash, freshSessionHash });
  async function blocked(pid: number) {
    for (let i = 0; i < 200; i++) {
      const [row] = await monitor.$queryRaw<{ waiting: boolean }[]>`SELECT cardinality(pg_blocking_pids(${pid}::int)) > 0 AS waiting`;
      if (row.waiting) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('EXPECTED_DATABASE_LOCK_WAIT_NOT_OBSERVED');
  }
  async function until(deadline: Date) {
    for (;;) {
      const [row] = await monitor.$queryRaw<{ passed: boolean }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') > ${deadline} AS passed`;
      if (row.passed) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
  async function queue(lock: 'reservation' | 'access', first: () => Promise<unknown>, second: () => Promise<unknown>) {
    let one!: Promise<boolean>, two!: Promise<boolean>;
    await blocker.$transaction(async tx => {
      if (lock === 'reservation') await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${res} FOR UPDATE`;
      else await tx.$queryRaw`SELECT id FROM guest_connect_access WHERE "reservationId" = ${res} FOR UPDATE`;
      one = ok(first()); await blocked(pidA); two = ok(second()); await blocked(pidB);
    }, { timeout: 10000 });
    return Promise.all([one, two]);
  }

  it('has two distinct real backend PIDs and one winner for same-code contention/replay', async () => {
    const code = await mint();
    expect(await queue('reservation', () => exchange(repoA, code.codeHash), () => exchange(repoB, code.codeHash))).toEqual([true, false]);
    expect(await a.guestConnectSession.count()).toBe(1);
    await expect(exchange(repoB, code.codeHash)).rejects.toThrow(GuestProtocolDenied);
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: code.id } })).consumedAt).not.toBeNull();
  });
  it('serializes different codes at the three-device cap and frees a slot on logout', async () => {
    const firstHash = fingerprint(); await exchange(repoA, (await mint()).codeHash, firstHash); await exchange(repoA, (await mint()).codeHash);
    const one = await mint(), two = await mint();
    expect(await queue('reservation', () => exchange(repoA, one.codeHash), () => exchange(repoB, two.codeHash))).toEqual([true, false]);
    expect(await a.guestConnectSession.count()).toBe(3);
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: two.id } })).consumedAt).toBeNull();
    await repoA.revokeSession(firstHash); await expect(exchange(repoB, two.codeHash)).resolves.toHaveProperty('kind', 'CONNECT_GUEST');
  });
  it('rolls consumption back when the real session unique insert fails', async () => {
    const sessionHash = fingerprint(); await exchange(repoA, (await mint()).codeHash, sessionHash);
    const next = await mint(); await expect(exchange(repoB, next.codeHash, sessionHash)).rejects.toThrow('GUEST_ACCESS_DENIED');
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: next.id } })).consumedAt).toBeNull();
    expect(await a.guestConnectSession.count()).toBe(1);
    await expect(exchange(repoB, next.codeHash)).resolves.toHaveProperty('kind', 'CONNECT_GUEST');
  });
  it('rejects code expiry while waiting even though transaction-start time was valid', async () => {
    const short = new PostgresGuestAccessRepository(b, { ...policy, bootstrapTtlMs: 2000 }); const code = await mint(short);
    let pending!: Promise<boolean>;
    await blocker.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${res} FOR UPDATE`;
      pending = ok(exchange(short, code.codeHash)); await blocked(pidB);
      const [row] = await monitor.$queryRaw<{ beganBeforeExpiry: boolean }[]>`SELECT xact_start < ${code.expiresAt}::timestamp AT TIME ZONE 'UTC' AS "beganBeforeExpiry" FROM pg_stat_activity WHERE pid = ${pidB}`;
      expect(row.beganBeforeExpiry).toBe(true); await until(code.expiresAt);
    }, { timeout: 10000 });
    expect(await pending).toBe(false); expect(await a.guestConnectSession.count()).toBe(0);
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: code.id } })).consumedAt).toBeNull();
  });
  it('rejects expiry at real COMMIT after repository preflight completed and rolls both writes back', async () => {
    const code = await mint(new PostgresGuestAccessRepository(a, { ...policy, bootstrapTtlMs: 2000 }));
    let ready!: () => void, release!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
    // Test-only barrier around a REAL transaction; no repository query/storage is mocked.
    const paused = { $transaction: (run: any, options: any) => b.$transaction(async tx => { const result = await run(tx); ready(); await wait; return result; }, options) };
    const pending = ok(exchange(new PostgresGuestAccessRepository(paused as any, policy), code.codeHash));
    await entered;
    try { expect(await a.guestConnectSession.count()).toBe(0); await until(code.expiresAt); } finally { release(); }
    expect(await pending).toBe(false); expect(await a.guestConnectSession.count()).toBe(0);
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: code.id } })).consumedAt).toBeNull();
  });
  it('rejects session expiry after an observed lock wait without refreshing it', async () => {
    const short = new PostgresGuestAccessRepository(b, { ...policy, sessionTtlMs: 2000 }); const hash = fingerprint();
    await exchange(short, (await mint()).codeHash, hash);
    const row = await a.guestConnectSession.findUniqueOrThrow({ where: { secretHash: hash } }); let pending!: Promise<boolean>;
    await blocker.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${res} FOR UPDATE`;
      pending = ok(short.checkSession(hash)); await blocked(pidB); await until(row.expiresAt);
    }, { timeout: 10000 });
    expect(await pending).toBe(false);
    expect((await a.guestConnectSession.findUniqueOrThrow({ where: { id: row.id } })).lastSeenAt).toEqual(row.lastSeenAt);
  });
  it('orders generation advance before a queued exchange without changing the legacy bearer', async () => {
    const code = await mint(), old = await a.guestConnectAccess.findUniqueOrThrow({ where: { reservationId: res } });
    expect(await queue('reservation', () => repoA.advanceGeneration(tenant, res), () => exchange(repoB, code.codeHash))).toEqual([true, false]);
    const root = await a.guestConnectAccess.findUniqueOrThrow({ where: { reservationId: res } });
    expect(root.generation).toBe(2); expect(root.tokenHash).toBe(old.tokenHash); expect(root.revokedAt).toBeNull();
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: code.id } })).generation).toBe(1);
  });
  it.each(['revoke', 'rotate'])('rereads parent state after actual legacy %s wins its access lock', async operation => {
    const code = await mint(), secretHash = fingerprint(); await exchange(repoA, (await mint()).codeHash, secretHash);
    const legacy = new ConnectService(a as any, {} as any);
    expect(await queue('access', () => operation === 'revoke' ? legacy.revoke(tenant, res) : legacy.issue(tenant, res), () => exchange(repoB, code.codeHash))).toEqual([true, false]);
    await expect(repoB.checkSession(secretHash)).rejects.toThrow(GuestProtocolDenied);
    expect((await a.guestConnectAccess.findUniqueOrThrow({ where: { reservationId: res } })).generation).toBe(2);
  });
  it('orders actual checkout side effects before queued exchange and denies an earlier session', async () => {
    const hash = fingerprint(); await exchange(repoA, (await mint()).codeHash, hash); const code = await mint();
    const service = new ReservationsService(a as any, new RoomReadinessService(a as any));
    expect(await queue('reservation', () => service.updateStatusForTenant(tenant, res, 'CHECKED_OUT'), () => exchange(repoB, code.codeHash))).toEqual([true, false]);
    await expect(repoB.checkSession(hash)).rejects.toThrow(GuestProtocolDenied);
    expect((await a.room.findUniqueOrThrow({ where: { id: 'cs02-a-room' } })).occupancyStatus).toBe('VACANT');
    expect(await a.housekeepingTask.count()).toBe(1);
  });
  it.each(['revoke', 'rotate'])('invalidates a session when actual legacy %s commits after the queued exchange', async operation => {
    const code = await mint(), hash = fingerprint(); const legacy = new ConnectService(b as any, {} as any);
    expect(await queue('access', () => exchange(repoA, code.codeHash, hash), () => operation === 'revoke' ? legacy.revoke(tenant, res) : legacy.issue(tenant, res))).toEqual([true, true]);
    expect(await a.guestConnectSession.count()).toBe(1);
    await expect(repoA.checkSession(hash)).rejects.toThrow(GuestProtocolDenied);
  });
  it('invalidates a session when actual checkout commits after the queued exchange', async () => {
    const code = await mint(), hash = fingerprint(); const service = new ReservationsService(b as any, new RoomReadinessService(b as any));
    expect(await queue('reservation', () => exchange(repoA, code.codeHash, hash), () => service.updateStatusForTenant(tenant, res, 'CHECKED_OUT'))).toEqual([true, true]);
    expect(await a.guestConnectSession.count()).toBe(1);
    await expect(repoA.checkSession(hash)).rejects.toThrow(GuestProtocolDenied);
    expect((await a.reservation.findUniqueOrThrow({ where: { id: res } })).status).toBe('CHECKED_OUT');
  });
  it('retains committed session history when rotation follows exchange, but prevents further use', async () => {
    const hash = fingerprint(); await exchange(repoA, (await mint()).codeHash, hash); await repoB.advanceGeneration(tenant, res);
    expect(await a.guestConnectSession.count()).toBe(1); await expect(repoA.checkSession(hash)).rejects.toThrow(GuestProtocolDenied);
    await expect(exchange(repoB, (await mint()).codeHash)).resolves.toHaveProperty('kind', 'CONNECT_GUEST');
  });
  it.each([['a', 'b'], ['b', 'a']])('rejects hotel %s ownership of hotel %s reservation', async (own, foreign) => {
    const before = await a.guestConnectBootstrap.count();
    await expect(repoA.createBootstrap({ tenantId: `cs02-${own}`, reservationId: `cs02-res-${foreign}`, codeHash: fingerprint() })).rejects.toThrow(GuestProtocolDenied);
    await expect(repoB.advanceGeneration(`cs02-${own}`, `cs02-res-${foreign}`)).rejects.toThrow(GuestProtocolDenied);
    expect(await a.guestConnectBootstrap.count()).toBe(before);
  });
  it('enforces hash uniqueness, tenant/access/property/guest FKs and immutable snapshots', async () => {
    const code = await mint();
    await expect(repoB.createBootstrap({ tenantId: 'cs02-b', reservationId: 'cs02-res-b', codeHash: code.codeHash })).rejects.toThrow(GuestProtocolDenied);
    for (const patch of [{ tenantId: 'cs02-b' }, { reservationId: 'cs02-res-b' }, { propertyId: 'cs02-b-property' }, { guestId: 'cs02-b-guest' }, { codeHash: 'malformed' }]) {
      await expect(a.guestConnectBootstrap.create({ data: { ...code, id: randomUUID(), codeHash: fingerprint(), ...patch } })).rejects.toThrow();
    }
    await expect(a.guestConnectBootstrap.update({ where: { id: code.id }, data: { generation: 2 } })).rejects.toThrow();
    await expect(a.guestConnectAccess.update({ where: { reservationId: res }, data: { generation: 0 } })).rejects.toThrow();
    await repoA.advanceGeneration(tenant, res);
    await expect(a.guestConnectAccess.update({ where: { reservationId: res }, data: { generation: 1 } })).rejects.toThrow();
    expect(await a.guestConnectBootstrap.count()).toBe(1);
  });
  it('denies a same-tenant wrong-property snapshot at the repository boundary', async () => {
    const code = await mint(); const poisoned = await a.guestConnectBootstrap.create({ data: { ...code, id: randomUUID(), codeHash: fingerprint(), propertyId: 'cs02-a-other' } });
    await expect(exchange(repoB, poisoned.codeHash)).rejects.toThrow(GuestProtocolDenied);
    expect((await a.guestConnectBootstrap.findUniqueOrThrow({ where: { id: poisoned.id } })).consumedAt).toBeNull();
  });
  it('ignores caller clocks and never authenticates a staff/session hash or unknown hash', async () => {
    const code = await mint(); const hash = fingerprint();
    const result = await (repoA as GuestExchangeRepository).exchangeOnce({ codeHash: code.codeHash, freshSessionHash: hash, now: 0 });
    expect(result.createdAt).toBeGreaterThan(0);
    const staffHash = fingerprint();
    await a.user.create({ data: { id: 'cs02-staff', name: 'SYNTHETIC', email: 'staff@example.invalid', passwordHash: 'disabled-synthetic-only', memberships: { create: { tenantId: tenant, role: 'HOTEL_STAFF' } } } });
    await a.session.create({ data: { userId: 'cs02-staff', activeTenantId: tenant, tokenHash: staffHash, expiresAt: new Date(Date.now() + 86400000) } });
    await expect(repoB.checkSession(staffHash)).rejects.toThrow(GuestProtocolDenied);
    await expect(repoB.checkSession(fingerprint())).rejects.toThrow(GuestProtocolDenied);
    await expect(repoB.checkSession(hash)).resolves.toHaveProperty('tenantId', tenant);
  });
  it('reserves idempotency scope/payload uniqueness and rejects a foreign result reference', async () => {
    const claim = await a.guestConnectIdempotency.create({ data: { accessId: 'cs02-a-access', tenantId: tenant, reservationId: res, generation: 1, keyHash: fingerprint(), payloadHash: fingerprint() } });
    await expect(a.guestConnectIdempotency.create({ data: { ...claim, id: randomUUID() } })).rejects.toThrow();
    await expect(a.guestConnectIdempotency.update({ where: { id: claim.id }, data: { payloadHash: fingerprint() } })).rejects.toThrow();
    const foreign = await a.guestRequest.create({ data: { tenantId: 'cs02-b', reservationId: 'cs02-res-b', propertyId: 'cs02-b-property', guestId: 'cs02-b-guest', title: 'SYNTHETIC', message: 'SYNTHETIC', category: 'OTHER' } });
    await expect(a.guestConnectIdempotency.update({ where: { id: claim.id }, data: { resultRequestId: foreign.id } })).rejects.toThrow();
  });
  guestHttpTests(() => ({ a, b, blocker, monitor, pidA, pidB, queue, blocked, mint }));
  if (process.env.CONNECT_SEC04_PLAYWRIGHT) guestBrowserTests(() => a);

});
