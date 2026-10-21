const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
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

// Approximate mode snaps to a fixed ~1 km grid rather than adding random noise:
// noise can be averaged away over many samples, a fixed grid cell cannot.
const GRID_DEG = 0.01;

export function applyPrecision(point: LocationPoint, precision: 'precise' | 'approximate'): LocationPoint {
  if (precision === 'precise') return point;
  const snap = (v: number) => Math.round(v / GRID_DEG) * GRID_DEG;
  return {
    lat: Number(snap(point.lat).toFixed(2)),
    lng: Number(snap(point.lng).toFixed(2)),
    accuracy: Math.max(point.accuracy ?? 0, 1000),
    speed: null,
    heading: null,
    battery: point.battery,
    recordedAt: point.recordedAt,
  };
}
