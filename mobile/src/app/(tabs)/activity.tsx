import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Linking, Platform } from 'react-native';
import { Body, Button, Row, Screen, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useLive } from '../../lib/session';
import type { AppEvent } from '../../lib/types';

function describe(e: AppEvent): { title: string; subtitle?: string } {
  const p = e.payload;
  switch (e.type) {
    case 'sos':
      return { title: `🚨 SOS from ${p.from}`, subtitle: p.message ?? 'Tap to open their location in Maps' };
    case 'check_in':
      return { title: `${p.from} checked in`, subtitle: p.message };
    case 'share_offered':
      return { title: `${p.from} wants to share their location with you` };
    case 'share_requested':
      return { title: `${p.from} asked to see your location` };
    case 'share_accepted':
      return { title: `${p.by} accepted your share` };
    case 'share_stopped':
      return { title: `${p.by ?? 'Someone'} stopped a share` };
    case 'place_alert_requested':
      return { title: `${p.from} asked for alerts at ${p.place}` };
    case 'place_alert_accepted':
      return { title: `${p.by} allowed arrival alerts` };
    case 'place_arrived':
      return { title: `${p.name} arrived at ${p.place}` };
    case 'place_left':
      return { title: `${p.name} left ${p.place}` };
    case 'trip_arrived':
      return { title: `${p.name} arrived at ${p.label}` };
    default:
      return { title: e.type };
  }
}

function openInMaps(lat: number, lng: number, label: string) {
  const url = Platform.OS === 'ios' ? `http://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(label)}` : `geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`;
  void Linking.openURL(url);
}

export default function Activity() {
  const { data } = useLive(() => api<AppEvent[]>('/events'), ['event']);

  useFocusEffect(
    useCallback(() => {
      void api('/events/read', { body: {} }).catch(() => {});
    }, []),
  );

  const events = data ?? [];
  const sos = events.filter((e) => e.type === 'sos' && Date.now() - e.createdAt < 24 * 3600_000);

  return (
    <Screen>
      {sos.map((e) => (
        <Section key={e.id} title="Emergency">
          <Row title={describe(e).title} subtitle={`${timeAgo(e.createdAt)} · ${e.payload.message ?? 'No message'}`} last />
          <Button title="Open location in Maps" kind="danger" onPress={() => openInMaps(e.payload.lat, e.payload.lng, `SOS: ${e.payload.from}`)} style={{ margin: 12 }} />
        </Section>
      ))}
      <Section title="Recent">
        {events.length ? (
          events.map((e, i) => {
            const d = describe(e);
            const hasPlace = e.payload.lat != null && e.payload.lng != null;
            return (
              <Row
                key={e.id}
                title={d.title}
                subtitle={[d.subtitle, timeAgo(e.createdAt)].filter(Boolean).join(' · ')}
                onPress={hasPlace ? () => openInMaps(e.payload.lat, e.payload.lng, d.title) : undefined}
                last={i === events.length - 1}
              />
            );
          })
        ) : (
          <Row title="Nothing yet" subtitle="Requests, check-ins and arrival alerts will show up here." last />
        )}
      </Section>
      <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
        Want to see who viewed your location? Open Privacy → Who viewed my location.
      </Body>
    </Screen>
  );
}
