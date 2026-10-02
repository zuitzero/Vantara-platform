import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditService } from './audit.service';
import { RbacService } from './rbac.service';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RbacService, AuditService],
  exports: [RbacService, AuditService],
})
export class RbacModule {}
