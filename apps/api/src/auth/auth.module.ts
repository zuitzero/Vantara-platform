import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, TenantContextGuard, RolesGuard],
  exports: [AuthService, AuthGuard, TenantContextGuard, RolesGuard],
})
export class AuthModule {}
