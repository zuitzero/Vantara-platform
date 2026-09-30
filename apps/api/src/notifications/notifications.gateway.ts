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

  constructor(private readonly authService: AuthService) {}

  async handleConnection(socket: Socket) {
    try {
      const token = this.readCookie(socket.handshake.headers.cookie ?? '', SESSION_COOKIE);
      if (!token) throw new UnauthorizedException('Authentication required.');
      const workspace = await this.authService.getWorkspace(token);
      socket.join(`tenant:${workspace.tenant.id}:recipient:${workspace.user.id}`);
      socket.join(`tenant:${workspace.tenant.id}:audience:HOTEL`);
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
    return header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.split('=').slice(1).join('=');
  }
}
