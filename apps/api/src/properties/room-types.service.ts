import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    const property = await this.prisma.property.findFirst({ where: { id: propertyId, tenantId, tenant: { type: 'HOTEL' } } });
    if (!property) throw new NotFoundException('Property not found.');

    const code = input.code.trim().toUpperCase();
    if (!code) throw new BadRequestException('Room type code is required.');

    if (!input.name.trim()) throw new BadRequestException('Room type name is required.');
    try { return await this.prisma.roomType.create({
      data: {
        propertyId,
        name: input.name.trim(),
        code,
        maxGuests: input.maxGuests,
      },
    }); } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This room type code already exists in this property.');
      throw error;
    }
  }
}
