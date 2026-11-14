import { ArgumentsHost, BadRequestException, Body, Catch, Controller, ExceptionFilter, Get, HttpCode, Param, Post, Req, Res, UnauthorizedException, UseFilters, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard, AuthenticatedRequest } from '../../auth/auth.guard';
import { TenantContextGuard } from '../../auth/tenant-context.guard';
import { TenantScopedRequest } from '../../auth/tenant-context';
import { Permissions, PermissionsGuard } from '../../auth/permissions.guard';
import { GuestProtocolDenied, parseExchangeBody } from '../protocol/guest-access.contracts';
import { GuestPayloadConflict } from '../persistence/guest-access.repository';
import { GuestHttpService } from './guest-http.service';
import { checkCsrf, clearGuestCookie, csrf, guestCookie, guestSecret, GuestTransportGuard } from './guest-http.security';
@Catch(GuestProtocolDenied)
export class GuestErrorFilter implements ExceptionFilter {
  catch(error: GuestProtocolDenied, host: ArgumentsHost) { host.switchToHttp().getResponse<Response>().status(error instanceof GuestPayloadConflict ? 409 : 401).json({ message: 'Guest access denied.' }); }
}
function empty(body: unknown) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new BadRequestException('Empty JSON object required.'); }
@Controller('guest-connect')
@UseGuards(GuestTransportGuard)
@UseFilters(GuestErrorFilter)
export class GuestHttpController {
  constructor(private readonly service: GuestHttpService) {}
  @Post('session') @HttpCode(200)
  async exchange(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { code } = parseExchangeBody(body);
    const result = await this.service.exchange(code);
    if (result.expiresAt <= Date.now()) throw new UnauthorizedException('Guest access denied.');
    response.setHeader('Set-Cookie', guestCookie(result.secret, result.expiresAt));
    return { csrfToken: csrf(result.secret), expiresAt: new Date(result.expiresAt) };
  }
  @Get('stay')
  async stay(@Req() req: Request) { const secret = guestSecret(req); return { ...await this.service.stay(secret), csrfToken: csrf(secret) }; }
  @Post('stay') @HttpCode(200)
  browserStay(@Req() req: Request, @Body() body: unknown) {
    empty(body);
    return this.stay(req);
  }
  @Post('requests') @HttpCode(200)
  create(@Req() req: Request, @Body() body: unknown) {
    const secret = guestSecret(req); checkCsrf(req, secret);
    const key = parseExchangeBody({ code: req.headers['idempotency-key'] }).code;
    return this.service.create(secret, key, body);
  }
  @Post('logout') @HttpCode(204)
  async logout(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    empty(body); const secret = guestSecret(req); checkCsrf(req, secret); await this.service.logout(secret); response.setHeader('Set-Cookie', clearGuestCookie());
  }
}
@Controller('connect-admin')
@UseGuards(GuestTransportGuard, AuthGuard, TenantContextGuard, PermissionsGuard)
@UseFilters(GuestErrorFilter)
export class GuestBootstrapController {
  constructor(private readonly service: GuestHttpService) {}
  @Post('reservations/:reservationId/bootstrap') @Permissions('reservations.manage')
  issue(@Req() req: AuthenticatedRequest & TenantScopedRequest, @Param('reservationId') reservationId: string, @Body() body: unknown) { empty(body); return this.service.issue(req.tenantContext!.tenantId, reservationId); }
}
