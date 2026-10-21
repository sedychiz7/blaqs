import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { Body, Button, Notice, Row, Screen, Section, Title } from '../components/ui';
import { api } from '../lib/api';
import { showError } from '../lib/format';
import { useSession } from '../lib/session';

const FEATURES = [
  { title: 'Unlimited circle', subtitle: 'Share with up to 100 people instead of 5' },
  { title: 'Arrival & departure alerts', subtitle: 'Up to 50 places, each approved by the person' },
  { title: 'Trips with live ETA', subtitle: '"Mum is 12 min away" — and an alert when you arrive' },
  { title: '30-day location history', subtitle: 'For people who choose to share it with you' },
];

const FREE_FOREVER = 'SOS, check-ins, pausing, the "who viewed me" log, data export and account deletion are free for everyone, always.';

function revenueCatKey(): string | undefined {
  const extra = Constants.expoConfig?.extra ?? {};
  return Platform.OS === 'ios' ? extra.revenueCatIosKey : extra.revenueCatAndroidKey;
}

export default function Premium() {
  const { me, refreshMe } = useSession();
  const [pkg, setPkg] = useState<PurchasesPackage | null>(null);
  const [busy, setBusy] = useState(false);
  const key = revenueCatKey();

  useEffect(() => {
    if (!key || !me) return;
    // Our user id is the RevenueCat app user id, so the server webhook can grant the plan.
    Purchases.configure({ apiKey: key, appUserID: me.id });
    Purchases.getOfferings()
      .then((o) => setPkg(o.current?.monthly ?? o.current?.availablePackages[0] ?? null))
      .catch(() => {});
  }, [key, me?.id]);

  async function buy() {
    setBusy(true);
    try {
      if (pkg) await Purchases.purchasePackage(pkg);
      else if (__DEV__) await api('/billing/dev-grant', { body: {} });
      // The webhook may take a moment; refresh so the UI reflects the new plan.
      await refreshMe();
      router.back();
    } catch (err: any) {
      if (!err?.userCancelled) showError(err);
    } finally {
      setBusy(false);
    }
  }

  const isPremium = me?.entitlements.plan === 'premium';

  return (
    <Screen>
      <Title>Blaqs Premium</Title>
      <Body muted style={{ marginBottom: 20 }}>More people, smarter alerts, and peace of mind — with the same consent rules for everyone.</Body>
      <Section>
        {FEATURES.map((f, i) => (
          <Row key={f.title} title={f.title} subtitle={f.subtitle} last={i === FEATURES.length - 1} />
        ))}
      </Section>
      <Notice>{FREE_FOREVER}</Notice>
      {isPremium ? (
        <Body>You're on Premium. Thank you!</Body>
      ) : (
        <>
          <Button title={pkg ? `Start Premium · ${pkg.product.priceString}/month` : __DEV__ ? 'Start Premium (dev)' : 'Not available yet'} onPress={buy} loading={busy} disabled={!pkg && !__DEV__} />
          {pkg ? (
            <Button
              title="Restore purchases"
              kind="ghost"
              onPress={() => Purchases.restorePurchases().then(() => refreshMe(), showError)}
              style={{ marginTop: 8 }}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
