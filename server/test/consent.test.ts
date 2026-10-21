import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE } from '../src/context.js';
import { PHONES, setup } from './helpers.js';

async function offerAndAccept(t: ReturnType<typeof setup>, opts: object = {}) {
  const alice = await t.signUp(PHONES.alice, 'Alice');
  const bob = await t.signUp(PHONES.bob, 'Bob');
  const { body } = await alice.post('/shares', { phone: PHONES.bob, direction: 'offer', ...opts }).expect(201);
  await bob.post(`/shares/${body.share.id}/accept`).expect(200);
  return { alice, bob, shareId: body.share.id as string };
}

describe('sharing requires both people to agree', () => {
  it('keeps an offered share invisible until the viewer accepts', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const bob = await t.signUp(PHONES.bob, 'Bob');
    const { body } = await alice.post('/shares', { phone: PHONES.bob, direction: 'offer' }).expect(201);
    expect(body.share.status).toBe('pending');
    await alice.post('/locations', { points: [t.point(37.77, -122.41)] }).expect(200);

    expect((await bob.get('/people')).body).toEqual([]);
    expect(t.notifier.sent.at(-1)!.message.title).toContain('Alice wants to share');

    await bob.post(`/shares/${body.share.id}/accept`).expect(200);
    const people = (await bob.get('/people')).body;
    expect(people).toHaveLength(1);
    expect(people[0].location.lat).toBeCloseTo(37.77);
  });

  it('does not let the requester accept their own request to see someone', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const bob = await t.signUp(PHONES.bob, 'Bob');
    const { body } = await bob.post('/shares', { phone: PHONES.alice, direction: 'request' }).expect(201);
    await bob.post(`/shares/${body.share.id}/accept`).expect(403);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200);
    expect((await bob.get('/people')).body).toEqual([]);
  });

  it('lets the sharer choose precision and history when accepting a request', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const bob = await t.signUp(PHONES.bob, 'Bob');
    const { body } = await bob.post('/shares', { phone: PHONES.alice, direction: 'request', precision: 'precise', allowHistory: true }).expect(201);
    // Whatever the requester asked for is ignored; the sharer decides.
    expect(body.share.allowHistory).toBe(false);
    await alice.post(`/shares/${body.share.id}/accept`, { precision: 'approximate' }).expect(200);
    await alice.post('/locations', { points: [t.point(37.774929, -122.419416, { speed: 3 })] }).expect(200);

    const [person] = (await bob.get('/people')).body;
    expect(person.location).toMatchObject({ lat: 37.77, lng: -122.42, speed: null });
    expect(person.location.accuracy).toBeGreaterThanOrEqual(1000);
    await bob.get(`/people/${alice.id}/history`).expect(403);
  });

  it('drops uploads when nobody has agreed to receive them', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const res = await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200);
    expect(res.body).toEqual({ stored: 0, collect: false });
    const { n } = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number };
    expect(n).toBe(0);
  });

  it('attaches invites to people who join later, still pending their approval', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const { body } = await alice.post('/shares', { phone: '(415) 555-0103', direction: 'request' }).expect(201);
    expect(body.invite.url).toMatch(/^https:\/\/blaqs\.test\/i\//);
    expect(body.invite.message).toContain('Nothing is shared unless you agree');
    const landing = await t.api.get(new URL(body.invite.url).pathname).expect(200);
    expect(landing.text).toContain('Alice asked to see your location');

    const carol = await t.signUp(PHONES.carol, 'Carol');
    const [share] = (await carol.get('/shares')).body;
    expect(share).toMatchObject({ status: 'pending', role: 'sharing', needsMyResponse: true, other: { displayName: 'Alice' } });
    await t.api.get(new URL(body.invite.url).pathname).expect(200).then((r) => expect(r.text).toContain('expired'));
  });
});

