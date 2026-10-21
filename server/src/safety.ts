import { HttpError, type Context } from './context.js';
import type { ShareRow } from './shares.js';
import { expireStale } from './shares.js';
import { notify, requireUser } from './users.js';

/**
 * SOS goes to everyone I have an accepted share with, including paused ones, and always
 * carries my precise location: pressing the button is itself the consent to send it.
 * Never paywalled.
 */
export function sendSos(ctx: Context, meId: string, input: { lat: number; lng: number; accuracy?: number | null; message?: string }) {
  expireStale(ctx);
  const me = requireUser(ctx, meId);
  const shares = ctx.db
    .prepare(`SELECT * FROM shares WHERE sharer_id = ? AND status IN ('active', 'paused') AND viewer_id IS NOT NULL`)
    .all(meId) as unknown as ShareRow[];
  const recipients = [...new Set(shares.map((s) => s.viewer_id!))];
  if (recipients.length === 0) throw new HttpError(409, 'no_recipients', 'Share with at least one person to use SOS.');
  const payload = { from: me.display_name, fromId: me.id, lat: input.lat, lng: input.lng, accuracy: input.accuracy ?? null, message: input.message ?? null };
  for (const r of recipients) {
    notify(ctx, r, 'sos', payload, {
      title: `🚨 SOS from ${me.display_name}`,
      body: input.message ? input.message : `${me.display_name} needs help. Tap to see where they are.`,
    });
  }
  return { notified: recipients.length };
}

/** "Arrived safe" style message to people who can already see me. */
export function sendCheckIn(
  ctx: Context,
  meId: string,
  input: { message: string; lat?: number; lng?: number; viewerIds?: string[] },
) {
  expireStale(ctx);
  const me = requireUser(ctx, meId);
  const shares = ctx.db
    .prepare(`SELECT * FROM shares WHERE sharer_id = ? AND status = 'active' AND viewer_id IS NOT NULL`)
    .all(meId) as unknown as ShareRow[];
  const allowed = new Set(shares.map((s) => s.viewer_id!));
  const recipients = input.viewerIds ? input.viewerIds.filter((id) => allowed.has(id)) : [...allowed];
  if (recipients.length === 0) throw new HttpError(409, 'no_recipients');
  for (const r of recipients) {
    notify(ctx, r, 'check_in', { from: me.display_name, fromId: me.id, message: input.message, lat: input.lat ?? null, lng: input.lng ?? null }, {
      title: `${me.display_name} checked in`,
      body: input.message,
    });
  }
  return { notified: recipients.length };
}

export function listEvents(ctx: Context, meId: string, limit = 50) {
  const rows = ctx.db
    .prepare('SELECT * FROM events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(meId, limit) as unknown as { id: number; type: string; payload: string; created_at: number; read_at: number | null }[];
  return rows.map((r) => ({ id: r.id, type: r.type, payload: JSON.parse(r.payload), createdAt: r.created_at, read: r.read_at != null }));
}

export function markEventsRead(ctx: Context, meId: string) {
  ctx.db.prepare('UPDATE events SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(ctx.now(), meId);
  return { ok: true };
}
