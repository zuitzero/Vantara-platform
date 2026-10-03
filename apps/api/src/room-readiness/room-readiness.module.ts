import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RoomReadinessService } from './room-readiness.service';
@Module({ imports: [PrismaModule], providers: [RoomReadinessService], exports: [RoomReadinessService] })
export class RoomReadinessModule {}
