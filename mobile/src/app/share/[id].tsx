import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Body, Button, Chips, Notice, Row, Screen, Section, ToggleRow } from '../../components/ui';
import { api } from '../../lib/api';
import { DURATIONS, showError, untilText } from '../../lib/format';
import { useLive, useSession } from '../../lib/session';
import { sendCurrentLocation } from '../../lib/tracking';
import type { Place, Precision, Share } from '../../lib/types';

export default function ShareDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, refreshMe } = useSession();
  const { data: shares, reload } = useLive(() => api<Share[]>('/shares'), ['shares_changed']);
  const places = useLive(() => api<Place[]>('/places'), []);
  const share = shares?.find((s) => s.id === id);

  // Settings chosen while accepting someone's request to see me.
  const [precision, setPrecision] = useState<Precision>('precise');
  const [allowHistory, setAllowHistory] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  if (!share) return <Screen><Body muted>Loading…</Body></Screen>;
  const name = share.other?.displayName ?? 'this person';
  const isSharer = share.role === 'sharing';

  async function call(path: string, body: object = {}, method?: string) {
    try {
      await api(`/shares/${share!.id}${path}`, { method, body });
      await reload();
      await refreshMe();
    } catch (err) {
      showError(err);
    }
  }

  function stop() {
    Alert.alert(
      isSharer ? `Stop sharing with ${name}?` : `Stop seeing ${name}?`,
      isSharer ? 'They will no longer see your location. You can share again later.' : 'You will no longer see their location.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Stop', style: 'destructive', onPress: () => call('/stop').then(() => router.back()) },
      ],
    );
  }

  if (share.status === 'pending' && share.needsMyResponse) {
    return (
      <Screen>
        <Stack.Screen options={{ title: isSharer ? 'Location request' : 'Location offer' }} />
        {isSharer ? (
          <>
            <Notice>{name} would like to see your location. You decide how — or say no.</Notice>
            <Section title="How long?">
              <Chips options={DURATIONS.map((d) => ({ label: d.label, value: d.minutes }))} value={duration} onChange={setDuration} />
            </Section>
            <Section footer="Approximate shows only your general area (about 1 km).">
              <ToggleRow title="Approximate location only" value={precision === 'approximate'} onChange={(v) => setPrecision(v ? 'approximate' : 'precise')} />
              <ToggleRow title={`Let ${name} see my history`} subtitle="Only from now on, never before" value={allowHistory} onChange={setAllowHistory} last />
            </Section>
            <Button
              title={`Share with ${name}`}
              onPress={async () => {
                await call('/accept', { precision, allowHistory, durationMinutes: duration });
                await sendCurrentLocation().catch(() => {});
                router.back();
              }}
            />
          </>
        ) : (
          <>
            <Notice>{name} wants to share their location with you. Accepting means you'll be able to see where they are.</Notice>
            <Button title="Accept" onPress={() => call('/accept').then(() => router.back())} />
          </>
        )}
        <Button title="Decline" kind="ghost" onPress={() => call('/decline').then(() => router.back())} style={{ marginTop: 8 }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: name }} />
      <Section>
        <Row title="Status" subtitle={share.status === 'paused' ? 'Paused' : share.status === 'active' ? 'Active' : share.status} />
        <Row title="Duration" subtitle={untilText(share.expiresAt)} />
        <Row title="Precision" subtitle={share.precision === 'precise' ? 'Exact location' : 'Approximate area (~1 km)'} last />
      </Section>

      {isSharer && (share.status === 'active' || share.status === 'paused') ? (
        <>
          <Section title="Your controls" footer="Only you can change how your location is shared.">
            <ToggleRow title="Pause" subtitle={`${name} will see you as paused`} value={share.status === 'paused'} onChange={(paused) => call('', { paused }, 'PATCH')} />
            <ToggleRow
              title="Approximate location only"
              value={share.precision === 'approximate'}
              onChange={(v) => call('', { precision: v ? 'approximate' : 'precise' }, 'PATCH')}
            />
            <ToggleRow title="Allow history" value={share.allowHistory} onChange={(allowHistory) => call('', { allowHistory }, 'PATCH')} last />
          </Section>
          <Section title="Change duration (starts now)">
            <Chips
              options={DURATIONS.map((d) => ({ label: d.label, value: d.minutes }))}
              value={share.durationMinutes}
              onChange={(durationMinutes) => call('', { durationMinutes }, 'PATCH')}
            />
          </Section>

          <Section
            title="Trip with live ETA"
            footer={me?.entitlements.trips ? `${name} sees your ETA and is told when you arrive.` : 'Premium: let them follow your ETA and get an arrival alert.'}
          >
            {share.trip ? (
              <Row title={`Heading to ${share.trip.label}`} right={<Button title="End" kind="ghost" onPress={() => call('/trip', {}, 'DELETE')} style={{ height: 36 }} />} last />
            ) : (places.data ?? []).length ? (
              (places.data ?? []).map((p, i, arr) => (
                <Row
                  key={p.id}
                  title={`Start trip to ${p.name}`}
                  onPress={() => call('/trip', { label: p.name, lat: p.lat, lng: p.lng, radiusM: p.radiusM }, 'PUT')}
                  last={i === arr.length - 1}
                />
              ))
            ) : (
              <Row title="Save a place first" subtitle="Trips use your saved places as destinations." onPress={() => router.push('/(tabs)/places')} last />
            )}
          </Section>
        </>
      ) : null}

      {!isSharer && share.allowHistory && share.other ? (
        <Button title="View history" kind="secondary" onPress={() => router.push(`/person/${share.other!.id}`)} style={{ marginBottom: 12 }} />
      ) : null}

      {['pending', 'active', 'paused'].includes(share.status) ? (
        <Button title={isSharer ? 'Stop sharing' : 'Stop seeing their location'} kind="danger" onPress={stop} />
      ) : null}
    </Screen>
  );
}
