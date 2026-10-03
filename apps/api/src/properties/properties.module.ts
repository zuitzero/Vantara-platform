import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { RoomTypesController } from './room-types.controller';
import { RoomTypesService } from './room-types.service';

@Module({
  imports: [AuthModule],
  controllers: [PropertiesController, RoomTypesController],
  providers: [PropertiesService, RoomTypesService],
})
export class PropertiesModule {}
