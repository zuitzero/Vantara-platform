import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';
import { NotificationEvent } from './notifications.types';

@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
@Injectable()
export class NotificationsGateway {
  @WebSocketServer()
  server!: Server;

  emit(event: NotificationEvent & { id?: string }) {
    if (!this.server) return;
    const room = event.recipientId ? `tenant:${event.tenantId}:recipient:${event.recipientId}` : `tenant:${event.tenantId}:audience:${event.audience}`;
    this.server.to(room).emit('notification', event);
  }
}
