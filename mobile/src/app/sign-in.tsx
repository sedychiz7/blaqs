import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Body, Button, colors, Screen, Title } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { deviceRegion, showError } from '../lib/format';
import { useSession } from '../lib/session';

export default function SignIn() {
  const { signIn } = useSession();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [busy, setBusy] = useState(false);
  const region = deviceRegion();

  async function sendCode() {
    setBusy(true);
    try {
      await api('/auth/start', { body: { phone, region } });
      setStep('code');
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    try {
      const res = await api<{ token: string }>('/auth/verify', {
        body: { phone, code, region, displayName: needsName ? name : undefined },
      });
      await signIn(res.token);
      router.replace('/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'name_required') setNeedsName(true);
      else showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ marginTop: 48, marginBottom: 28 }}>
          <Title>Blaqs</Title>
          <Body muted>
            Share your location with the people you choose — only when they agree too, and only for as long as you want.
          </Body>
        </View>

        {step === 'phone' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Your phone number"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
            />
            <Button title="Send code" onPress={sendCode} loading={busy} disabled={phone.length < 6} />
            <Body muted style={styles.fine}>
              Your number lets friends find you. We store it only in a protected, non-reversible form.
            </Body>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            {needsName ? (
              <TextInput style={styles.input} placeholder="Your name, as friends will see it" value={name} onChangeText={setName} />
            ) : null}
            <Button title={needsName ? 'Create account' : 'Continue'} onPress={verify} loading={busy} disabled={code.length !== 6 || (needsName && !name.trim())} />
            <Button title="Use a different number" kind="ghost" onPress={() => setStep('phone')} style={{ marginTop: 8 }} />
          </>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  input: {
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    fontSize: 17,
    marginBottom: 12,
  },
  fine: { fontSize: 13, marginTop: 16, textAlign: 'center' },
});
