import { useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '../../../shared/types/index.js';

export interface WsSignalMessage {
  type: string;
  appointmentId?: string;
  participants?: Array<{ userId: string; role: string; name: string }>;
  fromUserId?: string;
  fromRole?: string;
  fromName?: string;
  signal?: unknown;
  mediaState?: { audio: boolean; video: boolean };
  text?: string;
  timestamp?: string;
  userId?: string;
  name?: string;
  error?: string;
  notification?: NotificationItem;
}

export function useWebSocket(
  token: string | null,
  onNotification?: (n: NotificationItem) => void,
  onSignalMessage?: (msg: WsSignalMessage) => void
) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onNotifRef = useRef(onNotification);
  const onSignalRef = useRef(onSignalMessage);
  onNotifRef.current = onNotification;
  onSignalRef.current = onSignalMessage;

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }

    let active = true;
    let reconnectTimer: number | undefined;

    function connect() {
      if (!active || !token) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        if (active) setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WsSignalMessage;
          if (data.type === 'notification' && data.notification) {
            onNotifRef.current?.(data.notification);
          } else {
            onSignalRef.current?.(data);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (active) {
          setConnected(false);
          reconnectTimer = window.setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [token]);

  const sendMessage = (payload: Record<string, unknown>) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  };

  return { connected, sendMessage };
}
