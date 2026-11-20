import { WebSocket, WebSocketServer } from 'ws';
import { verifyAuthToken, type AuthTokenPayload } from '../middleware/auth.js';
import { dbStore } from '../db/store.js';

interface ClientSocket extends WebSocket {
  auth?: AuthTokenPayload;
  userName?: string;
  callRoomId?: string;
}

const userSockets = new Map<string, Set<ClientSocket>>();
const callRooms = new Map<string, Set<ClientSocket>>();

export function broadcastToUser(userId: string, payload: unknown) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  const serialized = JSON.stringify(payload);
  for (const sock of sockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(serialized);
    }
  }
}

function broadcastToRoom(
  roomId: string,
  payload: unknown,
  excludeSocket?: ClientSocket
) {
  const peers = callRooms.get(roomId);
  if (!peers) return;
  const serialized = JSON.stringify(payload);
  for (const peer of peers) {
    if (peer !== excludeSocket && peer.readyState === WebSocket.OPEN) {
      peer.send(serialized);
    }
  }
}

function canUserAccessAppointmentCall(
  auth: AuthTokenPayload,
  appointmentId: string
): boolean {
  const state = dbStore.getState();
  const appt = state.appointments.find((a) => a.id === appointmentId);
  if (!appt) return false;
  if (appt.status !== 'accepted' && appt.status !== 'completed') return false;
  if (auth.role === 'patient') {
    return appt.patientId === auth.patientId;
  }
  if (auth.role === 'doctor') {
    return appt.doctorId === auth.doctorId;
  }
  return false;
}

export function setupWebSocketServer() {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: ClientSocket, req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Missing auth token');
      return;
    }

    try {
      const auth = verifyAuthToken(token);
      const user = dbStore.getState().users.find((u) => u.id === auth.userId);
      if (!user || !user.active) {
        ws.close(4003, 'Unauthorized');
        return;
      }
      ws.auth = auth;
      ws.userName = user.name;

      if (!userSockets.has(auth.userId)) {
        userSockets.set(auth.userId, new Set());
      }
      userSockets.get(auth.userId)!.add(ws);
    } catch {
      ws.close(4002, 'Invalid token');
      return;
    }

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type: string;
          appointmentId?: string;
          signal?: unknown;
          mediaState?: { audio: boolean; video: boolean };
          text?: string;
        };
        if (!ws.auth) return;

        if (msg.type === 'join-call' && msg.appointmentId) {
          if (!canUserAccessAppointmentCall(ws.auth, msg.appointmentId)) {
            ws.send(
              JSON.stringify({
                type: 'call-error',
                error: 'Not authorized to join this consultation room or appointment is not accepted.',
              })
            );
            return;
          }
          if (ws.callRoomId && callRooms.has(ws.callRoomId)) {
            callRooms.get(ws.callRoomId)!.delete(ws);
          }
          ws.callRoomId = msg.appointmentId;
          if (!callRooms.has(msg.appointmentId)) {
            callRooms.set(msg.appointmentId, new Set());
          }
          const room = callRooms.get(msg.appointmentId)!;
          room.add(ws);

          const participants = Array.from(room).map((peer) => ({
            userId: peer.auth?.userId,
            role: peer.auth?.role,
            name: peer.userName,
          }));

          // Notify everyone in room about participant list
          broadcastToRoom(msg.appointmentId, {
            type: 'room-participants',
            appointmentId: msg.appointmentId,
            participants,
          });
          return;
        }

        if (msg.type === 'webrtc-signal' && ws.callRoomId) {
          broadcastToRoom(
            ws.callRoomId,
            {
              type: 'webrtc-signal',
              fromUserId: ws.auth.userId,
              fromRole: ws.auth.role,
              fromName: ws.userName,
              signal: msg.signal,
            },
            ws
          );
          return;
        }

        if (msg.type === 'media-state' && ws.callRoomId) {
          broadcastToRoom(
            ws.callRoomId,
            {
              type: 'media-state',
              fromUserId: ws.auth.userId,
              mediaState: msg.mediaState,
            },
            ws
          );
          return;
        }

        if (msg.type === 'call-chat' && ws.callRoomId && msg.text) {
          broadcastToRoom(ws.callRoomId, {
            type: 'call-chat',
            fromUserId: ws.auth.userId,
            fromRole: ws.auth.role,
            fromName: ws.userName,
            text: String(msg.text).slice(0, 500),
            timestamp: new Date().toISOString(),
          });
          return;
        }

        if (msg.type === 'leave-call' && ws.callRoomId) {
          const room = callRooms.get(ws.callRoomId);
          if (room) {
            room.delete(ws);
            broadcastToRoom(ws.callRoomId, {
              type: 'peer-left',
              userId: ws.auth.userId,
              name: ws.userName,
            });
            if (room.size === 0) callRooms.delete(ws.callRoomId);
          }
          ws.callRoomId = undefined;
        }
      } catch (err) {
        console.error('WS message error:', err);
      }
    });

    ws.on('close', () => {
      if (ws.auth) {
        const set = userSockets.get(ws.auth.userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) userSockets.delete(ws.auth.userId);
        }
      }
      if (ws.callRoomId && callRooms.has(ws.callRoomId)) {
        const room = callRooms.get(ws.callRoomId)!;
        room.delete(ws);
        broadcastToRoom(ws.callRoomId, {
          type: 'peer-left',
          userId: ws.auth?.userId,
          name: ws.userName,
        });
        if (room.size === 0) callRooms.delete(ws.callRoomId);
      }
    });
  });

  return wss;
}
