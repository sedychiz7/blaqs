import { DAY, HttpError, MINUTE, type Context } from './context.js';
import { newId, newToken, phoneHash, requirePhone } from './crypto.js';
import { entitlementsFor } from './plans.js';
import { displayName, findUserByPhoneHash, notify, requireUser, type UserRow } from './users.js';

export type ShareStatus = 'pending' | 'active' | 'paused' | 'declined' | 'revoked' | 'expired';
export type Precision = 'precise' | 'approximate';

export interface ShareRow {
  id: string;
  sharer_id: string | null;
  viewer_id: string | null;
  initiated_by: 'sharer' | 'viewer';
  target_phone_hash: string | null;
  invite_token: string | null;
  status: ShareStatus;
  precision: Precision;
  allow_history: number;
  duration_minutes: number | null;
  expires_at: number | null;
  consent_confirmed_at: number | null;
  trip_label: string | null;
  trip_lat: number | null;
  trip_lng: number | null;
  trip_radius_m: number | null;
  created_at: number;
  responded_at: number | null;
  updated_at: number;
}

const OPEN_STATUSES = "('pending', 'active', 'paused')";
const PENDING_TTL = 14 * DAY;

export function expireStale(ctx: Context) {
  const now = ctx.now();
  ctx.db
    .prepare(`UPDATE shares SET status = 'expired', updated_at = ?
              WHERE (status IN ('active', 'paused') AND expires_at IS NOT NULL AND expires_at <= ?)
                 OR (status = 'pending' AND created_at <= ?)`)
    .run(now, now, now - PENDING_TTL);
}

export function getShare(ctx: Context, id: string): ShareRow {
  expireStale(ctx);
  const share = ctx.db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined;
  if (!share) throw new HttpError(404, 'share_not_found');
  return share;
}

function getShareFor(ctx: Context, id: string, userId: string): ShareRow {
  const share = getShare(ctx, id);
  if (share.sharer_id !== userId && share.viewer_id !== userId) throw new HttpError(404, 'share_not_found');
  return share;
}

/** The person whose answer the share is waiting on. */
function responderId(share: ShareRow): string | null {
  return share.initiated_by === 'sharer' ? share.viewer_id : share.sharer_id;
}

function initiatorId(share: ShareRow): string | null {
  return share.initiated_by === 'sharer' ? share.sharer_id : share.viewer_id;
}

/** Distinct people (or not-yet-joined invitees) this user has an open share with. */
function counterparties(ctx: Context, userId: string): Set<string> {
  const rows = ctx.db
    .prepare(`SELECT sharer_id, viewer_id, target_phone_hash FROM shares
              WHERE (sharer_id = ? OR viewer_id = ?) AND status IN ${OPEN_STATUSES}`)
    .all(userId, userId) as Pick<ShareRow, 'sharer_id' | 'viewer_id' | 'target_phone_hash'>[];
  return new Set(rows.map((r) => (r.sharer_id === userId ? (r.viewer_id ?? r.target_phone_hash!) : r.sharer_id ?? r.target_phone_hash!)));
}

function assertConnectionAllowed(ctx: Context, user: UserRow, otherKey: string) {
  const existing = counterparties(ctx, user.id);
  if (existing.has(otherKey)) return;
  const { maxConnections } = entitlementsFor(ctx, user);
  if (existing.size >= maxConnections) {
    throw new HttpError(402, 'plan_limit', `Your plan allows ${maxConnections} people. Upgrade to Premium to add more.`);
  }
}

function clampDuration(minutes: number | null | undefined): number | null {
  if (minutes == null) return null;
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 365 * 24 * 60) {
    throw new HttpError(400, 'invalid_duration', 'Duration must be between 15 minutes and one year.');
  }
  return minutes;
}

export interface CreateShareInput {
  phone: string;
  region?: string;
  /** offer: "I want to share my location with you". request: "May I see your location?" */
  direction: 'offer' | 'request';
  precision?: Precision;
  allowHistory?: boolean;
  durationMinutes?: number | null;
}

