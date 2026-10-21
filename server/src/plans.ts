import type { Context } from './context.js';
import type { UserRow } from './users.js';

export type PlanName = 'free' | 'premium';

export interface Entitlements {
  plan: PlanName;
  /** Shares (either direction) that are pending, active or paused. */
  maxConnections: number;
  maxPlaces: number;
  /** Longest location history that can be kept or viewed. */
  historyHours: number;
  trips: boolean;
}

// Safety features (SOS, check-ins, pausing, the access log, data export and deletion)
// are deliberately available on every plan. Premium sells convenience, not safety.
export const PLANS: Record<PlanName, Entitlements> = {
  free: { plan: 'free', maxConnections: 5, maxPlaces: 2, historyHours: 24, trips: false },
  premium: { plan: 'premium', maxConnections: 100, maxPlaces: 50, historyHours: 24 * 30, trips: true },
};

export function entitlementsFor(ctx: Context, user: UserRow): Entitlements {
  const premium = user.plan === 'premium' && (user.premium_until ?? 0) > ctx.now();
  return premium ? PLANS.premium : PLANS.free;
}

/** Hours of history actually kept for this user: their own choice, capped by plan. */
export function retentionHours(ctx: Context, user: UserRow): number {
  const max = entitlementsFor(ctx, user).historyHours;
  return user.history_retention_hours == null ? max : Math.min(user.history_retention_hours, max);
}
