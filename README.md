# Blaqs

A location-sharing app built around consent. Share your live location (including in the background) with people you pick from your contacts — but only once **both of you agree**, only for as long as you want, and with everything visible to the person being located.

```
server/   TypeScript API: Express + WebSocket + SQLite (node:sqlite). Enforces every consent rule.
mobile/   Expo (React Native) app: background location, contacts picker, push, maps, Premium.
```

## Consent model

All of these are enforced **on the server**, so a modified client can't get around them:

| Rule | How |
| --- | --- |
| Nothing is shared until both people agree | A share starts `pending`. Only the *other* person can accept it. The person who sent it can't. |
| The person being located is in charge | Only the sharer can change precision, history, duration or pause. When someone *asks* to see you, you choose those settings when you accept. |
| Either side can stop at any time | `POST /shares/:id/stop` works in any open state and needs no approval. |
| No hidden tracking | Background collection only runs while there's an accepted share. Android shows a persistent notification and iOS shows the location indicator. There is no stealth mode. |
| No collecting "just in case" | Uploads are thrown away when nobody is receiving them, and the server tells the device to stop. |
| History needs a separate opt-in | Off by default. It never shows locations from before the viewer was approved, and it is limited by the sharer's own retention setting. |
| You can see who looked | Every live or history view goes into the sharer's access log ("Who viewed my location"). |
| Consent gets re-checked | After 30 days, long-running shares ask the sharer "Still happy sharing with X?" |
| Arrival alerts need their own approval | "Tell me when Sam gets to School" only works if Sam approves that specific place. Pausing also turns alerts off. |
| Contacts stay on the phone | The app reads contacts on the device. Only the number you pick is sent. Phone numbers are stored only as a keyed HMAC, never in plain text. |
| Invites come from you | People who aren't on Blaqs yet get a text from *your* phone. Joining the app doesn't accept the invite; it still waits for their answer. |
| Declining is low-pressure | A decline sends no push notification. The status just changes. |
| Your data is yours | Export everything as JSON, wipe your history, or delete your account. Deleting cascades to all your data. |

## Features

**Free:** live and background sharing with up to 5 people, time-limited shares (1 h / 8 h / 1 day / until I stop), approximate mode (snapped to a ~1 km grid so it can't be averaged out), pause one person or everyone, **SOS** (sends your exact location to everyone you share with, even if paused), check-ins ("I'm OK", "Arrived safely"), battery level, 2 places with approved arrival/departure alerts, 24 h history, access log, export and delete.

**Premium** (via RevenueCat): up to 100 people, 50 places, **trips with live ETA** and an automatic "arrived" alert, and 30-day history.

Safety and privacy features are never behind the paywall.

## Running it

### Server

Requires Node ≥ 22.13.

```bash
cd server
npm install
npm test            # 21 tests covering the consent rules
DEV_BILLING=1 npm run dev   # http://localhost:4000. In dev, OTP codes are printed to the console.
```

| Env var | Purpose |
| --- | --- |
| `PHONE_PEPPER` | **Required in production.** Secret used to HMAC phone numbers. |
| `DATABASE_PATH` | SQLite file (default `blaqs.db`). |
| `PUBLIC_URL` | Base URL for invite links. |
| `DEFAULT_REGION` | Region for numbers entered without a country code (default `US`). |
| `EXPO_PUSH=1`, `EXPO_ACCESS_TOKEN` | Send real push notifications through Expo. |
| `REVENUECAT_WEBHOOK_SECRET` | Authorization for `POST /billing/revenuecat`. |
| `DEV_BILLING=1` | Allows `POST /billing/dev-grant` outside production. |

Before production, plug an SMS provider (Twilio, etc.) into `sms` in `server/src/index.ts`. It refuses to start the SMS sender in production without one.

### Mobile app

Background location, contacts and in-app purchases need native code, so use a **development build**, not Expo Go:

```bash
cd mobile
npm install
npx expo run:ios        # or run:android, or: npx eas-cli build --profile development
```

Configure in `mobile/app.json`:
- `extra.apiUrl`: your server URL. On a physical phone, use your machine's LAN IP, not `localhost`.
- `extra.eas.projectId`: needed for push tokens.
- `extra.revenueCatIosKey` / `revenueCatAndroidKey`: Premium purchases. Set RevenueCat's webhook to `POST {server}/billing/revenuecat`.
- `react-native-maps` → `androidGoogleMapsApiKey`: Google Maps on Android.

### App store notes

Both stores review background location closely. The app is set up to pass that review: it explains each permission in the app before the system prompt, only asks for "Always" as a separate optional step, always shows the indicator, and collects nothing when nobody is receiving. On Google Play you will still need to fill in the background-location declaration and record a short video of the consent flow.

## API overview

`POST /auth/start|verify` · `GET/PATCH/DELETE /me` · `POST /me/pause-all` · `GET /me/access-log` · `GET /me/export` · `DELETE /me/history` · `POST /contacts/match` · `GET/POST /shares` · `POST /shares/:id/accept|decline|stop|confirm` · `PATCH /shares/:id` · `PUT/DELETE /shares/:id/trip` · `POST /locations` · `GET /people` · `GET /people/:id/history` · `GET/POST/DELETE /places` · `POST /places/:id/alerts` · `GET /place-alerts` · `POST /place-alerts/:id/respond|stop` · `POST /sos` · `POST /check-ins` · `GET /events` · WebSocket `/ws?token=…` for live updates.
