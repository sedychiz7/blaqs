import * as Localization from 'expo-localization';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from './api';

export function deviceRegion(): string {
  return Localization.getLocales()[0]?.regionCode ?? 'US';
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function untilText(ms: number | null): string {
  if (!ms) return 'Until you stop it';
  const mins = Math.round((ms - Date.now()) / 60000);
  if (mins < 60) return `${Math.max(mins, 0)} min left`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h left`;
  return `${Math.round(mins / 1440)} days left`;
}

export function etaText(seconds: number | null): string {
  if (seconds == null) return 'ETA when moving';
  const mins = Math.round(seconds / 60);
  return mins < 1 ? 'Arriving now' : mins < 60 ? `${mins} min away` : `${Math.floor(mins / 60)} h ${mins % 60} min away`;
}

export const DURATIONS: { label: string; minutes: number | null }[] = [
  { label: '1 hour', minutes: 60 },
  { label: '8 hours', minutes: 8 * 60 },
  { label: '1 day', minutes: 24 * 60 },
  { label: 'Until I stop', minutes: null },
];

export function showError(err: unknown) {
  if (err instanceof ApiError && err.needsPremium) {
    Alert.alert('Premium feature', err.message, [
      { text: 'Not now', style: 'cancel' },
      { text: 'See Premium', onPress: () => router.push('/premium') },
    ]);
    return;
  }
  Alert.alert('Something went wrong', err instanceof Error ? err.message : String(err));
}
