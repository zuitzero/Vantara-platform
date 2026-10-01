import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GuestsController } from './guests.controller';
import { GuestsService } from './guests.service';

@Module({
  imports: [AuthModule],
  controllers: [GuestsController],
  providers: [GuestsService],
})
export class GuestsModule {}