export function createShare(ctx: Context, meId: string, input: CreateShareInput) {
  expireStale(ctx);
  const me = requireUser(ctx, meId);
  const phone = requirePhone(input.phone, input.region ?? ctx.config.defaultRegion);
  const targetHash = phoneHash(phone, ctx.config.phonePepper);
  if (targetHash === me.phone_hash) throw new HttpError(400, 'cannot_share_with_self');

  const target = findUserByPhoneHash(ctx, targetHash);
  assertConnectionAllowed(ctx, me, target?.id ?? targetHash);

  const iAmSharer = input.direction === 'offer';
  const sharerId = iAmSharer ? me.id : (target?.id ?? null);
  const viewerId = iAmSharer ? (target?.id ?? null) : me.id;

  const duplicate = target
    ? ctx.db.prepare(`SELECT id FROM shares WHERE status IN ${OPEN_STATUSES} AND sharer_id = ? AND viewer_id = ?`).get(sharerId, viewerId)
    : ctx.db
        .prepare(`SELECT id FROM shares WHERE status IN ${OPEN_STATUSES} AND target_phone_hash = ? AND initiated_by = ?
                  AND (sharer_id = ? OR viewer_id = ?)`)
        .get(targetHash, iAmSharer ? 'sharer' : 'viewer', me.id, me.id);
  if (duplicate) throw new HttpError(409, 'already_exists', 'There is already a share between you for this direction.');

  const now = ctx.now();
  const id = newId('shr');
  const inviteToken = target ? null : newToken();
  // When asking to see someone, the *sharer* chooses precision, history and duration on accept.
  const precision = iAmSharer ? (input.precision ?? 'precise') : 'precise';
  const allowHistory = iAmSharer ? (input.allowHistory ? 1 : 0) : 0;
  const duration = iAmSharer ? clampDuration(input.durationMinutes) : null;

  ctx.db
    .prepare(`INSERT INTO shares (id, sharer_id, viewer_id, initiated_by, target_phone_hash, invite_token, status,
                precision, allow_history, duration_minutes, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`)
    .run(id, sharerId, viewerId, iAmSharer ? 'sharer' : 'viewer', target ? null : targetHash, inviteToken,
      precision, allowHistory, duration, now, now);

  if (target) {
    notify(ctx, target.id, iAmSharer ? 'share_offered' : 'share_requested', { shareId: id, from: me.display_name }, {
      title: iAmSharer ? `${me.display_name} wants to share their location` : `${me.display_name} asked to see your location`,
      body: iAmSharer ? 'Open Blaqs to accept or decline.' : 'Nothing is shared unless you say yes.',
    });
    return { share: serializeShare(ctx, getShare(ctx, id), me.id), invite: null };
  }

  const url = `${ctx.config.publicUrl}/i/${inviteToken}`;
  const message = iAmSharer
    ? `${me.display_name} wants to share their location with you on Blaqs. You choose whether to accept: ${url}`
    : `${me.display_name} would like to see your location on Blaqs. Nothing is shared unless you agree: ${url}`;
  return { share: serializeShare(ctx, getShare(ctx, id), me.id), invite: { url, message } };
}

export interface AcceptInput {
  precision?: Precision;
  allowHistory?: boolean;
  durationMinutes?: number | null;
}

export function acceptShare(ctx: Context, meId: string, shareId: string, input: AcceptInput = {}) {
  const me = requireUser(ctx, meId);
  const share = getShareFor(ctx, shareId, me.id);
  if (share.status !== 'pending') throw new HttpError(409, 'not_pending');
  if (responderId(share) !== me.id) throw new HttpError(403, 'not_yours_to_accept', 'Only the invited person can accept.');
  const otherId = initiatorId(share)!;
  assertConnectionAllowed(ctx, me, otherId);

  const now = ctx.now();
  const iAmSharer = share.sharer_id === me.id;
  const precision = iAmSharer ? (input.precision ?? share.precision) : share.precision;
  const allowHistory = iAmSharer ? (input.allowHistory ? 1 : 0) : share.allow_history;
  const duration = iAmSharer && input.durationMinutes !== undefined ? clampDuration(input.durationMinutes) : share.duration_minutes;

  ctx.db
    .prepare(`UPDATE shares SET status = 'active', precision = ?, allow_history = ?, duration_minutes = ?,
                expires_at = ?, responded_at = ?, consent_confirmed_at = ?, updated_at = ? WHERE id = ?`)
    .run(precision, allowHistory, duration, duration ? now + duration * MINUTE : null, now, now, now, share.id);

  notify(ctx, otherId, 'share_accepted', { shareId: share.id, by: me.display_name }, {
    title: `${me.display_name} accepted`,
    body: iAmSharer ? `You can now see ${me.display_name}'s location.` : `${me.display_name} can now see your location.`,
  });
  sharingChanged(ctx, share.sharer_id!);
  return serializeShare(ctx, getShare(ctx, share.id), me.id);
}

