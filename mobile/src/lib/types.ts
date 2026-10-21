export type Precision = 'precise' | 'approximate';

export interface Entitlements {
  plan: 'free' | 'premium';
  maxConnections: number;
  maxPlaces: number;
  historyHours: number;
  trips: boolean;
}

export interface Me {
  id: string;
  displayName: string;
  entitlements: Entitlements;
  premiumUntil: number | null;
  historyRetentionHours: number;
  sharingPaused: boolean;
  collect: boolean;
}

export interface Share {
  id: string;
  role: 'sharing' | 'viewing';
  status: 'pending' | 'active' | 'paused' | 'declined' | 'revoked' | 'expired';
  other: { id: string; displayName: string | null } | null;
  awaitingJoin: boolean;
  initiatedByMe: boolean;
  needsMyResponse: boolean;
  precision: Precision;
  allowHistory: boolean;
  durationMinutes: number | null;
  expiresAt: number | null;
  acceptedAt: number | null;
  consentReminderDue: boolean;
  trip: { label: string; lat: number; lng: number; radiusM: number } | null;
}

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  battery: number | null;
  recordedAt: number;
}

export interface Person {
  userId: string;
  displayName: string | null;
  shareId: string;
  precision: Precision;
  paused: boolean;
  location: LocationPoint | null;
  trip: { label: string; etaSeconds: number | null } | null;
}

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

export interface PlaceAlert {
  id: string;
  role: 'watching' | 'watched';
  status: 'pending' | 'active' | 'declined' | 'revoked';
  place: Place | null;
  watcher: { id: string; displayName: string | null };
  subject: { id: string; displayName: string | null };
}

export interface AppEvent {
  id: number;
  type: string;
  payload: Record<string, any>;
  createdAt: number;
  read: boolean;
}

export interface AccessLogEntry {
  viewer: { id: string; displayName: string | null };
  kind: 'live' | 'history';
  at: number;
}