describe('the sharer stays in control', () => {
  it('either person can stop a share at any time', async () => {
    const t = setup();
    const { alice, bob, shareId } = await offerAndAccept(t);
    await bob.post(`/shares/${shareId}/stop`).expect(200);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200).then((r) => expect(r.body.collect).toBe(false));
    expect((await bob.get('/people')).body).toEqual([]);
  });

  it('only the sharer can change precision or pause', async () => {
    const t = setup();
    const { alice, bob, shareId } = await offerAndAccept(t);
    await bob.patch(`/shares/${shareId}`, { precision: 'precise', paused: false }).expect(403);
    await alice.patch(`/shares/${shareId}`, { paused: true }).expect(200);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200).then((r) => expect(r.body.collect).toBe(false));
    const [person] = (await bob.get('/people')).body;
    expect(person).toMatchObject({ paused: true, location: null });
  });

  it('pause-all hides location from everyone without ending the shares', async () => {
    const t = setup();
    const { alice, bob } = await offerAndAccept(t);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200);
    await alice.post('/me/pause-all', { paused: true }).expect(200);
    expect((await bob.get('/people')).body[0]).toMatchObject({ paused: true, location: null });
    await alice.post('/me/pause-all', { paused: false }).expect(200);
    expect((await bob.get('/people')).body[0].location).not.toBeNull();
  });

  it('time-limited shares expire on their own', async () => {
    const t = setup();
    const { alice, bob } = await offerAndAccept(t, { durationMinutes: 60 });
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200);
    expect((await bob.get('/people')).body).toHaveLength(1);
    t.clock.now += 61 * MINUTE;
    expect((await bob.get('/people')).body).toEqual([]);
    expect((await alice.get('/shares')).body[0].status).toBe('expired');
  });

  it('records every view in the sharer’s access log', async () => {
    const t = setup();
    const { alice, bob } = await offerAndAccept(t);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200);
    await bob.get('/people').expect(200);
    const log = (await alice.get('/me/access-log')).body;
    expect(log).toEqual([{ viewer: { id: bob.id, displayName: 'Bob' }, kind: 'live', at: t.clock.now }]);
  });

  it('asks the sharer to re-confirm long-running shares', async () => {
    const t = setup();
    const { alice, shareId } = await offerAndAccept(t);
    t.clock.now += 31 * 24 * HOUR;
    expect((await alice.get('/shares')).body[0].consentReminderDue).toBe(true);
    await alice.post(`/shares/${shareId}/confirm`).expect(200);
    expect((await alice.get('/shares')).body[0].consentReminderDue).toBe(false);
  });
});

describe('history', () => {
  it('only exists when the sharer opted in, and never before they agreed', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const bob = await t.signUp(PHONES.bob, 'Bob');
    const { body } = await alice.post('/shares', { phone: PHONES.bob, direction: 'offer', allowHistory: true }).expect(201);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200); // before Bob accepted
    t.clock.now += MINUTE;
    await bob.post(`/shares/${body.share.id}/accept`).expect(200);
    t.clock.now += MINUTE;
    await alice.post('/locations', { points: [t.point(2, 2)] }).expect(200);

    const history = (await bob.get(`/people/${alice.id}/history?hours=24`)).body;
    expect(history.points.map((p: { lat: number }) => p.lat)).toEqual([2]);
  });

  it('can be wiped by the sharer', async () => {
    const t = setup();
    const { alice } = await offerAndAccept(t);
    await alice.post('/locations', { points: [t.point(1, 1)] }).expect(200);
    expect((await alice.del('/me/history')).body.deleted).toBe(1);
  });
});

