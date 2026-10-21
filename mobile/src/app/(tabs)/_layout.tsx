import { Tabs } from 'expo-router/js-tabs';
import { Text, type ColorValue } from 'react-native';
import { colors } from '../../components/ui';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Map', headerShown: false, tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarIcon: icon('☺') }} />
      <Tabs.Screen name="places" options={{ title: 'Places', tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarIcon: icon('♪') }} />
      <Tabs.Screen name="settings" options={{ title: 'Privacy', tabBarIcon: icon('⚙') }} />
    </Tabs>
  );
}
