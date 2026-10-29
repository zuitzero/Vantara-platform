import { allowedOrigin } from '../security/cloud-security';
import { RbacService } from '../rbac/rbac.service';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { SESSION_COOKIE } from '../auth/auth.constants';
import { NotificationEvent } from './notifications.types';

@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: (origin, callback) => callback(null, allowedOrigin(origin)), credentials: true },
  // CORS alone does not protect WebSocket upgrades.
  allowRequest: (request, callback) => callback(null, allowedOrigin(request.headers.origin)),
})
@Injectable()
export class NotificationsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly authService: AuthService, private readonly rbac: RbacService) {}

  async handleConnection(socket: Socket) {
    try {
      if (!allowedOrigin(socket.handshake.headers.origin)) throw new UnauthorizedException('Trusted origin required.');
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
      socket.data.workspace = { tenantId, recipientId, role };
      socket.join(`tenant:${tenantId}:recipient:${recipientId}`);

      // Hotel-wide realtime events are restricted to hotel staff roles.
      if (['HOTEL_ADMIN', 'HOTEL_STAFF'].includes(role)) {
        socket.join(`tenant:${tenantId}:audience:HOTEL`);
      }
    } catch {
      socket.disconnect(true);
    }
  }

  async emit(event: NotificationEvent & { id?: string }) {
    if (!this.server || !event.tenantId) return;

    const room = event.recipientId
      ? `tenant:${event.tenantId}:recipient:${event.recipientId}`
      : `tenant:${event.tenantId}:audience:${event.audience}`;

    // Recheck before delivery: a socket cannot retain access after logout, expiry,
    // tenant switch or membership/permission revocation. No bearer values are logged.
    try {
      for (const socket of await this.server.in(room).fetchSockets()) {
        try {
          const token = this.readCookie(socket.handshake.headers.cookie ?? '', SESSION_COOKIE);
          if (!token) throw new UnauthorizedException();
          const workspace = await this.authService.getWorkspace(token);
          const bound = socket.data.workspace;
          if (!bound || workspace.tenant.id !== bound.tenantId || workspace.user.id !== bound.recipientId ||
              workspace.membership.role !== bound.role || bound.tenantId !== event.tenantId) throw new UnauthorizedException();
          if (event.recipientId ? event.recipientId !== bound.recipientId :
              event.audience !== 'HOTEL' || !['HOTEL_ADMIN', 'HOTEL_STAFF'].includes(bound.role)) throw new UnauthorizedException();
          const access = await this.rbac.getTenantAccess(bound.recipientId, bound.tenantId);
          if (access?.tenantType !== 'HOTEL') throw new UnauthorizedException();
          if (['HOTEL_ADMIN', 'HOTEL_STAFF'].includes(bound.role)) {
            await this.rbac.assertTenantAccess(bound.recipientId, bound.tenantId, 'notifications.read');
          }
          socket.emit('notification', event);
        } catch { socket.disconnect(true); }
      }
    } catch {
      // Notification persistence remains authoritative if the transport is unavailable.
      // Do not log handshake cookies or capability-bearing paths.
    }
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

