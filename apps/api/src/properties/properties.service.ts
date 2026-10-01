import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PropertiesService {
  constructor(private readonly prisma: PrismaService) {}

  listForTenant(tenantId: string) {
    return this.prisma.property.findMany({
      where: { tenantId },
      include: {
        roomTypes: true,
        rooms: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async createForTenant(tenantId: string, name: string) {
    return this.prisma.property.create({
      data: {
        tenantId,
        name: name.trim(),
      },
    });
  }
}
