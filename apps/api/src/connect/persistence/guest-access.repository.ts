/** Shared persistence for isolated guest session adapters. */
import { GuestConnectBootstrap, GuestConnectSession, Prisma, PrismaClient } from '@prisma/client';
import { assertGuestSession, BootstrapRecord, GUEST_PROTOCOL, GuestExchangeRepository, GuestProtocolDenied, GuestScope, GuestSessionRecord, isFingerprint, planExchange, StayAuthority } from '../protocol/guest-access.contracts';

type Tx = Prisma.TransactionClient;
type Database = Pick<PrismaClient, '$transaction'>;
export interface GuestPersistencePolicy { bootstrapTtlMs: number; sessionTtlMs: number; idleTtlMs: number; maxSessions: number }
const deny = (): never => { throw new GuestProtocolDenied(); };
// The access row's tokenHash is TEXT. Reserved roots cannot match any legacy SHA-256 lookup.
const SHOWROOM_ROOT = 'showroom-proof:';
export function isShowroomRoot(value: string) { return value.startsWith(SHOWROOM_ROOT); }

export const SHOWROOM_GUEST_POLICY = {
  bootstrapTtlMs: 5 * 60_000, sessionTtlMs: 60 * 60_000, idleTtlMs: 15 * 60_000, maxSessions: 1,
} as const;
export const SHOWROOM_GUEST_INVITE = 'connect.showroom.invite';
type Operator = { tenantId: string; userId: string; sessionHash: string };

export class GuestPayloadConflict extends GuestProtocolDenied {}
const scope = (r: GuestConnectBootstrap | GuestConnectSession): GuestScope => ({ tenantId: r.tenantId, propertyId: r.propertyId, reservationId: r.reservationId, accessId: r.accessId, generation: r.generation });
const bootstrap = (r: GuestConnectBootstrap): BootstrapRecord => ({ codeHash: r.codeHash, scope: scope(r), issuedAt: +r.issuedAt, expiresAt: +r.expiresAt, consumedAt: r.consumedAt && +r.consumedAt, revokedAt: r.revokedAt && +r.revokedAt });
const session = (r: GuestConnectSession): GuestSessionRecord => ({ kind: 'CONNECT_GUEST', secretHash: r.secretHash, scope: scope(r), createdAt: +r.createdAt, lastSeenAt: +r.lastSeenAt, expiresAt: +r.expiresAt, revokedAt: r.revokedAt && +r.revokedAt });

export class PostgresGuestAccessRepository implements GuestExchangeRepository {
  private readonly policy: Readonly<GuestPersistencePolicy>;
  constructor(private readonly db: Database, policy: GuestPersistencePolicy, private readonly mode: 'local' | 'showroom-proof' = 'local') {
    for (const key of ['bootstrapTtlMs', 'sessionTtlMs', 'idleTtlMs', 'maxSessions'] as const) {
      if (!policy || !Number.isSafeInteger(policy[key]) || policy[key] < 1 || policy[key] > GUEST_PROTOCOL[key]) deny();
    }
    this.policy = Object.freeze({ ...policy }); // Explicit candidate policy, no activation/env defaults.
  }

