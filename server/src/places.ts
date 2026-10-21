import { HttpError, type Context } from './context.js';
import { newId } from './crypto.js';
import { distanceMeters, type LocationPoint } from './geo.js';
import { entitlementsFor } from './plans.js';
import { viewableShare } from './shares.js';
import { displayName, notify, requireUser } from './users.js';

interface PlaceRow {
  id: string;
  owner_id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  created_at: number;
}

interface AlertRow {
  id: string;
  place_id: string;
  watcher_id: string;
  subject_id: string;
  status: 'pending' | 'active' | 'declined' | 'revoked';
  last_state: 'inside' | 'outside' | null;
  created_at: number;
  responded_at: number | null;
}

const serializePlace = (p: PlaceRow) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, radiusM: p.radius_m });

export function listPlaces(ctx: Context, meId: string) {
  const rows = ctx.db.prepare('SELECT * FROM places WHERE owner_id = ? ORDER BY created_at').all(meId) as unknown as PlaceRow[];
  return rows.map(serializePlace);
}

export function createPlace(ctx: Context, meId: string, input: { name: string; lat: number; lng: number; radiusM: number }) {
  const me = requireUser(ctx, meId);
  const { n } = ctx.db.prepare('SELECT COUNT(*) AS n FROM places WHERE owner_id = ?').get(meId) as { n: number };
  const { maxPlaces } = entitlementsFor(ctx, me);
  if (n >= maxPlaces) throw new HttpError(402, 'plan_limit', `Your plan allows ${maxPlaces} places. Upgrade to Premium for more.`);
  const id = newId('plc');
  ctx.db
    .prepare('INSERT INTO places (id, owner_id, name, lat, lng, radius_m, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, meId, input.name, input.lat, input.lng, input.radiusM, ctx.now());
  return serializePlace(ctx.db.prepare('SELECT * FROM places WHERE id = ?').get(id) as unknown as PlaceRow);
}

export function deletePlace(ctx: Context, meId: string, placeId: string) {
  const res = ctx.db.prepare('DELETE FROM places WHERE id = ? AND owner_id = ?').run(placeId, meId);
  if (res.changes === 0) throw new HttpError(404, 'place_not_found');
  return { deleted: true };
}

/** Ask someone who already shares with me for permission to be told when they arrive/leave a place. */
export function requestPlaceAlert(ctx: Context, meId: string, placeId: string, subjectId: string) {
  const place = ctx.db.prepare('SELECT * FROM places WHERE id = ? AND owner_id = ?').get(placeId, meId) as PlaceRow | undefined;
  if (!place) throw new HttpError(404, 'place_not_found');
  if (!viewableShare(ctx, meId, subjectId)) throw new HttpError(403, 'not_shared', 'They need to be sharing their location with you first.');
  const existing = ctx.db
    .prepare(`SELECT id FROM place_alerts WHERE place_id = ? AND subject_id = ? AND status IN ('pending', 'active')`)
    .get(placeId, subjectId);
  if (existing) throw new HttpError(409, 'already_exists');
  const id = newId('pla');
  ctx.db
    .prepare(`INSERT INTO place_alerts (id, place_id, watcher_id, subject_id, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`)
    .run(id, placeId, meId, subjectId, ctx.now());
  const me = requireUser(ctx, meId);
  notify(ctx, subjectId, 'place_alert_requested', { alertId: id, from: me.display_name, place: place.name }, {
    title: `${me.display_name} asked for arrival alerts`,
    body: `They'd like to know when you arrive at or leave "${place.name}". You decide.`,
  });
  return serializeAlert(ctx, getAlert(ctx, id), meId);
}

function getAlert(ctx: Context, id: string): AlertRow {
  const row = ctx.db.prepare('SELECT * FROM place_alerts WHERE id = ?').get(id) as AlertRow | undefined;
  if (!row) throw new HttpError(404, 'alert_not_found');
  return row;
}

export function respondPlaceAlert(ctx: Context, meId: string, alertId: string, accept: boolean) {
  const alert = getAlert(ctx, alertId);
  if (alert.subject_id !== meId) throw new HttpError(404, 'alert_not_found');
  if (alert.status !== 'pending') throw new HttpError(409, 'not_pending');
  ctx.db
    .prepare('UPDATE place_alerts SET status = ?, responded_at = ? WHERE id = ?')
    .run(accept ? 'active' : 'declined', ctx.now(), alertId);
  if (accept) notify(ctx, alert.watcher_id, 'place_alert_accepted', { alertId, by: displayName(ctx, meId) });
  return serializeAlert(ctx, getAlert(ctx, alertId), meId);
}

/** Either the watcher or the person being watched can turn an alert off. */
export function stopPlaceAlert(ctx: Context, meId: string, alertId: string) {
  const alert = getAlert(ctx, alertId);
  if (alert.subject_id !== meId && alert.watcher_id !== meId) throw new HttpError(404, 'alert_not_found');
  ctx.db.prepare(`UPDATE place_alerts SET status = 'revoked' WHERE id = ?`).run(alertId);
  return serializeAlert(ctx, getAlert(ctx, alertId), meId);
}

export function listPlaceAlerts(ctx: Context, meId: string) {
  const rows = ctx.db
    .prepare(`SELECT * FROM place_alerts WHERE (watcher_id = ? OR subject_id = ?) AND status IN ('pending', 'active') ORDER BY created_at DESC`)
    .all(meId, meId) as unknown as AlertRow[];
  return rows.map((r) => serializeAlert(ctx, r, meId));
}

function serializeAlert(ctx: Context, a: AlertRow, meId: string) {
  const place = ctx.db.prepare('SELECT * FROM places WHERE id = ?').get(a.place_id) as PlaceRow | undefined;
  return {
    id: a.id,
    role: a.watcher_id === meId ? 'watching' : 'watched',
    status: a.status,
    place: place ? serializePlace(place) : null,
    watcher: { id: a.watcher_id, displayName: displayName(ctx, a.watcher_id) },
    subject: { id: a.subject_id, displayName: displayName(ctx, a.subject_id) },
  };
}

/**
 * Runs on every upload. Uses a small hysteresis band so GPS jitter at the edge of a
 * geofence doesn't spam arrive/leave notifications. Only fires while the underlying
 * share is viewable — pausing sharing also silences place alerts.
 */
export function evaluatePlaceAlerts(ctx: Context, subjectId: string, points: LocationPoint[]) {
  const alerts = ctx.db
    .prepare(`SELECT a.*, p.name, p.lat AS plat, p.lng AS plng, p.radius_m FROM place_alerts a JOIN places p ON p.id = a.place_id
              WHERE a.subject_id = ? AND a.status = 'active'`)
    .all(subjectId) as unknown as (AlertRow & { name: string; plat: number; plng: number; radius_m: number })[];
  if (alerts.length === 0) return;
  const subjectName = displayName(ctx, subjectId);

  for (const alert of alerts) {
    if (!viewableShare(ctx, alert.watcher_id, subjectId)) continue;
    let state = alert.last_state;
    for (const p of points) {
      const d = distanceMeters(p.lat, p.lng, alert.plat, alert.plng);
      const margin = Math.max(30, Math.min(p.accuracy ?? 0, 200));
      const next = d <= alert.radius_m ? 'inside' : d > alert.radius_m + margin ? 'outside' : state;
      if (next && next !== state) {
        if (state !== null) {
          const arrived = next === 'inside';
          notify(ctx, alert.watcher_id, arrived ? 'place_arrived' : 'place_left', { name: subjectName, place: alert.name, at: p.recordedAt }, {
            title: arrived ? `${subjectName} arrived at ${alert.name}` : `${subjectName} left ${alert.name}`,
            body: 'Tap to see it on the map.',
          });
        }
        state = next;
      }
    }
    if (state !== alert.last_state) ctx.db.prepare('UPDATE place_alerts SET last_state = ? WHERE id = ?').run(state, alert.id);
  }
}
