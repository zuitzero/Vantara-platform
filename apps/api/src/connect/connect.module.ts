import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RequestsModule } from '../requests/requests.module';
import { ConnectAdminController } from './connect-admin.controller';
import { ConnectController } from './connect.controller';
import { ConnectService } from './connect.service';

@Module({
  imports: [PrismaModule, AuthModule, RequestsModule],
  controllers: [ConnectController, ConnectAdminController],
  providers: [ConnectService],
})
export class ConnectModule {}
