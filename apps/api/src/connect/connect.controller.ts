import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ConnectService } from './connect.service';
import { CreateConnectRequestDto } from './connect.dto';

@Controller('connect')
export class ConnectController {
  constructor(private readonly connect: ConnectService) {}
  @Get(':token') stay(@Param('token') token: string) { return this.connect.stay(token); }
  @Post(':token/requests') request(@Param('token') token: string, @Body() body: CreateConnectRequestDto) { return this.connect.createRequest(token, body); }
}
