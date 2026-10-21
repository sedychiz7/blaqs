import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Registers this device for push if the user already allowed notifications. Never prompts. */
export async function registerPushToken() {
  if (!Device.isDevice) return;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Requests and alerts',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const { granted } = await Notifications.getPermissionsAsync();
  if (!granted) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api('/me', { method: 'PATCH', body: { pushToken: data } });
}
