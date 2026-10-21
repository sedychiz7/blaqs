import { API_URL, getToken } from './api';

export type RealtimeMessage =
  | { type: 'hello' }
  | { type: 'location'; person: import('./types').Person }
  | { type: 'event'; event: import('./types').AppEvent }
  | { type: 'shares_changed' }
  | { type: 'sharing_changed'; collect: boolean };

type Listener = (msg: RealtimeMessage) => void;

const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let retry = 0;
let wanted = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

async function open() {
  const token = await getToken();
  if (!wanted || !token) return;
  const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`);
  socket = ws;
  ws.onopen = () => (retry = 0);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data)) as RealtimeMessage;
      listeners.forEach((l) => l(msg));
    } catch {}
  };
  ws.onclose = (e) => {
    if (socket === ws) socket = null;
    if (!wanted || e.code === 4001) return;
    timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** retry++));
  };
}

export function connect() {
  wanted = true;
  if (!socket) void open();
}

export function disconnect() {
  wanted = false;
  if (timer) clearTimeout(timer);
  socket?.close();
  socket = null;
}
