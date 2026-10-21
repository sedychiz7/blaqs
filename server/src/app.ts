import express, { type NextFunction, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import * as account from './account.js';
import { requireAuth, signOut, startLogin, verifyLogin } from './auth.js';
import { DAY, HttpError, type Context } from './context.js';
import { normalizePhone, phoneHash } from './crypto.js';
import { historyView, liveView, uploadLocations } from './locations.js';
import * as places from './places.js';
import * as safety from './safety.js';
import * as shares from './shares.js';
import { findUserByPhoneHash } from './users.js';

const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const precision = z.enum(['precise', 'approximate']);
const duration = z.number().int().nullable().optional();

const schemas = {
  authStart: z.object({ phone: z.string().min(3), region: z.string().length(2).optional() }),
  authVerify: z.object({
    phone: z.string().min(3),
    code: z.string().regex(/^\d{6}$/),
    displayName: z.string().max(60).optional(),
    region: z.string().length(2).optional(),
  }),
  updateMe: z.object({
    displayName: z.string().min(1).max(60).optional(),
    historyRetentionHours: z.number().int().min(0).max(24 * 365).optional(),
    pushToken: z.string().max(300).nullable().optional(),
  }),
  createShare: z.object({
    phone: z.string().min(3),
    region: z.string().length(2).optional(),
    direction: z.enum(['offer', 'request']),
    precision: precision.optional(),
    allowHistory: z.boolean().optional(),
    durationMinutes: duration,
  }),
  acceptShare: z.object({ precision: precision.optional(), allowHistory: z.boolean().optional(), durationMinutes: duration }),
  updateShare: z.object({
    precision: precision.optional(),
    allowHistory: z.boolean().optional(),
    paused: z.boolean().optional(),
    durationMinutes: duration,
  }),
  trip: z.object({ label: z.string().min(1).max(80), lat, lng, radiusM: z.number().min(50).max(2000).optional() }),
  pauseAll: z.object({ paused: z.boolean() }),
  locations: z.object({
    points: z
      .array(
        z.object({
          lat,
          lng,
          accuracy: z.number().min(0).nullable().optional(),
          speed: z.number().nullable().optional(),
          heading: z.number().nullable().optional(),
          battery: z.number().min(0).max(1).nullable().optional(),
          recordedAt: z.number().int(),
        }),
      )
      .min(1)
      .max(500),
  }),
  place: z.object({ name: z.string().min(1).max(60), lat, lng, radiusM: z.number().min(50).max(5000) }),
  placeAlert: z.object({ subjectId: z.string() }),
  respond: z.object({ accept: z.boolean() }),
  sos: z.object({ lat, lng, accuracy: z.number().nullable().optional(), message: z.string().max(280).optional() }),
  checkIn: z.object({ message: z.string().min(1).max(280), lat: lat.optional(), lng: lng.optional(), viewerIds: z.array(z.string()).optional() }),
  contactsMatch: z.object({ phones: z.array(z.string()).max(200), region: z.string().length(2).optional() }),
};

const CONTACT_LOOKUPS_PER_DAY = 1000;

export function createApp(ctx: Context) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  const auth = requireAuth(ctx);
  const body = <T extends z.ZodType>(schema: T, req: Request): z.infer<T> => schema.parse(req.body);
  const param = (req: Request, name: string) => String(req.params[name]);

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // --- Auth -------------------------------------------------------------------------------
  app.post('/auth/start', async (req, res) => {
    const { phone, region } = body(schemas.authStart, req);
    res.json(await startLogin(ctx, phone, region));
  });
  app.post('/auth/verify', (req, res) => {
    const { phone, code, displayName, region } = body(schemas.authVerify, req);
    res.json(verifyLogin(ctx, phone, code, displayName, region));
  });
  app.post('/auth/signout', auth, (req, res) => {
    signOut(ctx, req.token);
    res.json({ ok: true });
  });

  // --- Me & privacy -----------------------------------------------------------------------
  app.get('/me', auth, (req, res) => res.json(account.me(ctx, req.userId)));
  app.patch('/me', auth, (req, res) => res.json(account.updateMe(ctx, req.userId, body(schemas.updateMe, req))));
  app.post('/me/pause-all', auth, (req, res) => res.json(shares.pauseAll(ctx, req.userId, body(schemas.pauseAll, req).paused)));
  app.get('/me/access-log', auth, (req, res) => res.json(account.accessLog(ctx, req.userId, Number(req.query.days) || 7)));
  app.delete('/me/history', auth, (req, res) => res.json(account.deleteHistory(ctx, req.userId)));
  app.get('/me/export', auth, (req, res) => res.json(account.exportData(ctx, req.userId)));
  app.delete('/me', auth, (req, res) => res.json(account.deleteAccount(ctx, req.userId)));

  // --- Contacts ---------------------------------------------------------------------------
  // The app only sends numbers of contacts the user picked, never the whole address book.
  const lookups = new Map<string, { day: number; count: number }>();
  app.post('/contacts/match', auth, (req, res) => {
    const { phones, region } = body(schemas.contactsMatch, req);
    const day = Math.floor(ctx.now() / DAY);
    const usage = lookups.get(req.userId);
    const count = usage?.day === day ? usage.count : 0;
    if (count + phones.length > CONTACT_LOOKUPS_PER_DAY) throw new HttpError(429, 'slow_down');
    lookups.set(req.userId, { day, count: count + phones.length });
    res.json(
      phones.map((raw) => {
        const e164 = normalizePhone(raw, region ?? ctx.config.defaultRegion);
        return { phone: raw, valid: !!e164, onBlaqs: !!e164 && !!findUserByPhoneHash(ctx, phoneHash(e164, ctx.config.phonePepper)) };
      }),
    );
  });

  // --- Shares (consent) -------------------------------------------------------------------
  app.get('/shares', auth, (req, res) => res.json(shares.listShares(ctx, req.userId)));
  app.post('/shares', auth, (req, res) => res.status(201).json(shares.createShare(ctx, req.userId, body(schemas.createShare, req))));
  app.post('/shares/:id/accept', auth, (req, res) =>
    res.json(shares.acceptShare(ctx, req.userId, param(req, 'id'), body(schemas.acceptShare, req))),
  );
  app.post('/shares/:id/decline', auth, (req, res) => res.json(shares.declineShare(ctx, req.userId, param(req, 'id'))));
  app.post('/shares/:id/stop', auth, (req, res) => res.json(shares.stopShare(ctx, req.userId, param(req, 'id'))));
  app.post('/shares/:id/confirm', auth, (req, res) => res.json(shares.confirmShare(ctx, req.userId, param(req, 'id'))));
  app.patch('/shares/:id', auth, (req, res) =>
    res.json(shares.updateShare(ctx, req.userId, param(req, 'id'), body(schemas.updateShare, req))),
  );
  app.put('/shares/:id/trip', auth, (req, res) => res.json(shares.setTrip(ctx, req.userId, param(req, 'id'), body(schemas.trip, req))));
  app.delete('/shares/:id/trip', auth, (req, res) => res.json(shares.setTrip(ctx, req.userId, param(req, 'id'), null)));

  // --- Locations --------------------------------------------------------------------------
  app.post('/locations', auth, (req, res) => {
    const { points } = body(schemas.locations, req);
    res.json(
      uploadLocations(
        ctx,
        req.userId,
        points.map((p) => ({ ...p, accuracy: p.accuracy ?? null, speed: p.speed ?? null, heading: p.heading ?? null, battery: p.battery ?? null })),
      ),
    );
  });
  app.get('/people', auth, (req, res) => res.json(liveView(ctx, req.userId)));
  app.get('/people/:id/history', auth, (req, res) =>
    res.json(historyView(ctx, req.userId, param(req, 'id'), Math.max(1, Number(req.query.hours) || 24))),
  );

  // --- Places -----------------------------------------------------------------------------
  app.get('/places', auth, (req, res) => res.json(places.listPlaces(ctx, req.userId)));
  app.post('/places', auth, (req, res) => res.status(201).json(places.createPlace(ctx, req.userId, body(schemas.place, req))));
  app.delete('/places/:id', auth, (req, res) => res.json(places.deletePlace(ctx, req.userId, param(req, 'id'))));
  app.post('/places/:id/alerts', auth, (req, res) =>
    res.status(201).json(places.requestPlaceAlert(ctx, req.userId, param(req, 'id'), body(schemas.placeAlert, req).subjectId)),
  );
  app.get('/place-alerts', auth, (req, res) => res.json(places.listPlaceAlerts(ctx, req.userId)));
  app.post('/place-alerts/:id/respond', auth, (req, res) =>
    res.json(places.respondPlaceAlert(ctx, req.userId, param(req, 'id'), body(schemas.respond, req).accept)),
  );
  app.post('/place-alerts/:id/stop', auth, (req, res) => res.json(places.stopPlaceAlert(ctx, req.userId, param(req, 'id'))));

  // --- Safety & activity ------------------------------------------------------------------
  app.post('/sos', auth, (req, res) => res.json(safety.sendSos(ctx, req.userId, body(schemas.sos, req))));
  app.post('/check-ins', auth, (req, res) => res.json(safety.sendCheckIn(ctx, req.userId, body(schemas.checkIn, req))));
  app.get('/events', auth, (req, res) => res.json(safety.listEvents(ctx, req.userId)));
  app.post('/events/read', auth, (req, res) => res.json(safety.markEventsRead(ctx, req.userId)));

  // --- Billing ----------------------------------------------------------------------------
  app.post('/billing/revenuecat', (req, res) => res.json(account.handleRevenueCatWebhook(ctx, req.header('authorization'), req.body)));
  app.post('/billing/dev-grant', auth, (req, res) => res.json(account.devGrantPremium(ctx, req.userId, 30)));

  // --- Invite landing page ----------------------------------------------------------------
  app.get('/i/:token', (req, res) => {
    const info = shares.inviteInfo(ctx, param(req, 'token'));
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    const text = !info
      ? 'This invitation has expired or was withdrawn.'
      : info.direction === 'offer'
        ? `${esc(info.from ?? 'Someone')} wants to share their location with you.`
        : `${esc(info.from ?? 'Someone')} asked to see your location. Nothing is shared unless you agree in the app.`;
    res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blaqs invitation</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem">
<h1>Blaqs</h1><p>${text}</p><p>Install Blaqs and sign in with this phone number to respond.</p></body>`);
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: 'invalid_request', issues: err.issues });
    console.error(err);
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
