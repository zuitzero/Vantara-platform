import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GuestRequestCategory, GuestRequestPriority, GuestRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class GuestRequestsService {
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async create(input: { tenantId: string; propertyId: string; guestId: string; roomId?: string; title: string; message: string; category: GuestRequestCategory; priority?: GuestRequestPriority }) {
    const guest = await this.prisma.guest.findFirst({ where: { id: input.guestId, tenantId: input.tenantId } });
    const property = await this.prisma.property.findFirst({ where: { id: input.propertyId, tenantId: input.tenantId } });
    if (!guest || !property) throw new BadRequestException('Guest and property must belong to the active hotel');
    if (input.roomId) {
      const room = await this.prisma.room.findFirst({ where: { id: input.roomId, propertyId: input.propertyId } });
      if (!room) throw new BadRequestException('Room must belong to the selected property');
    }

    const request = await this.prisma.guestRequest.create({
      data: {
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        guestId: input.guestId,
        roomId: input.roomId,
        title: input.title,
        message: input.message,
        category: input.category,
        priority: input.priority ?? GuestRequestPriority.NORMAL,
      },
    });

    await this.notifications.publish({
      tenantId: input.tenantId,
      audience: 'HOTEL',
      severity: input.priority === GuestRequestPriority.URGENT ? 'HIGH' : 'INFO',
      type: 'guest_request.created',
      title: 'New guest request',
      message: input.title,
      metadata: { requestId: request.id, guestId: input.guestId, roomId: input.roomId },
    });

    return request;
  }

  list(tenantId: string) {
    return this.prisma.guestRequest.findMany({
      where: { tenantId },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async updateStatus(tenantId: string, id: string, status: GuestRequestStatus, resolutionNote?: string) {
    const existing = await this.prisma.guestRequest.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Guest request not found');

    const request = await this.prisma.guestRequest.update({
      where: { id },
      data: {
        status,
        resolutionNote,
        completedAt: status === GuestRequestStatus.COMPLETED ? new Date() : null,
      },
    });

    await this.notifications.publish({
      tenantId,
      audience: 'GUEST',
      recipientId: existing.guestId,
      severity: 'INFO',
      type: 'guest_request.status_changed',
      title: 'Request updated',
      message: `Your request is now ${status.toLowerCase().replaceAll('_', ' ')}.`,
      metadata: { requestId: id, status },
    });

    return request;
  }
}
