import { HOUR, HttpError, MINUTE, type Context } from './context.js';
import { applyPrecision, distanceMeters, type LocationPoint } from './geo.js';
import { entitlementsFor, retentionHours } from './plans.js';
import { evaluatePlaceAlerts } from './places.js';
import { activeSharesAsSharer, expireStale, shouldCollect, viewableShare, type ShareRow } from './shares.js';
import { displayName, logAccess, notify, requireUser } from './users.js';

interface LocationRow {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery: number | null;
  recorded_at: number;
}

const toPoint = (r: LocationRow): LocationPoint => ({
  lat: r.lat,
  lng: r.lng,
  accuracy: r.accuracy,
  speed: r.speed,
  heading: r.heading,
  battery: r.battery,
  recordedAt: r.recorded_at,
});

export function latestLocation(ctx: Context, userId: string): LocationPoint | null {
  const row = ctx.db
    .prepare('SELECT * FROM locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1')
    .get(userId) as LocationRow | undefined;
  return row ? toPoint(row) : null;
}

/**
 * Called by the sharer's own device (foreground or background task). Points are dropped,
 * not stored, unless the user currently has someone they agreed to share with.
 */
export function uploadLocations(ctx: Context, meId: string, points: LocationPoint[]) {
  const me = requireUser(ctx, meId);
  if (!shouldCollect(ctx, me.id)) return { stored: 0, collect: false };

  const now = ctx.now();
  const keepFrom = now - Math.max(retentionHours(ctx, me), 1) * HOUR;
  const valid = points
    .filter((p) => p.recordedAt <= now + 5 * MINUTE && p.recordedAt >= keepFrom)
    .sort((a, b) => a.recordedAt - b.recordedAt);

  const insert = ctx.db.prepare(
    'INSERT INTO locations (user_id, lat, lng, accuracy, speed, heading, battery, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  for (const p of valid) insert.run(me.id, p.lat, p.lng, p.accuracy, p.speed, p.heading, p.battery, p.recordedAt);
  pruneHistory(ctx, me.id);
  if (valid.length === 0) return { stored: 0, collect: true };

  evaluatePlaceAlerts(ctx, me.id, valid);
  const latest = valid[valid.length - 1];
  for (const share of activeSharesAsSharer(ctx, me.id)) {
    checkTripArrival(ctx, share, latest);
    ctx.hub.send(share.viewer_id!, { type: 'location', person: personView(ctx, share, latest) });
  }
  return { stored: valid.length, collect: true };
}

/** Keeps the latest point (needed for live view) and drops anything past the retention window. */
export function pruneHistory(ctx: Context, userId: string) {
  const user = requireUser(ctx, userId);
  const cutoff = ctx.now() - retentionHours(ctx, user) * HOUR;
  ctx.db
    .prepare(`DELETE FROM locations WHERE user_id = ? AND recorded_at < ?
              AND id <> (SELECT id FROM locations WHERE user_id = ? ORDER BY recorded_at DESC LIMIT 1)`)
    .run(userId, cutoff, userId);
}

function etaSeconds(share: ShareRow, point: LocationPoint): number | null {
  if (share.trip_lat == null || share.trip_lng == null) return null;
  const remaining = distanceMeters(point.lat, point.lng, share.trip_lat, share.trip_lng);
  // Only estimate while actually moving; below ~1 m/s an ETA would be noise.
  if (!point.speed || point.speed < 1) return null;
  return Math.round(remaining / point.speed);
}

function checkTripArrival(ctx: Context, share: ShareRow, point: LocationPoint) {
  if (share.trip_lat == null || share.trip_lng == null) return;
  const d = distanceMeters(point.lat, point.lng, share.trip_lat, share.trip_lng);
  if (d > (share.trip_radius_m ?? 150)) return;
  const name = displayName(ctx, share.sharer_id);
  ctx.db.prepare('UPDATE shares SET trip_label = NULL, trip_lat = NULL, trip_lng = NULL, trip_radius_m = NULL WHERE id = ?').run(share.id);
  notify(ctx, share.viewer_id!, 'trip_arrived', { shareId: share.id, name, label: share.trip_label }, {
    title: `${name} arrived`,
    body: `${name} has arrived at ${share.trip_label}.`,
  });
}

function personView(ctx: Context, share: ShareRow, point: LocationPoint | null) {
  return {
    userId: share.sharer_id!,
    displayName: displayName(ctx, share.sharer_id),
    shareId: share.id,
    precision: share.precision,
    location: point ? applyPrecision(point, share.precision) : null,
    trip: share.trip_label
      ? { label: share.trip_label, etaSeconds: point && share.precision === 'precise' ? etaSeconds(share, point) : null }
      : null,
  };
}

/** Everyone who is sharing with me. Paused people are listed (without a location) so nothing looks broken. */
export function liveView(ctx: Context, meId: string) {
  expireStale(ctx);
  const rows = ctx.db
    .prepare(`SELECT s.*, u.sharing_paused AS sharer_paused FROM shares s JOIN users u ON u.id = s.sharer_id
              WHERE s.viewer_id = ? AND s.status IN ('active', 'paused')`)
    .all(meId) as unknown as (ShareRow & { sharer_paused: number })[];
  return rows.map((share) => {
    const paused = share.status === 'paused' || !!share.sharer_paused;
    if (paused || !viewableShare(ctx, meId, share.sharer_id!)) {
      return { ...personView(ctx, share, null), paused: true };
    }
    logAccess(ctx, share.sharer_id!, meId, 'live');
    return { ...personView(ctx, share, latestLocation(ctx, share.sharer_id!)), paused: false };
  });
}

export function historyView(ctx: Context, meId: string, subjectId: string, requestedHours: number) {
  const share = viewableShare(ctx, meId, subjectId);
  if (!share) throw new HttpError(403, 'not_shared', 'This person is not sharing their location with you.');
  if (!share.allow_history) throw new HttpError(403, 'history_not_allowed', 'This person shares live location only.');
  const viewer = requireUser(ctx, meId);
  const subject = requireUser(ctx, subjectId);
  const hours = Math.min(requestedHours, entitlementsFor(ctx, viewer).historyHours, retentionHours(ctx, subject));
  // Never reveal where someone was before they agreed to share with this viewer.
  const from = Math.max(ctx.now() - hours * HOUR, share.responded_at ?? ctx.now());
  const rows = ctx.db
    .prepare('SELECT * FROM locations WHERE user_id = ? AND recorded_at >= ? ORDER BY recorded_at ASC')
    .all(subjectId, from) as unknown as LocationRow[];
  logAccess(ctx, subjectId, meId, 'history');
  return { from, hours, points: rows.map((r) => applyPrecision(toPoint(r), share.precision)) };
}
