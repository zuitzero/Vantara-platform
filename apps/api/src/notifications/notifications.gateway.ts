import { RbacService } from '../rbac/rbac.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { SESSION_COOKIE } from '../auth/auth.constants';
import { NotificationEvent } from './notifications.types';

@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: process.env.WEB_ORIGIN
      ? process.env.WEB_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
      : true,
    credentials: true,
  },
})
@Injectable()
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly authService: AuthService, private readonly rbac: RbacService) {}

  async handleConnection(socket: Socket) {
    try {
      const token = this.readCookie(socket.handshake.headers.cookie ?? '', SESSION_COOKIE);
      if (!token) throw new UnauthorizedException('Authentication required.');

      const workspace = await this.authService.getWorkspace(token);
      const tenantId = workspace.tenant.id;
      const recipientId = workspace.user.id;
      const role = workspace.membership.role;

      if (!['HOTEL_ADMIN', 'HOTEL_STAFF', 'GUEST'].includes(role)) throw new UnauthorizedException('Hotel realtime only.');
      const access = await this.rbac.getTenantAccess(recipientId, tenantId);
      if (access?.tenantType !== 'HOTEL') throw new UnauthorizedException('Hotel membership required.');
      if (['HOTEL_ADMIN', 'HOTEL_STAFF'].includes(role)) {
        await this.rbac.assertTenantAccess(recipientId, tenantId, 'notifications.read');
      }
      socket.join(`tenant:${tenantId}:recipient:${recipientId}`);

      // Hotel-wide realtime events are restricted to hotel staff roles.
      if (['HOTEL_ADMIN', 'HOTEL_STAFF'].includes(role)) {
        socket.join(`tenant:${tenantId}:audience:HOTEL`);
      }
    } catch {
      socket.disconnect(true);
    }
  }

  emit(event: NotificationEvent & { id?: string }) {
    if (!this.server || !event.tenantId) return;

    const room = event.recipientId
      ? `tenant:${event.tenantId}:recipient:${event.recipientId}`
      : `tenant:${event.tenantId}:audience:${event.audience}`;

    this.server.to(room).emit('notification', event);
  }

  private readCookie(header: string, name: string) {
    return header
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.split('=')
      .slice(1)
      .join('=');
  }
}

