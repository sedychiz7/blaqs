import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking } from 'react-native';
import { Badge, Body, Button, Notice, Row, Screen, Section, Title } from '../components/ui';
import { registerPushToken } from '../lib/push';
import { useSession } from '../lib/session';
import { startTracking } from '../lib/tracking';

type Status = 'granted' | 'denied' | 'undetermined';

interface PermissionState {
  location: Status;
  background: Status;
  contacts: Status;
  notifications: Status;
}

const asStatus = (p: { granted: boolean; canAskAgain?: boolean; status?: string }): Status =>
  p.granted ? 'granted' : p.status === 'undetermined' ? 'undetermined' : 'denied';

/**
 * Every permission is explained before the system prompt, asked for individually,
 * and optional. Declining one only turns off the feature that needs it.
 */
export default function Permissions() {
  const { me, onboarded, finishOnboarding } = useSession();
  const [state, setState] = useState<PermissionState | null>(null);

  const refresh = useCallback(async () => {
    const [location, background, contacts, notifications] = await Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
      Contacts.getPermissionsAsync(),
      Notifications.getPermissionsAsync(),
    ]);
    setState({
      location: asStatus(location),
      background: asStatus(background),
      contacts: asStatus(contacts),
      notifications: asStatus(notifications),
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function ask(kind: keyof PermissionState) {
    if (state?.[kind] === 'denied') return Linking.openSettings();
    if (kind === 'location') await Location.requestForegroundPermissionsAsync();
    if (kind === 'background') await Location.requestBackgroundPermissionsAsync();
    if (kind === 'contacts') await Contacts.requestPermissionsAsync();
    if (kind === 'notifications') {
      await Notifications.requestPermissionsAsync();
      await registerPushToken().catch(() => {});
    }
    if ((kind === 'location' || kind === 'background') && me?.collect) await startTracking();
    await refresh();
  }

  const action = (kind: keyof PermissionState, disabled = false) => {
    const s = state?.[kind];
    if (s === 'granted') return <Badge text="Allowed" tone="success" />;
    return <Button title={s === 'denied' ? 'Settings' : 'Allow'} kind="secondary" onPress={() => ask(kind)} disabled={disabled} style={{ height: 36 }} />;
  };

  return (
    <Screen>
      <Title>You're in control</Title>
      <Body muted style={{ marginBottom: 20 }}>
        Blaqs only uses what you allow, and every feature works on a "both people agree" basis. You can change any of these later
        in Settings.
      </Body>

      <Section title="Location">
        <Row
          title="While using the app"
          subtitle="Needed to share your location with people who accepted, and to show you on the map."
          right={action('location')}
        />
        <Row
          title="In the background (Always)"
          subtitle="Keeps sharing working when the app is closed. Only runs while someone you approved is receiving it — and your phone always shows an indicator."
          right={action('background', state?.location !== 'granted')}
          last
        />
      </Section>

      <Section
        title="Contacts"
        footer="Your address book never leaves your phone. When you pick someone, only that one number is sent so we can deliver your invite."
      >
        <Row title="Read contacts" subtitle="Choose who to share with from your contacts instead of typing numbers." right={action('contacts')} last />
      </Section>

      <Section title="Notifications">
        <Row
          title="Requests and alerts"
          subtitle="Hear about sharing requests, SOS alerts, check-ins and arrivals you've agreed to."
          right={action('notifications')}
          last
        />
      </Section>

      {state?.location === 'granted' && state.background !== 'granted' ? (
        <Notice tone="warning">Without background access, people will only see your location while Blaqs is open on your phone.</Notice>
      ) : null}

      {!onboarded ? (
        <Button
          title="Continue"
          onPress={async () => {
            await finishOnboarding();
            router.replace('/(tabs)');
          }}
        />
      ) : null}
    </Screen>
  );
}
