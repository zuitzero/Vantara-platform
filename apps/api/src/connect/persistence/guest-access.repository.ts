/** Inactive PostgreSQL persistence. Intentionally absent from all Nest modules/controllers. */
import { GuestConnectBootstrap, GuestConnectSession, Prisma, PrismaClient } from '@prisma/client';
import { assertGuestSession, BootstrapRecord, GUEST_PROTOCOL, GuestExchangeRepository, GuestProtocolDenied, GuestScope, GuestSessionRecord, isFingerprint, planExchange, StayAuthority } from '../protocol/guest-access.contracts';

type Tx = Prisma.TransactionClient;
type Database = Pick<PrismaClient, '$transaction'>;
export interface GuestPersistencePolicy { bootstrapTtlMs: number; sessionTtlMs: number; idleTtlMs: number; maxSessions: number }
const deny = (): never => { throw new GuestProtocolDenied(); };
export class GuestPayloadConflict extends GuestProtocolDenied {}
const scope = (r: GuestConnectBootstrap | GuestConnectSession): GuestScope => ({ tenantId: r.tenantId, propertyId: r.propertyId, reservationId: r.reservationId, accessId: r.accessId, generation: r.generation });
const bootstrap = (r: GuestConnectBootstrap): BootstrapRecord => ({ codeHash: r.codeHash, scope: scope(r), issuedAt: +r.issuedAt, expiresAt: +r.expiresAt, consumedAt: r.consumedAt && +r.consumedAt, revokedAt: r.revokedAt && +r.revokedAt });
const session = (r: GuestConnectSession): GuestSessionRecord => ({ kind: 'CONNECT_GUEST', secretHash: r.secretHash, scope: scope(r), createdAt: +r.createdAt, lastSeenAt: +r.lastSeenAt, expiresAt: +r.expiresAt, revokedAt: r.revokedAt && +r.revokedAt });

export class PostgresGuestAccessRepository implements GuestExchangeRepository {
  private readonly policy: Readonly<GuestPersistencePolicy>;
  constructor(private readonly db: Database, policy: GuestPersistencePolicy) {
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
      found = await tx.guestConnectAccess.create({ data: { tenantId, reservationId, tokenHash: rootHash, expiresAt: stay.checkOut } });
    }
    if (!found || found.tenantId !== tenantId) return deny();
    const locks = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM guest_connect_access WHERE id = ${found.id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (locks.length !== 1) return deny();
    // Separate fresh READ COMMITTED reads after waits, not the earlier lookup snapshot.
    const access = await tx.guestConnectAccess.findUniqueOrThrow({ where: { id: found.id } });
    const r = await tx.reservation.findFirstOrThrow({ where: { id: reservationId, tenantId }, include: { tenant: true, property: true, guest: true } });
    const authority: StayAuthority = { tenantType: r.tenant.type as 'HOTEL', tenantId, accessId: access.id, generation: access.generation,
      expiresAt: +access.expiresAt, revokedAt: access.revokedAt && +access.revokedAt,
      reservation: { id: r.id, tenantId: r.tenantId, propertyId: r.propertyId, status: r.status, checkOut: +r.checkOut },
      property: { id: r.property.id, tenantId: r.property.tenantId }, guest: { tenantId: r.guest.tenantId } };
    return { access, authority, guestId: r.guestId };
  }

  async createBootstrap(input: { tenantId: string; reservationId: string; codeHash: string; rootHash?: string }) {
    if (!isFingerprint(input.codeHash)) return deny();
    return this.transaction(async tx => {
      const { access, authority, guestId } = await this.lockAuthority(tx, input.tenantId, input.reservationId, input.rootHash);
      if (!isFingerprint(access.tokenHash)) return deny();
      const now = await this.time(tx);
      const expiresAt = new Date(Math.min(+now + this.policy.bootstrapTtlMs, authority.expiresAt, authority.reservation.checkOut));
      const candidate: BootstrapRecord = { codeHash: input.codeHash, scope: { tenantId: input.tenantId, reservationId: input.reservationId, propertyId: authority.property.id, accessId: access.id, generation: access.generation }, issuedAt: +now, expiresAt: +expiresAt, consumedAt: null, revokedAt: null };
      planExchange(candidate, authority, +now);
      const record = await tx.guestConnectBootstrap.create({ data: { ...candidate.scope, guestId, legacyTokenHash: access.tokenHash, codeHash: input.codeHash, issuedAt: now, expiresAt } });
      planExchange(bootstrap(record), authority, +(await this.time(tx)));
      return record; // Private persistence record, never a wire DTO.
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
      if (record.legacyTokenHash !== live.access.tokenHash || record.guestId !== live.guestId) return deny();
      const now = await this.time(tx);
      const plan = planExchange(bootstrap(record), live.authority, +now);
      const count = await tx.guestConnectSession.count({ where: { accessId: live.access.id, generation: live.access.generation,
        guestId: live.guestId, propertyId: live.authority.property.id,
        legacyTokenHash: live.access.tokenHash, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(+now - this.policy.idleTtlMs) } } });
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
      if (row.legacyTokenHash !== live.access.tokenHash || row.guestId !== live.guestId || +row.lastSeenAt + this.policy.idleTtlMs <= now || +row.createdAt + this.policy.sessionTtlMs <= now) return deny();
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
        if (row.legacyTokenHash !== live.access.tokenHash || row.guestId !== live.guestId || +row.lastSeenAt + this.policy.idleTtlMs <= now || +row.createdAt + this.policy.sessionTtlMs <= now) return deny();
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
      const { access, authority } = await this.lockAuthority(tx, tenantId, reservationId);
      if (authority.tenantType !== 'HOTEL') return deny();
      await tx.guestConnectAccess.update({ where: { id: access.id }, data: { generation: { increment: 1 } } });
    });
  }
}
