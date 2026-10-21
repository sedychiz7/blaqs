import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { colors } from '../components/ui';
import { useSession } from '../lib/session';

export default function Index() {
  const { ready, me, onboarded } = useSession();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (!me) return <Redirect href="/sign-in" />;
  if (!onboarded) return <Redirect href="/permissions" />;
  return <Redirect href="/(tabs)" />;
}
