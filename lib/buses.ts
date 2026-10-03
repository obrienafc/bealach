import 'server-only';
import routesJson from '@/data/routes.json';
import type { Vehicle } from './vehicles';

// NTA's GTFS-Realtime vehicle positions: Dublin Bus, Bus Éireann, Go-Ahead
// and others (no Luas at present, though it's handled if it appears). Needs
// a free key from developer.nationaltransport.ie.
const URL = 'https://api.nationaltransport.ie/gtfsr/v2/Vehicles?format=json';

// Built by scripts/update-routes.mjs; `to` is the usual destination per direction.
type Route = { name: string; long: string; operator: string; type: number; to: (string | null)[] };
const ROUTES = routesJson as unknown as Record<string, Route>;

// About 1% of vehicles stop reporting without leaving the feed (parked or out
// of service). Past this age, a position is more likely wrong than late.
const MAX_AGE_S = 600;

export const busesEnabled = () => Boolean(process.env.NTA_API_KEY);

// GTFS-Realtime as JSON. Field names follow the protobuf (snake_case), but
// some converters emit camelCase, so read either.
type Entity = {
  id: string;
  vehicle?: {
    trip?: { route_id?: string; routeId?: string; direction_id?: number; directionId?: number };
    position?: { latitude: number; longitude: number };
    vehicle?: { id?: string; label?: string };
    /** Seconds since the epoch, as a string or number. */
    timestamp?: string | number;
  };
};

/** `now` is the feed's own timestamp in seconds, so clock skew doesn't matter. */
export function toVehicle(e: Entity, now?: number): Vehicle | null {
  const v = e.vehicle;
  const lat = Number(v?.position?.latitude);
  const lon = Number(v?.position?.longitude);
  if (!v || !lat || !lon) return null;
  const seen = Number(v.timestamp) || undefined;
  if (now && seen && now - seen > MAX_AGE_S) return null;

  const routeId = v.trip?.route_id ?? v.trip?.routeId;
  const route = routeId ? ROUTES[routeId] : undefined;
  // Trains come from Irish Rail's own feed, which has delays and next stops.
  if (route?.type === 2) return null;

  const direction = Number(v.trip?.direction_id ?? v.trip?.directionId ?? 0) === 1 ? 1 : 0;
  const to = route?.to[direction] ?? undefined;
  return {
    id: `bus:${v.vehicle?.id ?? e.id}`,
    mode: route?.type === 0 ? 'luas' : 'bus',
    lat,
    lon,
    label: route?.name ?? '?',
    title: route?.long ?? 'Unknown route',
    to,
    operator: route?.operator.replace(/^Bus Átha Cliath – /, '').replace(/^LUAS$/, 'Luas'),
    seen: seen ? seen * 1000 : undefined,
  };
}

export async function fetchBuses(): Promise<Vehicle[]> {
  const key = process.env.NTA_API_KEY;
  if (!key) return [];
  const res = await fetch(URL, {
    headers: { 'x-api-key': key, 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`NTA returned ${res.status}`);
  const data = (await res.json()) as { header?: { timestamp?: string | number }; entity?: Entity[] };
  const now = Number(data.header?.timestamp) || Date.now() / 1000;
  return (data.entity ?? []).map((e) => toVehicle(e, now)).filter((v): v is Vehicle => v !== null);
}
