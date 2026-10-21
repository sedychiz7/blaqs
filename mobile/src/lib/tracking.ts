import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api, getToken } from './api';
import type { LocationPoint } from './types';

/**
 * Background location. Collection only runs while the server says the user has someone
 * they agreed to share with (`collect`), and the OS always shows that it's happening:
 * a persistent notification on Android and the blue location indicator on iOS.
 * There is intentionally no way to hide it.
 */
export const LOCATION_TASK = 'blaqs-background-location';

type TaskData = { locations: Location.LocationObject[] };

async function toPoints(locations: Location.LocationObject[]): Promise<LocationPoint[]> {
  const level = await Battery.getBatteryLevelAsync().catch(() => -1);
  const battery = level >= 0 ? level : null;
  return locations.map((l) => ({
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    speed: l.coords.speed != null && l.coords.speed >= 0 ? l.coords.speed : null,
    heading: l.coords.heading != null && l.coords.heading >= 0 ? l.coords.heading : null,
    battery,
    recordedAt: Math.round(l.timestamp),
  }));
}

async function upload(locations: Location.LocationObject[]) {
  if (locations.length === 0 || !(await getToken())) return;
  const res = await api<{ stored: number; collect: boolean }>('/locations', { body: { points: await toPoints(locations) } });
  // The server is the source of truth for consent: if every share ended, stop immediately.
  if (!res.collect) await stopTracking();
}

// Must be defined at module scope so it exists when the OS relaunches the app headless.
TaskManager.defineTask<TaskData>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  await upload(data.locations).catch((err) => console.warn('location upload failed', err));
});

let foregroundWatch: Location.LocationSubscription | null = null;

export async function startTracking() {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'no_permission' as const;

  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.granted) {
    foregroundWatch?.remove();
    foregroundWatch = null;
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return 'background' as const;
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      distanceInterval: 50,
      deferredUpdatesInterval: 60_000,
      deferredUpdatesDistance: 50,
      pausesUpdatesAutomatically: true,
      activityType: Location.ActivityType.Other,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Sharing your location',
        notificationBody: 'Blaqs is sharing with people you approved. Open the app to pause or stop.',
        notificationColor: '#5B4BFF',
        killServiceOnDestroy: false,
      },
    });
    return 'background' as const;
  }

  // Without "Always" permission we still share, but only while the app is open.
  if (!foregroundWatch) {
    foregroundWatch = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, distanceInterval: 30, timeInterval: 30_000 },
      (loc) => void upload([loc]).catch(() => {}),
    );
  }
  return 'foreground' as const;
}

export async function stopTracking() {
  foregroundWatch?.remove();
  foregroundWatch = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

export async function syncTracking(collect: boolean) {
  return collect ? startTracking() : (await stopTracking(), 'off' as const);
}

/** One immediate fix, e.g. right after accepting a request, so the other person isn't kept waiting. */
export async function sendCurrentLocation() {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  await upload([loc]);
}