export function declineShare(ctx: Context, meId: string, shareId: string) {
  const share = getShareFor(ctx, shareId, meId);
  if (share.status !== 'pending') throw new HttpError(409, 'not_pending');
  if (responderId(share) !== meId) throw new HttpError(403, 'not_yours_to_decline');
  const now = ctx.now();
  ctx.db.prepare(`UPDATE shares SET status = 'declined', responded_at = ?, updated_at = ? WHERE id = ?`).run(now, now, share.id);
  // No push: a decline should not create pressure. The initiator just sees the status change.
  ctx.hub.send(initiatorId(share)!, { type: 'shares_changed' });
  return serializeShare(ctx, getShare(ctx, share.id), meId);
}

/** Either person can end a share at any time, in any open state, with no approval needed. */
export function stopShare(ctx: Context, meId: string, shareId: string) {
  const share = getShareFor(ctx, shareId, meId);
  if (!['pending', 'active', 'paused'].includes(share.status)) throw new HttpError(409, 'already_closed');
  const now = ctx.now();
  ctx.db
    .prepare(`UPDATE shares SET status = 'revoked', invite_token = NULL, target_phone_hash = NULL, updated_at = ? WHERE id = ?`)
    .run(now, share.id);
  const otherId = share.sharer_id === meId ? share.viewer_id : share.sharer_id;
  if (otherId) notify(ctx, otherId, 'share_stopped', { shareId: share.id, by: displayName(ctx, meId) });
  if (share.sharer_id) sharingChanged(ctx, share.sharer_id);
  return serializeShare(ctx, getShare(ctx, share.id), meId);
}

export interface UpdateShareInput {
  precision?: Precision;
  allowHistory?: boolean;
  paused?: boolean;
  durationMinutes?: number | null;
}

