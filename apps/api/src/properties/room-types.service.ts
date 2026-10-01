import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoomTypeDto } from './room-types.dto';

@Injectable()
export class RoomTypesService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    return this.prisma.roomType.findMany({
      where: { property: { tenantId } },
      include: { property: true, _count: { select: { rooms: true } } },
      orderBy: [{ property: { name: 'asc' } }, { name: 'asc' }],
    });
  }

  async createForTenant(tenantId: string, propertyId: string, input: CreateRoomTypeDto) {
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, tenantId } });
    if (!property) throw new NotFoundException('Property not found.');

    const code = input.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Room type code is required.');

    return this.prisma.roomType.create({
      data: {
        propertyId,
        name: input.name.trim(),
        code,
        maxGuests: input.maxGuests,
      },
    });
  }
}
