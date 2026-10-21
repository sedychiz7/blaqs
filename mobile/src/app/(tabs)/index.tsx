import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../components/ui';
import { api } from '../../lib/api';
import { etaText, showError, timeAgo } from '../../lib/format';
import { subscribe } from '../../lib/realtime';
import { useLive, useSession } from '../../lib/session';
import type { Person, Share } from '../../lib/types';

export default function MapScreen() {
  const { me, refreshMe } = useSession();
  const map = useRef<MapView>(null);
  const people = useLive(() => api<Person[]>('/people'), ['shares_changed', 'event']);
  const shares = useLive(() => api<Share[]>('/shares'), ['shares_changed', 'event', 'sharing_changed']);
  const [focused, setFocused] = useState<string | null>(null);

  // Live location pushes update one person in place instead of refetching everything.
  useEffect(
    () =>
      subscribe((msg) => {
        if (msg.type !== 'location') return;
        people.setData((list) => {
          if (!list) return list;
          const found = list.some((p) => p.userId === msg.person.userId);
          const next = { ...msg.person, paused: false };
          return found ? list.map((p) => (p.userId === next.userId ? next : p)) : [...list, next];
        });
      }),
    [people.setData],
  );

  const outgoing = (shares.data ?? []).filter((s) => s.role === 'sharing' && s.status === 'active');
  const reminders = outgoing.filter((s) => s.consentReminderDue);
  const pendingForMe = (shares.data ?? []).filter((s) => s.needsMyResponse).length;
  const visible = (people.data ?? []).filter((p) => p.location);

  function focus(p: Person) {
    if (!p.location) return;
    setFocused(p.userId);
    map.current?.animateToRegion({ latitude: p.location.lat, longitude: p.location.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
  }

  async function togglePauseAll() {
    try {
      await api('/me/pause-all', { body: { paused: !me?.sharingPaused } });
      await refreshMe();
    } catch (err) {
      showError(err);
    }
  }

  async function sos() {
    Alert.alert(
      'Send SOS?',
      'Everyone you share with will get an urgent alert with your exact location — even if you have paused sharing with them.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: async () => {
            try {
              const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
              const res = await api<{ notified: number }>('/sos', {
                body: { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracy: loc.coords.accuracy },
              });
              Alert.alert('SOS sent', `${res.notified} ${res.notified === 1 ? 'person was' : 'people were'} alerted.`);
            } catch (err) {
              showError(err);
            }
          },
        },
      ],
    );
  }

  async function checkIn() {
    const send = async (message: string) => {
      try {
        const loc = await Location.getLastKnownPositionAsync().catch(() => null);
        const res = await api<{ notified: number }>('/check-ins', {
          body: { message, lat: loc?.coords.latitude, lng: loc?.coords.longitude },
        });
        Alert.alert('Checked in', `Sent to ${res.notified} ${res.notified === 1 ? 'person' : 'people'}.`);
      } catch (err) {
        showError(err);
      }
    };
    Alert.alert('Check in', 'Let the people who can see you know you are OK.', [
      { text: "I'm OK 👍", onPress: () => send("I'm OK") },
      { text: 'Arrived safely 🏠', onPress: () => send('Arrived safely') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function confirm(share: Share, keep: boolean) {
    try {
      await api(`/shares/${share.id}/${keep ? 'confirm' : 'stop'}`, { body: {} });
      await shares.reload();
    } catch (err) {
      showError(err);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <MapView ref={map} style={StyleSheet.absoluteFill} showsUserLocation showsMyLocationButton>
        {visible.map((p) => (
          <Marker
            key={p.userId}
            coordinate={{ latitude: p.location!.lat, longitude: p.location!.lng }}
            title={p.displayName ?? 'Someone'}
            description={`${p.precision === 'approximate' ? 'Approximate · ' : ''}${timeAgo(p.location!.recordedAt)}`}
            pinColor={focused === p.userId ? colors.primary : undefined}
            onCalloutPress={() => router.push(`/person/${p.userId}`)}
          />
        ))}
        {visible
          .filter((p) => p.precision === 'approximate')
          .map((p) => (
            <Circle
              key={`${p.userId}-area`}
              center={{ latitude: p.location!.lat, longitude: p.location!.lng }}
              radius={p.location!.accuracy ?? 1000}
              strokeColor="rgba(91,75,255,0.5)"
              fillColor="rgba(91,75,255,0.12)"
            />
          ))}
      </MapView>

      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <Pressable style={[styles.banner, me?.sharingPaused && { backgroundColor: colors.warningSoft }]} onPress={togglePauseAll}>
          <Text style={styles.bannerTitle}>
            {me?.sharingPaused
              ? 'Sharing paused for everyone'
              : outgoing.length
                ? `Sharing with ${outgoing.length} ${outgoing.length === 1 ? 'person' : 'people'}`
                : 'Not sharing your location'}
          </Text>
          <Text style={styles.bannerAction}>{me?.sharingPaused ? 'Resume' : outgoing.length ? 'Pause all' : ''}</Text>
        </Pressable>

        {pendingForMe > 0 ? (
          <Pressable style={styles.banner} onPress={() => router.push('/(tabs)/people')}>
            <Text style={styles.bannerTitle}>
              {pendingForMe} {pendingForMe === 1 ? 'request needs' : 'requests need'} your answer
            </Text>
            <Text style={styles.bannerAction}>Review</Text>
          </Pressable>
        ) : null}

        {reminders.slice(0, 1).map((s) => (
          <View key={s.id} style={[styles.banner, { flexDirection: 'column', alignItems: 'stretch' }]}>
            <Text style={styles.bannerTitle}>Still happy sharing with {s.other?.displayName}?</Text>
            <Text style={{ color: colors.muted, marginVertical: 4 }}>We check in every so often so sharing never runs on autopilot.</Text>
            <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
              <Text style={styles.bannerAction} onPress={() => confirm(s, true)}>
                Keep sharing
              </Text>
              <Text style={[styles.bannerAction, { color: colors.danger }]} onPress={() => confirm(s, false)}>
                Stop
              </Text>
            </View>
          </View>
        ))}
      </SafeAreaView>

      <View style={styles.bottom} pointerEvents="box-none">
        <View style={styles.actions}>
          <Pressable style={styles.fab} onPress={checkIn}>
            <Text style={styles.fabText}>Check in</Text>
          </Pressable>
          <Pressable style={[styles.fab, { backgroundColor: colors.danger }]} onPress={sos}>
            <Text style={[styles.fabText, { color: '#fff' }]}>SOS</Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
          {(people.data ?? []).map((p) => (
            <Pressable key={p.userId} style={styles.person} onPress={() => focus(p)}>
              <Text style={styles.personName}>{p.displayName}</Text>
              <Text style={styles.personMeta}>
                {p.paused
                  ? 'Paused sharing'
                  : p.location
                    ? `${timeAgo(p.location.recordedAt)}${p.location.battery != null ? ` · 🔋${Math.round(p.location.battery * 100)}%` : ''}`
                    : 'Waiting for location'}
              </Text>
              {p.trip ? <Text style={styles.trip}>→ {p.trip.label}: {etaText(p.trip.etaSeconds)}</Text> : null}
            </Pressable>
          ))}
          <Pressable style={[styles.person, styles.add]} onPress={() => router.push('/add-person')}>
            <Text style={[styles.personName, { color: colors.primary }]}>+ Add someone</Text>
            <Text style={styles.personMeta}>They choose whether to accept</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const shadow = { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 3 };

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  banner: { ...shadow, backgroundColor: colors.card, borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  bannerTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
  bannerAction: { fontSize: 15, fontWeight: '600', color: colors.primary },
  bottom: { position: 'absolute', bottom: 16, left: 0, right: 0, gap: 10 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, paddingHorizontal: 16 },
  fab: { ...shadow, backgroundColor: colors.card, borderRadius: 24, paddingHorizontal: 18, height: 48, justifyContent: 'center' },
  fabText: { fontWeight: '700', fontSize: 15, color: colors.text },
  person: { ...shadow, backgroundColor: colors.card, borderRadius: 14, padding: 14, minWidth: 160 },
  add: { borderWidth: 1, borderColor: colors.primarySoft },
  personName: { fontSize: 16, fontWeight: '700', color: colors.text },
  personMeta: { fontSize: 13, color: colors.muted, marginTop: 3 },
  trip: { fontSize: 13, color: colors.primary, marginTop: 4, fontWeight: '600' },
});
