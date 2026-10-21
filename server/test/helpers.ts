import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Context } from '../src/context.js';
import { openDb } from '../src/db.js';
import { MemoryNotifier } from '../src/notifier.js';
import { RealtimeHub } from '../src/realtime.js';

export function setup() {
  const sms: { phone: string; body: string }[] = [];
  const clock = { now: Date.UTC(2026, 9, 1, 12) };
  const notifier = new MemoryNotifier();
  const ctx: Context = {
    db: openDb(':memory:'),
    config: {
      phonePepper: 'test-pepper',
      defaultRegion: 'US',
      publicUrl: 'https://blaqs.test',
      revenueCatWebhookSecret: 'rc-secret',
      devBilling: true,
      consentReminderDays: 30,
    },
    notifier,
    sms: { send: async (phone, body) => void sms.push({ phone, body }) },
    hub: new RealtimeHub(),
    now: () => clock.now,
  };
  const app = createApp(ctx);
  const api = request(app);

  async function signUp(phone: string, displayName: string) {
    await api.post('/auth/start').send({ phone }).expect(200);
    const code = sms.at(-1)!.body.match(/\d{6}/)![0];
    const res = await api.post('/auth/verify').send({ phone, code, displayName }).expect(200);
    const token: string = res.body.token;
    const as = {
      id: res.body.userId as string,
      get: (url: string) => api.get(url).set('authorization', `Bearer ${token}`),
      post: (url: string, data?: object) => api.post(url).set('authorization', `Bearer ${token}`).send(data ?? {}),
      patch: (url: string, data: object) => api.patch(url).set('authorization', `Bearer ${token}`).send(data),
      put: (url: string, data: object | null) => api.put(url).set('authorization', `Bearer ${token}`).send(data as object),
      del: (url: string) => api.delete(url).set('authorization', `Bearer ${token}`),
    };
    await as.patch('/me', { pushToken: `ExponentPushToken[${displayName}]` }).expect(200);
    return as;
  }

  const point = (lat: number, lng: number, extra: object = {}) => ({ lat, lng, accuracy: 10, recordedAt: clock.now, ...extra });

  return { ctx, api, sms, clock, notifier, signUp, point };
}

export const PHONES = {
  alice: '+1 415 555 0101',
  bob: '+1 415 555 0102',
  carol: '+1 415 555 0103',
};
