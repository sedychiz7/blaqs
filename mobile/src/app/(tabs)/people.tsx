import { router } from 'expo-router';
import { Badge, Body, Button, Row, Screen, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { showError, untilText } from '../../lib/format';
import { useLive } from '../../lib/session';
import type { Share } from '../../lib/types';

const statusBadge = (s: Share) => {
  if (s.status === 'paused') return <Badge text="Paused" tone="warning" />;
  if (s.status === 'pending') return <Badge text={s.needsMyResponse ? 'Needs you' : 'Waiting'} tone={s.needsMyResponse ? 'danger' : 'neutral'} />;
  if (s.status === 'active') return <Badge text={s.precision === 'approximate' ? 'Approx.' : 'Live'} tone="success" />;
  return <Badge text={s.status[0].toUpperCase() + s.status.slice(1)} />;
};

export default function People() {
  const { data, reload } = useLive(() => api<Share[]>('/shares'), ['shares_changed', 'event', 'sharing_changed']);
  const shares = data ?? [];
  const requests = shares.filter((s) => s.needsMyResponse);
  const sharing = shares.filter((s) => s.role === 'sharing' && ['active', 'paused'].includes(s.status));
  const viewing = shares.filter((s) => s.role === 'viewing' && ['active', 'paused'].includes(s.status));
  const waiting = shares.filter((s) => s.status === 'pending' && !s.needsMyResponse);
  const name = (s: Share) => s.other?.displayName ?? (s.awaitingJoin ? 'Invited — not on Blaqs yet' : 'Someone');

  async function quick(s: Share, action: 'accept' | 'decline') {
    // Accepting a request to see *my* location goes through the settings screen so I pick how.
    if (action === 'accept' && s.role === 'sharing') return router.push(`/share/${s.id}`);
    try {
      await api(`/shares/${s.id}/${action}`, { body: {} });
      await reload();
    } catch (err) {
      showError(err);
    }
  }

  return (
    <Screen>
      {requests.length ? (
        <Section title="Waiting for your answer" footer="Nothing is shared until you accept. Declining doesn't notify the other person.">
          {requests.map((s, i) => (
            <Row
              key={s.id}
              title={name(s)}
              subtitle={s.role === 'sharing' ? 'Asked to see your location' : 'Wants to share their location with you'}
              last={i === requests.length - 1}
              right={
                <>
                  <Button title="Decline" kind="ghost" onPress={() => quick(s, 'decline')} style={{ height: 36, paddingHorizontal: 8 }} />
                  <Button title={s.role === 'sharing' ? 'Review' : 'Accept'} onPress={() => quick(s, 'accept')} style={{ height: 36 }} />
                </>
              }
            />
          ))}
        </Section>
      ) : null}

      <Section title="Can see your location" footer="Tap someone to change precision, history, duration, or stop sharing.">
        {sharing.length ? (
          sharing.map((s, i) => (
            <Row
              key={s.id}
              title={name(s)}
              subtitle={`${untilText(s.expiresAt)}${s.allowHistory ? ' · history on' : ''}${s.trip ? ` · trip to ${s.trip.label}` : ''}`}
              right={statusBadge(s)}
              onPress={() => router.push(`/share/${s.id}`)}
              last={i === sharing.length - 1}
            />
          ))
        ) : (
          <Row title="No one yet" subtitle="Your location is private." last />
        )}
      </Section>

      <Section title="You can see">
        {viewing.length ? (
          viewing.map((s, i) => (
            <Row key={s.id} title={name(s)} subtitle={untilText(s.expiresAt)} right={statusBadge(s)} onPress={() => router.push(`/share/${s.id}`)} last={i === viewing.length - 1} />
          ))
        ) : (
          <Row title="No one is sharing with you yet" last />
        )}
      </Section>

      {waiting.length ? (
        <Section title="Sent invitations">
          {waiting.map((s, i) => (
            <Row
              key={s.id}
              title={name(s)}
              subtitle={s.role === 'sharing' ? 'You offered to share' : 'You asked to see their location'}
              right={<Button title="Cancel" kind="ghost" onPress={() => api(`/shares/${s.id}/stop`, { body: {} }).then(reload, showError)} style={{ height: 36 }} />}
              last={i === waiting.length - 1}
            />
          ))}
        </Section>
      ) : null}

      <Button title="Add someone" onPress={() => router.push('/add-person')} />
      <Body muted style={{ fontSize: 13, textAlign: 'center', marginTop: 12 }}>
        Sharing is always two-way consent: the person whose location it is decides, and either of you can stop at any time.
      </Body>
    </Screen>
  );
}
