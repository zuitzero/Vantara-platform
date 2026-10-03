import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoomReadinessStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RoomReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  // Caller owns the transaction; every operational writer uses Serializable.
  async recalculate(tx: Prisma.TransactionClient, tenantId: string, roomId: string) {
    const room = await tx.room.findFirst({ where: { id: roomId, property: { tenantId } } });
    if (!room) throw new NotFoundException('Room not found.');
    const maintenance = await tx.maintenanceTicket.count({ where: {
      tenantId, roomId, blocksRoom: true, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
    } });
    const housekeeping = await tx.housekeepingTask.count({ where: {
      tenantId, roomId, blocksRoom: true, status: { in: ['PENDING', 'ASSIGNED', 'IN_PROGRESS'] },
    } });
    const readinessStatus = room.outOfServiceLocked ? RoomReadinessStatus.OUT_OF_SERVICE
      : maintenance > 0 ? RoomReadinessStatus.MAINTENANCE
      : housekeeping > 0 ? RoomReadinessStatus.CLEANING : RoomReadinessStatus.READY;
    return tx.room.update({ where: { id: roomId, property: { tenantId } },
      data: { readinessStatus }, include: { property: true, roomType: true } });
  }

  async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
        if (attempt === 2) throw new ConflictException('Room operations changed concurrently. Refresh and retry.');
      }
    }
    throw new ConflictException('Refresh and retry.');
  }
}
