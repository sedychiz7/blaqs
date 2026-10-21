// Registers the background location task at bundle load, before any screen mounts.
import '../lib/tracking';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from '../components/ui';
import { SessionProvider } from '../lib/session';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerTintColor: colors.primary, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="permissions" options={{ title: 'Permissions', headerBackVisible: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="add-person" options={{ title: 'Add someone', presentation: 'modal' }} />
          <Stack.Screen name="share/[id]" options={{ title: 'Sharing settings' }} />
          <Stack.Screen name="person/[id]" options={{ title: 'Location history' }} />
          <Stack.Screen name="premium" options={{ title: 'Blaqs Premium', presentation: 'modal' }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
