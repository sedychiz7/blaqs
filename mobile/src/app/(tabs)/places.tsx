import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TextInput } from 'react-native';
import { Badge, Body, Button, Chips, colors, Row, Screen, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { showError } from '../../lib/format';
import { useLive, useSession } from '../../lib/session';
import type { Person, Place, PlaceAlert } from '../../lib/types';

const RADII = [
  { label: '100 m', value: 100 },
  { label: '250 m', value: 250 },
  { label: '500 m', value: 500 },
];

export default function Places() {
  const { me } = useSession();
  const places = useLive(() => api<Place[]>('/places'), []);
  const alerts = useLive(() => api<PlaceAlert[]>('/place-alerts'), ['event']);
  const people = useLive(() => api<Person[]>('/people'), ['shares_changed']);
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(250);
  const [busy, setBusy] = useState(false);
  const [pickingFor, setPickingFor] = useState<Place | null>(null);

  async function addHere() {
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) throw new Error('Location permission is needed to save your current spot as a place.');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await api('/places', { body: { name: name.trim(), lat: loc.coords.latitude, lng: loc.coords.longitude, radiusM: radius } });
      setName('');
      await places.reload();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function requestAlert(place: Place, person: Person) {
    try {
      await api(`/places/${place.id}/alerts`, { body: { subjectId: person.userId } });
      Alert.alert('Request sent', `${person.displayName} will be asked to approve alerts for "${place.name}".`);
      setPickingFor(null);
      await alerts.reload();
    } catch (err) {
      showError(err);
    }
  }

  async function act(alert: PlaceAlert, action: 'accept' | 'decline' | 'stop') {
    try {
      if (action === 'stop') await api(`/place-alerts/${alert.id}/stop`, { body: {} });
      else await api(`/place-alerts/${alert.id}/respond`, { body: { accept: action === 'accept' } });
      await alerts.reload();
    } catch (err) {
      showError(err);
    }
  }

  const aboutMe = (alerts.data ?? []).filter((a) => a.role === 'watched');
  const mine = (alerts.data ?? []).filter((a) => a.role === 'watching');
  const limit = me?.entitlements.maxPlaces ?? 0;
  const candidates = (people.data ?? []).filter((p) => !p.paused);

  return (
    <Screen>
      {aboutMe.length ? (
        <Section title="Alerts about you" footer="These people are told when you arrive at or leave a place — only because you approved it.">
          {aboutMe.map((a, i) => (
            <Row
              key={a.id}
              title={`${a.watcher.displayName} · ${a.place?.name}`}
              subtitle={a.status === 'pending' ? 'Wants arrival & departure alerts' : 'Gets arrival & departure alerts'}
              last={i === aboutMe.length - 1}
              right={
                a.status === 'pending' ? (
                  <>
                    <Button title="No" kind="ghost" onPress={() => act(a, 'decline')} style={{ height: 36, paddingHorizontal: 8 }} />
                    <Button title="Allow" onPress={() => act(a, 'accept')} style={{ height: 36 }} />
                  </>
                ) : (
                  <Button title="Turn off" kind="danger" onPress={() => act(a, 'stop')} style={{ height: 36 }} />
                )
              }
            />
          ))}
        </Section>
      ) : null}

      <Section title={`Your places (${places.data?.length ?? 0}/${limit})`}>
        {(places.data ?? []).map((p) => {
          const watching = mine.filter((a) => a.place?.id === p.id);
          return (
            <Row
              key={p.id}
              title={p.name}
              subtitle={
                watching.length
                  ? watching.map((a) => `${a.subject.displayName}${a.status === 'pending' ? ' (asked)' : ''}`).join(', ')
                  : `${p.radiusM} m radius · no alerts yet`
              }
              onPress={() =>
                Alert.alert(p.name, undefined, [
                  { text: 'Get arrival alerts…', onPress: () => setPickingFor(p) },
                  { text: 'Delete place', style: 'destructive', onPress: () => api(`/places/${p.id}`, { method: 'DELETE' }).then(places.reload, showError) },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
              right={watching.some((a) => a.status === 'active') ? <Badge text="Alerts on" tone="success" /> : undefined}
            />
          );
        })}
        <TextInput style={styles.input} placeholder="Name this place, e.g. Home, School" value={name} onChangeText={setName} />
        <Chips options={RADII} value={radius} onChange={setRadius} />
        <Button title="Save my current location" onPress={addHere} loading={busy} disabled={!name.trim()} style={{ margin: 12, marginTop: 0 }} />
      </Section>

      {pickingFor ? (
        <Section title={`Who should you hear about at ${pickingFor.name}?`} footer="They'll be asked to approve. Only people sharing with you are listed.">
          {candidates.length ? (
            candidates.map((person, i) => (
              <Row
                key={person.userId}
                title={person.displayName ?? 'Someone'}
                right={<Button title="Ask" onPress={() => requestAlert(pickingFor, person)} style={{ height: 36 }} />}
                last={i === candidates.length - 1}
              />
            ))
          ) : (
            <Row title="No one is sharing with you right now" last />
          )}
          <Button title="Cancel" kind="ghost" onPress={() => setPickingFor(null)} />
        </Section>
      ) : null}

      {mine.length ? (
        <Section title="Arrival alerts you get">
          {mine.map((a, i) => (
            <Row
              key={a.id}
              title={`${a.subject.displayName} · ${a.place?.name}`}
              subtitle={a.status === 'pending' ? 'Waiting for their approval' : 'Active'}
              right={<Button title={a.status === 'pending' ? 'Cancel' : 'Stop'} kind="danger" onPress={() => act(a, 'stop')} style={{ height: 36 }} />}
              last={i === mine.length - 1}
            />
          ))}
        </Section>
      ) : null}

      {me?.entitlements.plan === 'free' ? (
        <Button title={`Unlock up to 50 places with Premium`} kind="secondary" onPress={() => router.push('/premium')} />
      ) : null}
      <Body muted style={{ fontSize: 13, marginTop: 12, textAlign: 'center' }}>
        Arrival alerts only work for people who share their location with you and approve each place.
      </Body>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: { height: 48, marginHorizontal: 12, marginTop: 12, borderRadius: 10, backgroundColor: colors.bg, paddingHorizontal: 12, fontSize: 16 },
});
