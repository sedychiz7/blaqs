import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export class RealtimeHub {
  private sockets = new Map<string, Set<WebSocket>>();

  add(userId: string, socket: WebSocket) {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(socket);
    socket.on('close', () => {
      set.delete(socket);
      if (set.size === 0) this.sockets.delete(userId);
    });
  }

  send(userId: string, message: unknown) {
    const set = this.sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(message);
    for (const socket of set) if (socket.readyState === socket.OPEN) socket.send(data);
  }

  /** Drops every connection for a user, e.g. after account deletion. */
  disconnect(userId: string) {
    for (const socket of this.sockets.get(userId) ?? []) socket.close(4001, 'signed_out');
    this.sockets.delete(userId);
  }
}

export function attachRealtime(server: Server, hub: RealtimeHub, authenticate: (token: string) => string | null) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (socket, req) => {
    const token = new URL(req.url ?? '', 'http://localhost').searchParams.get('token') ?? '';
    const userId = authenticate(token);
    if (!userId) return socket.close(4001, 'unauthorized');
    hub.add(userId, socket);
    socket.send(JSON.stringify({ type: 'hello' }));
  });
  return wss;
}
