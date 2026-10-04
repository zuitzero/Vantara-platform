import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditContextInterceptor } from './audit-context';
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from './audit.service';
import { RbacService } from './rbac.service';

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AuditController],
  providers: [RbacService, AuditService, { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor }],
  exports: [RbacService, AuditService],
})
export class RbacModule {}

