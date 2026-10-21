import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Body, Button, Chips, Notice, Screen } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useSession } from '../../lib/session';
import type { LocationPoint } from '../../lib/types';

const RANGES = [
  { label: '1 h', value: 1 },
  { label: '24 h', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
];

export default function PersonHistory() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me } = useSession();
  const map = useRef<MapView>(null);
  const [hours, setHours] = useState(24);
  const [points, setPoints] = useState<LocationPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ points: LocationPoint[] }>(`/people/${id}/history?hours=${hours}`)
      .then((res) => {
        setPoints(res.points);
        setError(null);
        if (res.points.length) {
          map.current?.fitToCoordinates(
            res.points.map((p) => ({ latitude: p.lat, longitude: p.lng })),
            { edgePadding: { top: 40, bottom: 40, left: 40, right: 40 }, animated: true },
          );
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load history.'));
  }, [id, hours]);

  const maxHours = me?.entitlements.historyHours ?? 24;
  const last = points?.at(-1);

  return (
    <Screen scroll={false}>
      <View style={{ height: 380 }}>
        <MapView ref={map} style={StyleSheet.absoluteFill}>
          {points && points.length > 1 ? (
            <Polyline coordinates={points.map((p) => ({ latitude: p.lat, longitude: p.lng }))} strokeColor="#5B4BFF" strokeWidth={4} />
          ) : null}
          {last ? <Marker coordinate={{ latitude: last.lat, longitude: last.lng }} title={timeAgo(last.recordedAt)} /> : null}
        </MapView>
      </View>
      <View style={{ padding: 16 }}>
        <Chips options={RANGES.filter((r) => r.value <= maxHours)} value={hours} onChange={setHours} />
        {error ? <Notice tone="warning">{error}</Notice> : null}
        {points && !error ? (
          <Body muted>
            {points.length ? `${points.length} points. Shown only from when they agreed to share history with you.` : 'No history in this range yet.'}
          </Body>
        ) : null}
        {maxHours < 720 ? (
          <Button title="See up to 30 days with Premium" kind="secondary" onPress={() => router.push('/premium')} style={{ marginTop: 16 }} />
        ) : null}
        <Body muted style={{ fontSize: 13, marginTop: 12 }}>They can see that you viewed their history.</Body>
      </View>
    </Screen>
  );
}
