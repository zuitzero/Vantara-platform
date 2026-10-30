'use client';

import { useEffect } from 'react';
import { realtimeUrl } from '../../transport-config';
import { io } from 'socket.io-client';

export type RealtimeNotification = {
  id?: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  type: string;
  metadata?: { requestId?: unknown } | null;
  createdAt?: string;
  readAt?: string | null;
};

export function useRealtimeNotifications(
  onNotification: (notification: RealtimeNotification) => void,
) {
  useEffect(() => {
    const socket = io(realtimeUrl(process.env.NEXT_PUBLIC_REALTIME_URL, process.env.NODE_ENV === 'production', window.location.origin), {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
    });

    socket.on('notification', onNotification);

    return () => {
      socket.off('notification', onNotification);
      socket.disconnect();
    };
  }, [onNotification]);
}
