import { createServer } from 'node:http';
import { createApp } from './app.js';
import { authenticateToken } from './auth.js';
import type { Config, Context, SmsSender } from './context.js';
import { openDb } from './db.js';
import { ConsoleNotifier, ExpoPushNotifier } from './notifier.js';
import { attachRealtime, RealtimeHub } from './realtime.js';

const production = process.env.NODE_ENV === 'production';

function required(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (production) throw new Error(`${name} must be set in production`);
  return devDefault;
}

const config: Config = {
  phonePepper: required('PHONE_PEPPER', 'dev-only-pepper-change-me'),
  defaultRegion: process.env.DEFAULT_REGION ?? 'US',
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:4000',
  revenueCatWebhookSecret: process.env.REVENUECAT_WEBHOOK_SECRET,
  devBilling: !production && process.env.DEV_BILLING === '1',
  consentReminderDays: Number(process.env.CONSENT_REMINDER_DAYS ?? 30),
};

// Plug a real provider (Twilio, MessageBird, ...) in here for production.
const sms: SmsSender = {
  async send(phone, body) {
    if (production) throw new Error('Configure an SMS provider before running in production');
    console.log(`[sms → ${phone}] ${body}`);
  },
};

const ctx: Context = {
  db: openDb(process.env.DATABASE_PATH ?? 'blaqs.db'),
  config,
  notifier: process.env.EXPO_PUSH ? new ExpoPushNotifier(process.env.EXPO_ACCESS_TOKEN) : new ConsoleNotifier(),
  sms,
  hub: new RealtimeHub(),
  now: Date.now,
};

const server = createServer(createApp(ctx));
attachRealtime(server, ctx.hub, (token) => authenticateToken(ctx, token));
const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`Blaqs API listening on :${port}`));
