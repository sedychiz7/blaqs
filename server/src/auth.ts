import type { NextFunction, Request, Response } from 'express';
import { HttpError, MINUTE, type Context } from './context.js';
import { newId, newToken, otpCode, phoneHash, requirePhone, safeEqual, sha256 } from './crypto.js';
import { findUserByPhoneHash, type UserRow } from './users.js';
import { tx } from './db.js';

const OTP_TTL = 10 * MINUTE;
const OTP_RESEND_AFTER = 30_000;
const OTP_MAX_ATTEMPTS = 5;

export async function startLogin(ctx: Context, rawPhone: string, region?: string) {
  const phone = requirePhone(rawPhone, region ?? ctx.config.defaultRegion);
  const hash = phoneHash(phone, ctx.config.phonePepper);
  const now = ctx.now();
  const existing = ctx.db.prepare('SELECT expires_at FROM otp_codes WHERE phone_hash = ?').get(hash) as { expires_at: number } | undefined;
  if (existing && existing.expires_at - OTP_TTL + OTP_RESEND_AFTER > now) {
    throw new HttpError(429, 'slow_down', 'Please wait a moment before requesting another code.');
  }
  const code = otpCode();
  ctx.db
    .prepare('INSERT OR REPLACE INTO otp_codes (phone_hash, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0)')
    .run(hash, sha256(code), now + OTP_TTL);
  await ctx.sms.send(phone, `Your Blaqs code is ${code}. It expires in 10 minutes.`);
  return { sent: true };
}

export function verifyLogin(ctx: Context, rawPhone: string, code: string, displayName?: string, region?: string) {
  const phone = requirePhone(rawPhone, region ?? ctx.config.defaultRegion);
  const hash = phoneHash(phone, ctx.config.phonePepper);
  const now = ctx.now();
  const row = ctx.db.prepare('SELECT * FROM otp_codes WHERE phone_hash = ?').get(hash) as
    | { code_hash: string; expires_at: number; attempts: number }
    | undefined;
  if (!row || row.expires_at < now || row.attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(401, 'code_expired');
  if (!safeEqual(row.code_hash, sha256(code))) {
    ctx.db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone_hash = ?').run(hash);
    throw new HttpError(401, 'wrong_code');
  }

  let user = findUserByPhoneHash(ctx, hash);
  if (!user && !displayName?.trim()) throw new HttpError(400, 'name_required', 'Tell us what to call you.');

  return tx(ctx.db, () => {
    ctx.db.prepare('DELETE FROM otp_codes WHERE phone_hash = ?').run(hash);
    let isNew = false;
    if (!user) {
      isNew = true;
      const id = newId('usr');
      ctx.db.prepare('INSERT INTO users (id, phone_hash, display_name, created_at) VALUES (?, ?, ?, ?)').run(id, hash, displayName!.trim(), now);
      user = findUserByPhoneHash(ctx, hash)!;
      claimInvites(ctx, user);
    }
    const token = newToken();
    ctx.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(sha256(token), user.id, now);
    return { token, userId: user.id, isNew };
  });
}

/**
 * Attaches invitations sent to this phone number before the person had an account.
 * They stay `pending`: joining the app is not the same as agreeing to share.
 */
function claimInvites(ctx: Context, user: UserRow) {
  const now = ctx.now();
  ctx.db
    .prepare(`UPDATE shares SET sharer_id = ?, target_phone_hash = NULL, invite_token = NULL, updated_at = ?
              WHERE target_phone_hash = ? AND sharer_id IS NULL AND status = 'pending'`)
    .run(user.id, now, user.phone_hash);
  ctx.db
    .prepare(`UPDATE shares SET viewer_id = ?, target_phone_hash = NULL, invite_token = NULL, updated_at = ?
              WHERE target_phone_hash = ? AND viewer_id IS NULL AND status = 'pending'`)
    .run(user.id, now, user.phone_hash);
}

export function authenticateToken(ctx: Context, token: string): string | null {
  if (!token) return null;
  const row = ctx.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(sha256(token)) as { user_id: string } | undefined;
  return row?.user_id ?? null;
}

export function signOut(ctx: Context, token: string) {
  ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

declare global {
  namespace Express {
    interface Request {
      userId: string;
      token: string;
    }
  }
}

export function requireAuth(ctx: Context) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    const userId = authenticateToken(ctx, token);
    if (!userId) return next(new HttpError(401, 'unauthorized'));
    req.userId = userId;
    req.token = token;
    next();
  };
}
