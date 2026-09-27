import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { SESSION_COOKIE } from './auth.constants';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  auth?: Awaited<ReturnType<AuthService['getWorkspace']>>;
  authToken?: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookieHeader = request.headers.cookie ?? '';
    const token = cookieHeader.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.split('=').slice(1).join('=');
    if (!token) throw new UnauthorizedException('Authentication required.');
    request.authToken = token;
    request.auth = await this.authService.getWorkspace(token);
    return true;
  }
}
