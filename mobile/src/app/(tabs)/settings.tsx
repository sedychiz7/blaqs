import { router } from 'expo-router';
import { Alert, Share as ShareSheet } from 'react-native';
import { Badge, Button, Chips, Row, Screen, Section, ToggleRow } from '../../components/ui';
import { api } from '../../lib/api';
import { showError, timeAgo } from '../../lib/format';
import { useLive, useSession } from '../../lib/session';
import type { AccessLogEntry } from '../../lib/types';

const RETENTION = [
  { label: 'Off', value: 0 },
  { label: '1 hour', value: 1 },
  { label: '1 day', value: 24 },
  { label: '7 days', value: 168 },
  { label: '30 days', value: 720 },
];

export default function Settings() {
  const { me, refreshMe, signOut } = useSession();
  const log = useLive(() => api<AccessLogEntry[]>('/me/access-log?days=7'), []);

  if (!me) return null;
  const maxHistory = me.entitlements.historyHours;

  async function update(body: object) {
    try {
      await api('/me', { method: 'PATCH', body });
      await refreshMe();
    } catch (err) {
      showError(err);
    }
  }

  async function exportData() {
    try {
      const data = await api('/me/export');
      await ShareSheet.share({ title: 'My Blaqs data', message: JSON.stringify(data, null, 2) });
    } catch (err) {
      showError(err);
    }
  }

  function confirmDestructive(title: string, message: string, action: () => Promise<void>) {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: title, style: 'destructive', onPress: () => action().catch(showError) },
    ]);
  }

  return (
    <Screen>
      <Section title="Sharing">
        <ToggleRow
          title="Pause sharing with everyone"
          subtitle="People will see you as paused. SOS still works."
          value={me.sharingPaused}
          onChange={(paused) => api('/me/pause-all', { body: { paused } }).then(refreshMe, showError)}
          last
        />
      </Section>

      <Section
        title="Location history"
        footer={`How long your past locations are kept. Only people you allow history for can see it, and never from before they were approved. Your plan keeps up to ${maxHistory / 24 >= 1 ? `${maxHistory / 24} days` : `${maxHistory} hours`}.`}
      >
        <Chips
          options={RETENTION.filter((r) => r.value <= maxHistory)}
          value={RETENTION.find((r) => r.value === me.historyRetentionHours)?.value ?? me.historyRetentionHours}
          onChange={(historyRetentionHours) => update({ historyRetentionHours })}
        />
        <Row
          title="Delete my location history now"
          onPress={() =>
            confirmDestructive('Delete history', 'This permanently removes every stored location point.', async () => {
              await api('/me/history', { method: 'DELETE' });
              Alert.alert('Deleted', 'Your location history was removed.');
            })
          }
          last
        />
      </Section>

      <Section title="Who viewed my location" footer="Every time someone opens your location or history, it appears here. Last 7 days.">
        {(log.data ?? []).slice(0, 20).map((e, i, arr) => (
          <Row
            key={`${e.viewer.id}-${e.at}`}
            title={e.viewer.displayName ?? 'Someone'}
            subtitle={`${e.kind === 'history' ? 'Viewed your history' : 'Viewed your live location'} · ${timeAgo(e.at)}`}
            last={i === arr.length - 1}
          />
        ))}
        {log.data && log.data.length === 0 ? <Row title="No views in the last 7 days" last /> : null}
      </Section>

      <Section title="Plan">
        <Row
          title={me.entitlements.plan === 'premium' ? 'Blaqs Premium' : 'Blaqs Free'}
          subtitle={
            me.entitlements.plan === 'premium' && me.premiumUntil
              ? `Renews or ends ${new Date(me.premiumUntil).toLocaleDateString()}`
              : `${me.entitlements.maxConnections} people · ${me.entitlements.maxPlaces} places · 24 h history`
          }
          right={me.entitlements.plan === 'premium' ? <Badge text="Active" tone="success" /> : <Badge text="Upgrade" />}
          onPress={() => router.push('/premium')}
          last
        />
      </Section>

      <Section title="Your data">
        <Row title="App permissions" subtitle="See and change what Blaqs can access" onPress={() => router.push('/permissions')} />
        <Row title="Export my data" subtitle="Everything we store about you, as JSON" onPress={exportData} last />
      </Section>

      <Button title="Sign out" kind="secondary" onPress={() => signOut().then(() => router.replace('/sign-in'))} style={{ marginBottom: 12 }} />
      <Button
        title="Delete my account"
        kind="danger"
        onPress={() =>
          confirmDestructive('Delete account', 'All your shares, places, history and logs are erased immediately. This cannot be undone.', async () => {
            await api('/me', { method: 'DELETE' });
            await signOut();
            router.replace('/sign-in');
          })
        }
      />
    </Screen>
  );
}
