import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GuestRequestPriority, GuestRequestStatus } from '@prisma/client';
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
    const guest = await this.prisma.guest.findFirst({
      where: { id: guestId, tenantId },
      include: { property: true, room: true },
    });
    if (!guest) throw new BadRequestException('Guest does not belong to the active hotel.');
    if (!guest.propertyId) throw new BadRequestException('Guest must be assigned to a property before creating a request.');

    const request = await this.prisma.guestRequest.create({
      data: {
        tenantId,
        guestId,
        propertyId: guest.propertyId,
        roomId: guest.roomId,
        title: input.title.trim(),
        message: input.message.trim(),
        category: input.category,
        priority: input.priority ?? GuestRequestPriority.NORMAL,
        guestCount: input.guestCount ?? 1,
      },
      include: { guest: true, property: true, room: { include: { roomType: true } } },
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

    events.forEach((event) => this.notifications.publish(event));
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
      if (event) this.notifications.publish(event);
    }

    return request;
  }
}
