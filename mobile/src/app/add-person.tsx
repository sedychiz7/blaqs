import { Contact, ContactField, ContactsSortOrder, getPermissionsAsync, requestPermissionsAsync } from 'expo-contacts';
import { router } from 'expo-router';
import * as SMS from 'expo-sms';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, Share as ShareSheet, StyleSheet, Text, TextInput, View } from 'react-native';
import { Badge, Body, Button, Chips, colors, Notice, Row, Screen, Section, ToggleRow } from '../components/ui';
import { api } from '../lib/api';
import { deviceRegion, DURATIONS, showError } from '../lib/format';
import type { Precision, Share } from '../lib/types';

interface Picked {
  name: string;
  phone: string;
}

interface ContactItem {
  id: string;
  name: string;
  phones: string[];
}

type ContactsState = 'unknown' | 'granted' | 'denied';

/**
 * Contacts are read and filtered on the device. Only the number of the person you pick
 * is ever sent to the server — first to check if they're on Blaqs, then to invite them.
 */
export default function AddPerson() {
  const [access, setAccess] = useState<ContactsState>('unknown');
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [onBlaqs, setOnBlaqs] = useState<boolean | null>(null);
  const [direction, setDirection] = useState<'offer' | 'request'>('offer');
  const [duration, setDuration] = useState<number | null>(null);
  const [precision, setPrecision] = useState<Precision>('precise');
  const [allowHistory, setAllowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const region = deviceRegion();

  useEffect(() => {
    getPermissionsAsync().then((p) => {
      setAccess(p.granted ? 'granted' : p.canAskAgain ? 'unknown' : 'denied');
      if (p.granted) void loadContacts();
    });
  }, []);

  async function loadContacts() {
    const all = await Contact.getAllDetails([ContactField.FULL_NAME, ContactField.PHONES], { sortOrder: ContactsSortOrder.GivenName });
    setContacts(
      all
        .map((c) => ({ id: c.id, name: c.fullName ?? 'Unnamed', phones: (c.phones ?? []).map((p) => p.number).filter((n): n is string => !!n) }))
        .filter((c) => c.phones.length > 0),
    );
  }

  async function askForContacts() {
    const p = await requestPermissionsAsync();
    setAccess(p.granted ? 'granted' : 'denied');
    if (p.granted) await loadContacts();
  }

  async function useSystemPicker() {
    // The system picker works without granting full contacts access.
    const c = await Contact.presentPicker();
    if (!c) return;
    const [name, phones] = await Promise.all([c.getFullName(), c.getPhones()]);
    const number = phones.find((p) => p.number)?.number;
    if (number) pick({ name: name || number, phone: number });
  }

  function pick(p: Picked) {
    setPicked(p);
    setOnBlaqs(null);
    api<{ onBlaqs: boolean; valid: boolean }[]>('/contacts/match', { body: { phones: [p.phone], region } })
      .then(([m]) => setOnBlaqs(m?.valid ? m.onBlaqs : null))
      .catch(() => {});
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? contacts.filter((c) => c.name.toLowerCase().includes(q) || c.phones.some((n) => n.includes(q))) : contacts;
  }, [contacts, query]);

  async function send() {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await api<{ share: Share; invite: { url: string; message: string } | null }>('/shares', {
        body: {
          phone: picked.phone,
          region,
          direction,
          ...(direction === 'offer' ? { durationMinutes: duration, precision, allowHistory } : {}),
        },
      });
      if (res.invite) {
        // Invite goes out from the user's own phone, so the recipient sees who it's really from.
        if (await SMS.isAvailableAsync()) await SMS.sendSMSAsync([picked.phone], res.invite.message);
        else await ShareSheet.share({ message: res.invite.message });
      }
      router.back();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  if (picked) {
    return (
      <Screen>
        <Section>
          <Row
            title={picked.name}
            subtitle={picked.phone}
            right={onBlaqs == null ? null : onBlaqs ? <Badge text="On Blaqs" tone="success" /> : <Badge text="Will be invited" />}
            last
          />
        </Section>

        <Section title="What would you like to do?">
          <Chips
            options={[
              { label: 'Share my location', value: 'offer' as const },
              { label: 'Ask to see theirs', value: 'request' as const },
            ]}
            value={direction}
            onChange={setDirection}
          />
        </Section>

        {direction === 'offer' ? (
          <>
            <Section title="For how long?">
              <Chips options={DURATIONS.map((d) => ({ label: d.label, value: d.minutes }))} value={duration} onChange={setDuration} />
            </Section>
            <Section footer="Approximate shows only your general area (about 1 km). History lets them see where you've been, starting from when they accept.">
              <ToggleRow title="Approximate location only" value={precision === 'approximate'} onChange={(v) => setPrecision(v ? 'approximate' : 'precise')} />
              <ToggleRow title="Allow them to see my history" value={allowHistory} onChange={setAllowHistory} last />
            </Section>
            <Notice>Nothing is shared until {picked.name} accepts. You can pause or stop at any time.</Notice>
          </>
        ) : (
          <Notice>
            {picked.name} decides whether to share, how precisely, and for how long. If they decline, they won't be pushed to explain.
          </Notice>
        )}

        <Button title={onBlaqs === false ? 'Send invite by text' : 'Send request'} onPress={send} loading={busy} />
        <Button title="Choose someone else" kind="ghost" onPress={() => setPicked(null)} style={{ marginTop: 8 }} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={{ padding: 16, paddingBottom: 0 }}>
        <Section title="Enter a number">
          <View style={styles.manualRow}>
            <TextInput style={styles.manual} placeholder="Phone number" keyboardType="phone-pad" value={manual} onChangeText={setManual} />
            <Button title="Next" onPress={() => pick({ name: manual, phone: manual })} disabled={manual.length < 6} style={{ height: 40 }} />
          </View>
        </Section>
      </View>

      {access === 'granted' ? (
        <>
          <TextInput style={styles.search} placeholder="Search contacts" value={query} onChangeText={setQuery} clearButtonMode="while-editing" />
          <FlatList
            data={filtered}
            keyExtractor={(c) => c.id}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
            renderItem={({ item }) => (
              <Pressable style={styles.contact} onPress={() => pick({ name: item.name, phone: item.phones[0] })}>
                <Text style={styles.contactName}>{item.name}</Text>
                <Text style={styles.contactPhone}>{item.phones[0]}</Text>
              </Pressable>
            )}
            ListEmptyComponent={<Body muted>No contacts with phone numbers match.</Body>}
          />
        </>
      ) : (
        <View style={{ padding: 16 }}>
          <Section footer="Your contact list stays on this phone. We only receive the number of the person you choose.">
            <Row title="Choose from contacts" subtitle="Allow Blaqs to read your contacts to search them here." last />
            <Button
              title={access === 'denied' ? 'Open Settings' : 'Allow contacts access'}
              onPress={access === 'denied' ? () => Linking.openSettings() : askForContacts}
              style={{ margin: 12, marginTop: 0 }}
            />
          </Section>
          <Button title="Pick one contact instead" kind="secondary" onPress={() => useSystemPicker().catch(showError)} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  manualRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  manual: { flex: 1, height: 40, paddingHorizontal: 8, fontSize: 16 },
  search: { height: 44, marginHorizontal: 16, marginBottom: 8, borderRadius: 10, backgroundColor: colors.card, paddingHorizontal: 12, fontSize: 16 },
  contact: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  contactName: { fontSize: 16, fontWeight: '500', color: colors.text },
  contactPhone: { fontSize: 13, color: colors.muted, marginTop: 2 },
});
