import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';
import { AuthGuard, AuthenticatedRequest } from './auth.guard';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './auth.constants';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() input: LoginDto, @Res({ passthrough: true }) response: Response) {
    const session = await this.authService.login(input);
    response.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${session.token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_DAYS * 24 * 60 * 60}; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    return { expiresAt: session.expiresAt };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return request.auth;
  }

  @Post('tenant/:tenantId')
  @UseGuards(AuthGuard)
  async switchTenant(
    @Req() request: AuthenticatedRequest,
    @Param('tenantId') tenantId: string,
  ) {
    return this.authService.switchTenant(request.authToken!, tenantId);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token = request.authToken;
    if (token) await this.authService.logout(token);
    response.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
    );
    return { success: true };
  }
}