/** Only the person whose location it is may change how it is shared. */
export function updateShare(ctx: Context, meId: string, shareId: string, input: UpdateShareInput) {
  const share = getShareFor(ctx, shareId, meId);
  if (share.sharer_id !== meId) throw new HttpError(403, 'sharer_only', 'Only the person sharing can change these settings.');
  if (share.status !== 'active' && share.status !== 'paused') throw new HttpError(409, 'not_active');

  const now = ctx.now();
  const status = input.paused === undefined ? share.status : input.paused ? 'paused' : 'active';
  const precision = input.precision ?? share.precision;
  const allowHistory = input.allowHistory === undefined ? share.allow_history : input.allowHistory ? 1 : 0;
  let duration = share.duration_minutes;
  let expiresAt = share.expires_at;
  if (input.durationMinutes !== undefined) {
    duration = clampDuration(input.durationMinutes);
    expiresAt = duration ? now + duration * MINUTE : null;
  }
  ctx.db
    .prepare(`UPDATE shares SET status = ?, precision = ?, allow_history = ?, duration_minutes = ?, expires_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, precision, allowHistory, duration, expiresAt, now, share.id);
  ctx.hub.send(share.viewer_id!, { type: 'shares_changed' });
  sharingChanged(ctx, meId);
  return serializeShare(ctx, getShare(ctx, share.id), meId);
}

export function confirmShare(ctx: Context, meId: string, shareId: string) {
  const share = getShareFor(ctx, shareId, meId);
  if (share.sharer_id !== meId) throw new HttpError(403, 'sharer_only');
  ctx.db.prepare('UPDATE shares SET consent_confirmed_at = ?, updated_at = ? WHERE id = ?').run(ctx.now(), ctx.now(), share.id);
  return serializeShare(ctx, getShare(ctx, share.id), meId);
}

export interface TripInput {
  label: string;
  lat: number;
  lng: number;
  radiusM?: number;
}

export function setTrip(ctx: Context, meId: string, shareId: string, trip: TripInput | null) {
  const me = requireUser(ctx, meId);
  const share = getShareFor(ctx, shareId, meId);
  if (share.sharer_id !== meId) throw new HttpError(403, 'sharer_only');
  if (share.status !== 'active') throw new HttpError(409, 'not_active');
  if (trip && !entitlementsFor(ctx, me).trips) throw new HttpError(402, 'premium_required', 'Trips with live ETA are a Premium feature.');
  ctx.db
    .prepare('UPDATE shares SET trip_label = ?, trip_lat = ?, trip_lng = ?, trip_radius_m = ?, updated_at = ? WHERE id = ?')
    .run(trip?.label ?? null, trip?.lat ?? null, trip?.lng ?? null, trip ? (trip.radiusM ?? 150) : null, ctx.now(), share.id);
  ctx.hub.send(share.viewer_id!, { type: 'shares_changed' });
  return serializeShare(ctx, getShare(ctx, share.id), meId);
}

export function pauseAll(ctx: Context, meId: string, paused: boolean) {
  ctx.db.prepare('UPDATE users SET sharing_paused = ? WHERE id = ?').run(paused ? 1 : 0, meId);
  for (const s of activeSharesAsSharer(ctx, meId)) ctx.hub.send(s.viewer_id!, { type: 'shares_changed' });
  sharingChanged(ctx, meId);
  return { paused };
}

export function activeSharesAsSharer(ctx: Context, sharerId: string): ShareRow[] {
  expireStale(ctx);
  return ctx.db.prepare(`SELECT * FROM shares WHERE sharer_id = ? AND status = 'active' AND viewer_id IS NOT NULL`).all(sharerId) as unknown as ShareRow[];
}

/**
 * The single gate for "may viewer see subject's location right now?":
 * an accepted, unexpired, unpaused share, and the subject has not paused everything.
 */
export function viewableShare(ctx: Context, viewerId: string, subjectId: string): ShareRow | null {
  expireStale(ctx);
  const subject = requireUser(ctx, subjectId);
  if (subject.sharing_paused) return null;
  return (ctx.db
    .prepare(`SELECT * FROM shares WHERE sharer_id = ? AND viewer_id = ? AND status = 'active'`)
    .get(subjectId, viewerId) as ShareRow | undefined) ?? null;
}

/**
 * Whether the device should be collecting location at all. We accept uploads while a share
 * the user themselves offered is waiting, so the viewer sees something the moment they accept.
 */
export function shouldCollect(ctx: Context, userId: string): boolean {
  expireStale(ctx);
  const user = requireUser(ctx, userId);
  if (user.sharing_paused) return false;
  return !!ctx.db
    .prepare(`SELECT 1 FROM shares WHERE sharer_id = ? AND (status = 'active' OR (status = 'pending' AND initiated_by = 'sharer')) LIMIT 1`)
    .get(userId);
}

function sharingChanged(ctx: Context, sharerId: string) {
  ctx.hub.send(sharerId, { type: 'sharing_changed', collect: shouldCollect(ctx, sharerId) });
}

export function listShares(ctx: Context, meId: string) {
  expireStale(ctx);
  const rows = ctx.db
    .prepare(`SELECT * FROM shares WHERE (sharer_id = ? OR viewer_id = ?)
              AND (status IN ${OPEN_STATUSES} OR updated_at > ?) ORDER BY created_at DESC`)
    .all(meId, meId, ctx.now() - 7 * DAY) as unknown as ShareRow[];
  return rows.map((r) => serializeShare(ctx, r, meId));
}

export function serializeShare(ctx: Context, s: ShareRow, meId: string) {
  const role = s.sharer_id === meId ? 'sharing' : 'viewing';
  const otherId = role === 'sharing' ? s.viewer_id : s.sharer_id;
  const reminderDue =
    role === 'sharing' && s.status === 'active' &&
    (s.consent_confirmed_at ?? 0) < ctx.now() - ctx.config.consentReminderDays * DAY;
  return {
    id: s.id,
    role,
    status: s.status,
    other: otherId ? { id: otherId, displayName: displayName(ctx, otherId) } : null,
    awaitingJoin: !otherId,
    initiatedByMe: initiatorId(s) === meId,
    needsMyResponse: s.status === 'pending' && responderId(s) === meId,
    precision: s.precision,
    allowHistory: !!s.allow_history,
    durationMinutes: s.duration_minutes,
    expiresAt: s.expires_at,
    acceptedAt: s.responded_at,
    consentReminderDue: reminderDue,
    trip: s.trip_label ? { label: s.trip_label, lat: s.trip_lat, lng: s.trip_lng, radiusM: s.trip_radius_m } : null,
  };
}

export function inviteInfo(ctx: Context, token: string) {
  const share = ctx.db.prepare(`SELECT * FROM shares WHERE invite_token = ? AND status = 'pending'`).get(token) as ShareRow | undefined;
  if (!share) return null;
  return { from: displayName(ctx, initiatorId(share)), direction: share.initiated_by === 'sharer' ? 'offer' : 'request' };
}
