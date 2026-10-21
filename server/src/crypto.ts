import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { HttpError } from './context.js';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function otpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function normalizePhone(raw: string, region: string): string | null {
  const parsed = parsePhoneNumberFromString(raw, region.toUpperCase() as CountryCode);
  return parsed?.isValid() ? parsed.number : null;
}

export function requirePhone(raw: string, region: string): string {
  const phone = normalizePhone(raw, region);
  if (!phone) throw new HttpError(400, 'invalid_phone', 'That does not look like a valid phone number.');
  return phone;
}

/**
 * Phone numbers are stored only as a keyed HMAC. A plain hash would be useless here:
 * the space of phone numbers is small enough to brute-force, the secret pepper is not.
 */
export function phoneHash(e164: string, pepper: string): string {
  return createHmac('sha256', pepper).update(e164).digest('hex');
}