describe('places, trips and safety', () => {
  it('arrival alerts need the subject’s approval and fire on crossing the fence', async () => {
    const t = setup();
    const { alice, bob } = await offerAndAccept(t);
    const place = (await bob.post('/places', { name: 'School', lat: 37.0, lng: -122.0, radiusM: 100 }).expect(201)).body;
    const alert = (await bob.post(`/places/${place.id}/alerts`, { subjectId: alice.id }).expect(201)).body;
    expect(alert.status).toBe('pending');

    await alice.post('/locations', { points: [t.point(37.01, -122.0)] }); // outside, but not yet approved
    await alice.post(`/place-alerts/${alert.id}/respond`, { accept: true }).expect(200);
    await alice.post('/locations', { points: [t.point(37.01, -122.0)] });
    t.clock.now += MINUTE;
    await alice.post('/locations', { points: [t.point(37.0001, -122.0)] });

    const events = (await bob.get('/events')).body.map((e: { type: string }) => e.type);
    expect(events).toContain('place_arrived');
    expect(t.notifier.sent.at(-1)!.message.title).toBe('Alice arrived at School');
  });

  it('refuses arrival alerts for someone not sharing with you', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    const bob = await t.signUp(PHONES.bob, 'Bob');
    const place = (await bob.post('/places', { name: 'Work', lat: 1, lng: 1, radiusM: 100 })).body;
    await bob.post(`/places/${place.id}/alerts`, { subjectId: alice.id }).expect(403);
  });

  it('trips are premium and notify on arrival', async () => {
    const t = setup();
    const { alice, bob, shareId } = await offerAndAccept(t);
    const trip = { label: 'Home', lat: 37.0, lng: -122.0 };
    await alice.put(`/shares/${shareId}/trip`, trip).expect(402);
    await alice.post('/billing/dev-grant').expect(200);
    await alice.put(`/shares/${shareId}/trip`, trip).expect(200);

    await alice.post('/locations', { points: [t.point(37.01, -122.0, { speed: 10 })] });
    const [person] = (await bob.get('/people')).body;
    expect(person.trip.etaSeconds).toBeGreaterThan(100);

    await alice.post('/locations', { points: [t.point(37.0, -122.0)] });
    expect((await bob.get('/events')).body[0].type).toBe('trip_arrived');
    expect((await alice.get('/shares')).body[0].trip).toBeNull();

    await alice.put(`/shares/${shareId}/trip`, trip).expect(200);
    await alice.del(`/shares/${shareId}/trip`).expect(200).then((r) => expect(r.body.trip).toBeNull());
  });

  it('SOS reaches everyone with an accepted share, even when paused, and is free', async () => {
    const t = setup();
    const { alice, bob, shareId } = await offerAndAccept(t);
    await alice.patch(`/shares/${shareId}`, { paused: true });
    const res = await alice.post('/sos', { lat: 1.23456, lng: 2.34567 }).expect(200);
    expect(res.body.notified).toBe(1);
    const [event] = (await bob.get('/events')).body;
    expect(event).toMatchObject({ type: 'sos', payload: { lat: 1.23456, lng: 2.34567 } });
  });
});

describe('plans and account', () => {
  it('limits free plans and lifts the limit with premium', async () => {
    const t = setup();
    const alice = await t.signUp(PHONES.alice, 'Alice');
    for (let i = 0; i < 5; i++) await alice.post('/shares', { phone: `+1 415 555 01${10 + i}`, direction: 'offer' }).expect(201);
    await alice.post('/shares', { phone: '+1 415 555 0199', direction: 'offer' }).expect(402);

    await t.api
      .post('/billing/revenuecat')
      .set('authorization', 'Bearer rc-secret')
      .send({ event: { type: 'INITIAL_PURCHASE', app_user_id: alice.id, expiration_at_ms: t.clock.now + 30 * 24 * HOUR } })
      .expect(200);
    await alice.post('/shares', { phone: '+1 415 555 0199', direction: 'offer' }).expect(201);
  });

  it('rejects billing webhooks without the secret', async () => {
    const t = setup();
    await t.api.post('/billing/revenuecat').send({ event: { type: 'INITIAL_PURCHASE', app_user_id: 'x' } }).expect(401);
  });

  it('deleting an account removes the person’s data everywhere', async () => {
    const t = setup();
    const { alice, bob } = await offerAndAccept(t);
    await alice.post('/locations', { points: [t.point(1, 1)] });
    await alice.del('/me').expect(200);
    await alice.get('/me').expect(401);
    expect((await bob.get('/people')).body).toEqual([]);
    const { n } = t.ctx.db.prepare('SELECT COUNT(*) AS n FROM locations').get() as { n: number };
    expect(n).toBe(0);
  });

  it('never stores raw phone numbers', async () => {
    const t = setup();
    await t.signUp(PHONES.alice, 'Alice');
    const dump = JSON.stringify(t.ctx.db.prepare('SELECT * FROM users').all());
    expect(dump).not.toContain('4155550101');
  });
});
