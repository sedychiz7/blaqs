import { DAY, HttpError, type Context } from './context.js';
import { entitlementsFor, retentionHours } from './plans.js';
import { pruneHistory } from './locations.js';
import { listShares, shouldCollect } from './shares.js';
import { listPlaceAlerts, listPlaces } from './places.js';
import { listEvents } from './safety.js';
import { displayName, requireUser } from './users.js';

export function me(ctx: Context, meId: string) {
  const user = requireUser(ctx, meId);
  return {
    id: user.id,
    displayName: user.display_name,
    entitlements: entitlementsFor(ctx, user),
    premiumUntil: user.premium_until,
    historyRetentionHours: retentionHours(ctx, user),
    sharingPaused: !!user.sharing_paused,
    collect: shouldCollect(ctx, user.id),
  };
}

export function updateMe(ctx: Context, meId: string, input: { displayName?: string; historyRetentionHours?: number; pushToken?: string | null }) {
  const user = requireUser(ctx, meId);
  if (input.displayName !== undefined) ctx.db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(input.displayName.trim(), meId);
  if (input.pushToken !== undefined) ctx.db.prepare('UPDATE users SET push_token = ? WHERE id = ?').run(input.pushToken, meId);
  if (input.historyRetentionHours !== undefined) {
    const max = entitlementsFor(ctx, user).historyHours;
    ctx.db.prepare('UPDATE users SET history_retention_hours = ? WHERE id = ?').run(Math.min(input.historyRetentionHours, max), meId);
    pruneHistory(ctx, meId);
  }
  return me(ctx, meId);
}

/** Who looked at my location, and when. */
export function accessLog(ctx: Context, meId: string, days = 7) {
  const rows = ctx.db
    .prepare('SELECT viewer_id, kind, at FROM access_log WHERE subject_id = ? AND at > ? ORDER BY at DESC LIMIT 500')
    .all(meId, ctx.now() - days * DAY) as { viewer_id: string; kind: string; at: number }[];
  return rows.map((r) => ({ viewer: { id: r.viewer_id, displayName: displayName(ctx, r.viewer_id) }, kind: r.kind, at: r.at }));
}

export function deleteHistory(ctx: Context, meId: string) {
  const res = ctx.db.prepare('DELETE FROM locations WHERE user_id = ?').run(meId);
  return { deleted: Number(res.changes) };
}

/** Everything we hold about the user, in one JSON document. */
export function exportData(ctx: Context, meId: string) {
  const locations = ctx.db.prepare('SELECT lat, lng, accuracy, speed, heading, battery, recorded_at FROM locations WHERE user_id = ? ORDER BY recorded_at').all(meId);
  return {
    exportedAt: ctx.now(),
    profile: me(ctx, meId),
    shares: listShares(ctx, meId),
    places: listPlaces(ctx, meId),
    placeAlerts: listPlaceAlerts(ctx, meId),
    accessLog: accessLog(ctx, meId, 365),
    events: listEvents(ctx, meId, 1000),
    locations,
  };
}

export function deleteAccount(ctx: Context, meId: string) {
  requireUser(ctx, meId);
  // Shares where I was the only known party (invites to people who never joined) would be orphaned.
  ctx.db.prepare('DELETE FROM shares WHERE (sharer_id = ? AND viewer_id IS NULL) OR (viewer_id = ? AND sharer_id IS NULL)').run(meId, meId);
  ctx.db.prepare('DELETE FROM users WHERE id = ?').run(meId);
  ctx.hub.disconnect(meId);
  return { deleted: true };
}

/**
 * RevenueCat webhook. The app sets RevenueCat's appUserID to our user id, so entitlement
 * changes made through the App Store / Play Store land on the right account.
 */
export function handleRevenueCatWebhook(ctx: Context, authHeader: string | undefined, body: any) {
  const secret = ctx.config.revenueCatWebhookSecret;
  if (!secret || authHeader !== `Bearer ${secret}`) throw new HttpError(401, 'unauthorized');
  const event = body?.event;
  const userId: string | undefined = event?.app_user_id;
  if (!event || !userId) throw new HttpError(400, 'bad_event');
  const active = ['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE'];
  if (active.includes(event.type)) {
    const until = Number(event.expiration_at_ms) || ctx.now() + 31 * DAY;
    ctx.db.prepare(`UPDATE users SET plan = 'premium', premium_until = ? WHERE id = ?`).run(until, userId);
  } else if (event.type === 'EXPIRATION') {
    ctx.db.prepare(`UPDATE users SET plan = 'free', premium_until = NULL WHERE id = ?`).run(userId);
  }
  return { ok: true };
}

export function devGrantPremium(ctx: Context, meId: string, days: number) {
  if (!ctx.config.devBilling) throw new HttpError(404, 'not_found');
  ctx.db.prepare(`UPDATE users SET plan = 'premium', premium_until = ? WHERE id = ?`).run(ctx.now() + days * DAY, meId);
  return me(ctx, meId);
}
