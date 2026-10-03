import { RoomReadinessService } from '../room-readiness/room-readiness.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GuestRequestCategory,
  GuestRequestPriority,
  GuestRequestStatus,
  OperationsPriority,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateGuestRequestDto, UpdateGuestRequestDto } from './requests.dto';
import { guestRequestCreatedEvent } from './requests.notifications';
import { guestRequestStatusNotification } from './requests.events';

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly readiness: RoomReadinessService,
  ) {}

  listForTenant(tenantId: string) {
    return this.prisma.guestRequest.findMany({
      where: { tenantId },
      include: { guest: true, property: true, room: { include: { roomType: true } } },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async getForTenant(tenantId: string, requestId: string) {
    const request = await this.prisma.guestRequest.findFirst({
      where: { id: requestId, tenantId },
      include: { guest: true, property: true, room: { include: { roomType: true } } },
    });
    if (!request) throw new NotFoundException('Guest request not found.');
    return request;
  }

  async createForTenant(tenantId: string, guestId: string, input: CreateGuestRequestDto) {
    const request = await this.readiness.transaction(async (tx) => {
      const guest = await tx.guest.findFirst({
        where: { id: guestId, tenantId },
        include: { property: true, room: true },
      });
      if (!guest) throw new BadRequestException('Guest does not belong to the active hotel.');
      if (!guest.propertyId) throw new BadRequestException('Guest must be assigned to a property before creating a request.');

      if (guest.roomId && !await tx.room.findFirst({ where: { id: guest.roomId, propertyId: guest.propertyId, property: { tenantId } } })) {
        throw new BadRequestException('Guest room does not belong to the active hotel property.');
      }
      const created = await tx.guestRequest.create({
        data: {
          tenantId,
          guestId,
          propertyId: guest.propertyId!,
          roomId: guest.roomId,
          title: input.title.trim(),
          message: input.message.trim(),
          category: input.category,
          priority: input.priority ?? GuestRequestPriority.NORMAL,
          guestCount: input.guestCount ?? 1,
        },
        include: { guest: true, property: true, room: { include: { roomType: true } } },
      });

      if (guest.roomId && input.category === GuestRequestCategory.HOUSEKEEPING) {
        await tx.housekeepingTask.create({
          data: {
            tenantId,
            propertyId: guest.propertyId!,
            roomId: guest.roomId,
            title: input.title.trim(),
            blocksRoom: true,
            notes: `Guest request ${created.id}: ${input.message.trim()}`,
            priority: this.toOperationsPriority(input.priority),
          },
        });
      }

      if (guest.roomId && input.category === GuestRequestCategory.MAINTENANCE) {
        await tx.maintenanceTicket.create({
          data: {
            tenantId,
            propertyId: guest.propertyId!,
            roomId: guest.roomId,
            title: input.title.trim(),
            description: input.message.trim(),
            blocksRoom: false,
            priority: this.toOperationsPriority(input.priority),
          },
        });
      }

      if (guest.roomId && (input.category === GuestRequestCategory.HOUSEKEEPING || input.category === GuestRequestCategory.MAINTENANCE)) {
        await this.readiness.recalculate(tx, tenantId, guest.roomId);
      }
      return created;
    });

    const events = guestRequestCreatedEvent({
      tenantId,
      guestId,
      requestId: request.id,
      roomId: request.roomId,
      title: request.title,
      message: request.message,
      priority: request.priority,
    });

    await Promise.all(events.map((event) => this.notifications.publish(event)));
    return request;
  }

  async updateForTenant(tenantId: string, requestId: string, input: UpdateGuestRequestDto) {
    const current = await this.prisma.guestRequest.findFirst({ where: { id: requestId, tenantId } });
    if (!current) throw new NotFoundException('Guest request not found.');

    const status = input.status ?? current.status;
    const completedAt = status === GuestRequestStatus.COMPLETED ? new Date() : current.completedAt;

    const request = await this.prisma.guestRequest.update({
      where: { id: current.id },
      data: {
        status,
        priority: input.priority,
        resolutionNote: input.resolutionNote?.trim(),
        completedAt,
      },
      include: { guest: true, property: true, room: { include: { roomType: true } } },
    });

    if (status !== current.status) {
      const event = guestRequestStatusNotification({
        tenantId,
        guestId: request.guestId,
        requestId: request.id,
        status,
      });
      if (event) await this.notifications.publish(event);
    }

    return request;
  }

  private toOperationsPriority(priority?: GuestRequestPriority): OperationsPriority {
    switch (priority) {
      case GuestRequestPriority.LOW:
        return OperationsPriority.LOW;
      case GuestRequestPriority.HIGH:
        return OperationsPriority.HIGH;
      case GuestRequestPriority.URGENT:
        return OperationsPriority.URGENT;
      default:
        return OperationsPriority.NORMAL;
    }
  }
}