  private async transaction<T>(run: (tx: Tx) => Promise<T>, isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel.ReadCommitted): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
          await tx.$executeRaw`SET LOCAL statement_timeout = '8s'`;
          return run(tx);
        }, { isolationLevel, maxWait: 2000, timeout: 10000 });
      } catch (error) {
        if (error instanceof GuestPayloadConflict) throw error;
        const e = (error && typeof error === 'object' ? error : {}) as { code?: string; meta?: { code?: string } };
        if (attempt < 2 && (e.code === 'P2034' || ['40001', '40P01'].includes(e.meta?.code ?? ''))) continue;
        // No raw Prisma/SQL errors, query parameters, URLs or secrets escape this boundary.
        return deny();
      }
    }
    return deny();
  }
  private async time(tx: Tx): Promise<Date> {
    const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT date_trunc('milliseconds', clock_timestamp()) AS now`;
    return row.now;
  }
  private async lockAuthority(tx: Tx, tenantId: string, reservationId: string, rootHash?: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reservations WHERE id = ${reservationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length !== 1) return deny();
    let found = await tx.guestConnectAccess.findUnique({ where: { reservationId } });
    if (!found && rootHash && isFingerprint(rootHash)) {
      const stay = await tx.reservation.findFirstOrThrow({ where: { id: reservationId, tenantId } });
      found = await tx.guestConnectAccess.create({ data: { tenantId, reservationId, tokenHash: this.mode === 'showroom-proof' ? SHOWROOM_ROOT + rootHash : rootHash, expiresAt: stay.checkOut } });
    }
    if (!found || found.tenantId !== tenantId) return deny();
    const locks = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guest_connect_access WHERE id = ${found.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (locks.length !== 1) return deny();
    // Separate fresh READ COMMITTED reads after waits, not the earlier lookup snapshot.
    const access = await tx.guestConnectAccess.findUniqueOrThrow({ where: { id: found.id } });
    const binding = this.mode === 'showroom-proof' && isShowroomRoot(access.tokenHash)
      ? access.tokenHash.slice(SHOWROOM_ROOT.length)
      : this.mode === 'local' ? access.tokenHash : '';
    if (!isFingerprint(binding)) return deny();
    const r = await tx.reservation.findFirstOrThrow({ where: { id: reservationId, tenantId }, include: { tenant: true, property: true, guest: true, room: { select: { propertyId: true } }, roomType: { select: { propertyId: true } } } });
    if (this.mode === 'showroom-proof' &&
        (r.roomType.propertyId !== r.propertyId || (r.room && r.room.propertyId !== r.propertyId))) return deny();
    const authority: StayAuthority = { tenantType: r.tenant.type as 'HOTEL', tenantId, accessId: access.id, generation: access.generation,
      expiresAt: +access.expiresAt, revokedAt: access.revokedAt && +access.revokedAt,
      reservation: { id: r.id, tenantId: r.tenantId, propertyId: r.propertyId, status: r.status, checkOut: +r.checkOut },
      property: { id: r.property.id, tenantId: r.property.tenantId }, guest: { tenantId: r.guest.tenantId } };
    return { access, authority, binding, guestId: r.guestId };
  }

  private async mint(tx: Tx, live: Awaited<ReturnType<PostgresGuestAccessRepository['lockAuthority']>>, codeHash: string) {
    const { access, authority, guestId, binding } = live;
    const now = await this.time(tx);
    const expiresAt = new Date(Math.min(+now + this.policy.bootstrapTtlMs, authority.expiresAt, authority.reservation.checkOut));
    const candidate: BootstrapRecord = {
      codeHash, scope: { tenantId: authority.tenantId, reservationId: authority.reservation.id, propertyId: authority.property.id, accessId: access.id, generation: authority.generation },
      issuedAt: +now, expiresAt: +expiresAt, consumedAt: null, revokedAt: null,
    };
    planExchange(candidate, authority, +now);
    const record = await tx.guestConnectBootstrap.create({ data: { ...candidate.scope, guestId, legacyTokenHash: binding, codeHash, issuedAt: now, expiresAt } });
    planExchange(bootstrap(record), authority, +(await this.time(tx)));
    return record;
  }

  async createBootstrap(input: { tenantId: string; reservationId: string; codeHash: string; rootHash?: string }) {
    if (this.mode !== 'local' || !isFingerprint(input.codeHash)) return deny();
    return this.transaction(async tx => {
      const live = await this.lockAuthority(tx, input.tenantId, input.reservationId, input.rootHash);
      return this.mint(tx, live, input.codeHash);
    });
  }

  async manageShowroomAdmission(operator: Operator, reservationId: string, invitation?: { codeHash: string; rootHash: string }) {
    if (this.mode !== 'showroom-proof' || !isFingerprint(operator.sessionHash) ||
        (invitation && (!isFingerprint(invitation.codeHash) || !isFingerprint(invitation.rootHash)))) return deny();
    return this.transaction(async tx => {
      // A logout, membership removal, or role change cannot race a committed invitation.
      // Lock staff authority first, then preserve reservation -> access -> guest records order.
      const staff = await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id FROM sessions s
        JOIN memberships m ON m."userId" = s."userId" AND m."tenantId" = s."activeTenantId"
        JOIN tenants t ON t.id = m."tenantId"
        WHERE s."tokenHash" = ${operator.sessionHash} AND s."userId" = ${operator.userId}
          AND m."tenantId" = ${operator.tenantId} AND m.role = 'HOTEL_STAFF' AND t.type = 'HOTEL'
          AND s."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
        FOR SHARE OF s, m, t`;
      if (staff.length !== 1) return deny();
      const live = await this.lockAuthority(tx, operator.tenantId, reservationId, invitation?.rootHash);
      const active = await tx.session.findFirst({ where: { id: staff[0].id, expiresAt: { gt: await this.time(tx) } }, select: { id: true } });
      if (!active) return deny();
      // Serialize reissue and revoke against session exchange and writes. No legacy row qualifies.
      const access = await tx.guestConnectAccess.update({ where: { id: live.access.id }, data: { generation: { increment: 1 } } });
      const record = invitation
        ? await this.mint(tx, { ...live, access, authority: { ...live.authority, generation: access.generation } }, invitation.codeHash)
        : null;
      await tx.auditLog.create({ data: {
        tenantId: operator.tenantId, actorUserId: operator.userId, actorType: 'USER',
        action: invitation ? 'CREATE' : 'UPDATE', resourceType: 'showroom_guest_access', resourceId: reservationId,
        metadata: { reason: invitation ? 'SHOWROOM_INVITE_ISSUED' : 'SHOWROOM_ACCESS_REVOKED' },
      } });
      return record ? { expiresAt: record.expiresAt } : null;
    });
  }

  // Phase 1's reference clock parameter is deliberately NOT used. Only DB time is authoritative.
  async exchangeOnce(input: { codeHash: string; freshSessionHash: string }): Promise<GuestSessionRecord> {
    if (!isFingerprint(input.codeHash) || !isFingerprint(input.freshSessionHash)) return deny();
    return this.transaction(async tx => {
      const found = await tx.guestConnectBootstrap.findUnique({ where: { codeHash: input.codeHash } });
      if (!found) return deny();
      const live = await this.lockAuthority(tx, found.tenantId, found.reservationId);
      await tx.$queryRaw`SELECT id FROM guest_connect_bootstraps WHERE id = ${found.id} FOR UPDATE`;
      const record = await tx.guestConnectBootstrap.findUniqueOrThrow({ where: { id: found.id } });
      if (record.legacyTokenHash !== live.binding || record.guestId !== live.guestId) return deny();
      const now = await this.time(tx);
      const plan = planExchange(bootstrap(record), live.authority, +now);
      const count = await tx.guestConnectSession.count({ where: { accessId: live.access.id, generation: live.access.generation,
        guestId: live.guestId, propertyId: live.authority.property.id,
        legacyTokenHash: live.binding, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(+now - this.policy.idleTtlMs) } } });
      if (count >= this.policy.maxSessions) return deny();
      const changed = await tx.$executeRaw`UPDATE guest_connect_bootstraps SET "consumedAt" = ${now} WHERE id = ${record.id} AND "consumedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')`;
      if (changed !== 1) return deny();
      const created = await tx.guestConnectSession.create({ data: { ...plan.scope, bootstrapId: record.id, guestId: record.guestId, legacyTokenHash: record.legacyTokenHash,
        secretHash: input.freshSessionHash, createdAt: now, lastSeenAt: now, expiresAt: new Date(Math.min(plan.expiresAt, +now + this.policy.sessionTtlMs)) } });
      const finalNow = +(await this.time(tx));
      if (finalNow >= +record.expiresAt) return deny();
      assertGuestSession(session(created), live.authority, finalNow);
      return session(created); // Deferred DB triggers also check expiry at COMMIT.
    });
  }

  async checkSession(secretHash: string): Promise<GuestScope> {
    if (!isFingerprint(secretHash)) return deny();
    return this.transaction(async tx => {
      const found = await tx.guestConnectSession.findUnique({ where: { secretHash } });
      if (!found) return deny();
      const live = await this.lockAuthority(tx, found.tenantId, found.reservationId);
      await tx.$queryRaw`SELECT id FROM guest_connect_sessions WHERE id = ${found.id} FOR UPDATE`;
      const row = await tx.guestConnectSession.findUniqueOrThrow({ where: { id: found.id } });
      const now = +(await this.time(tx));
      if (row.legacyTokenHash !== live.binding || row.guestId !== live.guestId || +row.lastSeenAt + this.policy.idleTtlMs <= now || +row.createdAt + this.policy.sessionTtlMs <= now) return deny();
      const result = assertGuestSession(session(row), live.authority, now);
      await tx.guestConnectSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date(now) } });
      return result;
    });
  }

  // Trusted server callback only: authorization and operational writes share one retryable transaction.
  async withSession<T>(secretHash: string, run: (tx: Tx, scope: GuestScope, guestId: string) => Promise<T>): Promise<T> {
    if (!isFingerprint(secretHash)) return deny();
    return this.transaction(async tx => {
      const found = await tx.guestConnectSession.findUnique({ where: { secretHash } });
      if (!found) return deny();
      const live = await this.lockAuthority(tx, found.tenantId, found.reservationId);
      await tx.$queryRaw`SELECT id FROM guest_connect_sessions WHERE id = ${found.id} FOR UPDATE`;
      const row = await tx.guestConnectSession.findUniqueOrThrow({ where: { id: found.id } });
      const validate = async () => {
        const now = +(await this.time(tx));
        if (row.legacyTokenHash !== live.binding || row.guestId !== live.guestId || +row.lastSeenAt + this.policy.idleTtlMs <= now || +row.createdAt + this.policy.sessionTtlMs <= now) return deny();
        return { scope: assertGuestSession(session(row), live.authority, now), now };
      };
      const before = await validate();
      const result = await run(tx, before.scope, live.guestId);
      const after = await validate();
      await tx.guestConnectSession.update({ where: { id: row.id }, data: { lastSeenAt: new Date(after.now) } });
      return result;
    }, Prisma.TransactionIsolationLevel.Serializable);
  }

  async revokeSession(secretHash: string): Promise<void> {
    if (!isFingerprint(secretHash)) return deny();
    return this.transaction(async tx => {
      const row = await tx.guestConnectSession.findUnique({ where: { secretHash } });
      if (!row) return deny();
      await this.lockAuthority(tx, row.tenantId, row.reservationId);
      await tx.$queryRaw`SELECT id FROM guest_connect_sessions WHERE id = ${row.id} FOR UPDATE`;
      await tx.guestConnectSession.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: await this.time(tx) } });
    });
  }

  // Guest-only invalidation. Does not change tokenHash/revokedAt or any legacy link semantics.
  async advanceGeneration(tenantId: string, reservationId: string): Promise<void> {
    return this.transaction(async tx => {
      if (this.mode !== 'local') return deny();
      const { access, authority } = await this.lockAuthority(tx, tenantId, reservationId);
      if (authority.tenantType !== 'HOTEL') return deny();
      await tx.guestConnectAccess.update({ where: { id: access.id }, data: { generation: { increment: 1 } } });
    });
  }
}
