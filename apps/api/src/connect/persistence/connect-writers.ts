import { Prisma, PrismaClient } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

// Legacy issuer/revoker now follow the same reservation -> access order as guest sessions.
// Checkout already updates (and locks) reservation before room/work writes; terminal stays cannot reopen.
export async function coordinatedConnectWrite<T>(db: Pick<PrismaClient, '$transaction'>, tenantId: string, reservationId: string, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM reservations WHERE id = ${reservationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM guest_connect_access WHERE "reservationId" = ${reservationId} AND "tenantId" = ${tenantId} FOR UPDATE`;
        return run(tx);
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 2000, timeout: 10000 });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      if (attempt === 2) throw new ConflictException('Connect access changed. Retry.');
    }
  }
  throw new ConflictException('Connect access changed. Retry.');
}
