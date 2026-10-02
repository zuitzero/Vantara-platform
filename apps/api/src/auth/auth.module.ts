import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RolesGuard } from './roles.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PermissionsGuard, TenantContextGuard, RolesGuard],
  exports: [AuthService, AuthGuard, PermissionsGuard, TenantContextGuard, RolesGuard],
})
export class AuthModule {}
