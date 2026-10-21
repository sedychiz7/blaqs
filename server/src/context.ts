import type { DB } from './db.js';
import type { Notifier } from './notifier.js';
import type { RealtimeHub } from './realtime.js';

export interface Config {
  /** Secret used to HMAC phone numbers. Raw numbers are never stored. */
  phonePepper: string;
  /** Default region for numbers written without a country code, e.g. "US". */
  defaultRegion: string;
  publicUrl: string;
  revenueCatWebhookSecret?: string;
  /** Lets a signed-in user grant themselves premium. Never enable in production. */
  devBilling: boolean;
  /** Days after which a sharer is asked to re-confirm each active share. */
  consentReminderDays: number;
}

export interface SmsSender {
  send(phoneE164: string, body: string): Promise<void>;
}

export interface Context {
  db: DB;
  config: Config;
  notifier: Notifier;
  sms: SmsSender;
  hub: RealtimeHub;
  now: () => number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
