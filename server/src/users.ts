import { HttpError, MINUTE, type Context } from './context.js';
import type { PushMessage } from './notifier.js';

export interface UserRow {
  id: string;
  phone_hash: string;
  display_name: string;
  plan: string;
  premium_until: number | null;
  history_retention_hours: number | null;
  sharing_paused: number;
  push_token: string | null;
  created_at: number;
}

export function findUser(ctx: Context, id: string): UserRow | undefined {
  return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function requireUser(ctx: Context, id: string): UserRow {
  const user = findUser(ctx, id);
  if (!user) throw new HttpError(404, 'user_not_found');
  return user;
}

export function findUserByPhoneHash(ctx: Context, phoneHash: string): UserRow | undefined {
  return ctx.db.prepare('SELECT * FROM users WHERE phone_hash = ?').get(phoneHash) as UserRow | undefined;
}

export function displayName(ctx: Context, id: string | null): string | null {
  if (!id) return null;
  return findUser(ctx, id)?.display_name ?? null;
}

/**
 * Records an in-app event, pushes it over the live socket and, when `push` is given,
 * sends a device notification. Every consent decision someone else has to make arrives
 * through here so it can never happen silently.
 */
export function notify(ctx: Context, userId: string, type: string, payload: Record<string, unknown>, push?: PushMessage) {
  const createdAt = ctx.now();
  const result = ctx.db
    .prepare('INSERT INTO events (user_id, type, payload, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, type, JSON.stringify(payload), createdAt);
  ctx.hub.send(userId, { type: 'event', event: { id: Number(result.lastInsertRowid), type, payload, createdAt } });
  if (!push) return;
  const token = findUser(ctx, userId)?.push_token;
  if (token) ctx.notifier.push(token, { ...push, data: { type, ...payload } }).catch((err) => console.warn('push failed', err));
}

const ACCESS_LOG_THROTTLE = 5 * MINUTE;

export function logAccess(ctx: Context, subjectId: string, viewerId: string, kind: 'live' | 'history') {
  const now = ctx.now();
  const recent = ctx.db
    .prepare('SELECT 1 FROM access_log WHERE subject_id = ? AND viewer_id = ? AND kind = ? AND at > ? LIMIT 1')
    .get(subjectId, viewerId, kind, now - ACCESS_LOG_THROTTLE);
  if (!recent) {
    ctx.db.prepare('INSERT INTO access_log (subject_id, viewer_id, kind, at) VALUES (?, ?, ?, ?)').run(subjectId, viewerId, kind, now);
  }
}
