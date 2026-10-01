'use client';

import { useEffect } from 'react';
import { io } from 'socket.io-client';

export type RealtimeNotification = {
  id?: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  message: string;
  type: string;
  createdAt?: string;
  readAt?: string | null;
};

export function useRealtimeNotifications(
  onNotification: (notification: RealtimeNotification) => void,
) {
  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    const socket = io(`${apiUrl}/realtime`, {
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
