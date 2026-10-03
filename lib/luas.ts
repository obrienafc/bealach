import 'server-only';
import luasJson from '@/data/luas.json';
import { ntaFeed } from './nta';
import type { Vehicle } from './vehicles';

// Luas trams don't publish positions. NTA's GTFS-Realtime trip updates give
// each tram's delay, and the timetable (data/luas.json, built by
// scripts/update-luas.mjs) gives its stops and times, so a tram's position is
// estimated: where the timetable says it is, shifted by its live delay, placed
// on a straight line between stops (Luas stops are 300–900 m apart).

type Pattern = { line: string; to: string; stops: string[]; arr: number[]; dep: number[] };
type Timetable = {
  stops: Record<string, [number, number, string]>;
  patterns: Pattern[];
  byTrip: Record<string, number>;
  byStart: Record<string, number>;
};
const TIMETABLE = luasJson as unknown as Timetable;

type TripUpdate = {
  trip: {
    trip_id: string;
    route_id: string;
    direction_id?: number;
    start_time?: string;
    start_date?: string;
    schedule_relationship?: string;
  };
  stop_time_update?: { stop_sequence?: number; arrival?: { delay?: number }; departure?: { delay?: number } }[];
};

const seconds = (hms: string) => {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const dublinOffset = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', timeZoneName: 'longOffset' });

/** Epoch ms of a service day's "midnight": GTFS times count from noon minus 12 hours, local time. */
export function serviceDayStart(yyyymmdd: string) {
  const noon = Date.UTC(+yyyymmdd.slice(0, 4), +yyyymmdd.slice(4, 6) - 1, +yyyymmdd.slice(6, 8), 12);
  const name = dublinOffset.formatToParts(noon).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const [, sign, h, m] = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(name) ?? [];
  const offset = sign ? (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(m)) * 60_000 : 0;
  return noon - offset - 12 * 3600_000;
}

/** Where a tram on `pattern` is at `now`, given when it left its first stop. */
export function locate(pattern: Pattern, departedAt: number, now: number) {
  const t = (now - departedAt) / 1000;
  const { stops, arr, dep } = pattern;
  if (t < 0 || t >= arr[arr.length - 1]) return null;
  for (let i = 0; i < stops.length - 1; i++) {
    const here = TIMETABLE.stops[stops[i]];
    const next = TIMETABLE.stops[stops[i + 1]];
    if (!here || !next) return null;
    if (t < dep[i]) return { lat: here[0], lon: here[1], status: `At ${here[2]}`, next: next[2] };
    if (t < arr[i + 1]) {
      const f = (t - dep[i]) / Math.max(1, arr[i + 1] - dep[i]);
      return {
        lat: here[0] + (next[0] - here[0]) * f,
        lon: here[1] + (next[1] - here[1]) * f,
        status: `Between ${here[2]} and ${next[2]}`,
        next: next[2],
      };
    }
  }
  return null;
}

export function toTram(update: TripUpdate, now: number): Vehicle | null {
  const { trip } = update;
  if (!trip.route_id.startsWith('10000 ') || trip.schedule_relationship === 'CANCELED') return null;
  if (!trip.start_time || !trip.start_date) return null;

  const line = /RED/i.test(trip.route_id) ? 'Red' : 'Green';
  const start = seconds(trip.start_time);
  const index = TIMETABLE.byTrip[trip.trip_id] ?? TIMETABLE.byStart[`${line}|${trip.direction_id ?? 0}|${start}`];
  const pattern = index === undefined ? undefined : TIMETABLE.patterns[index];
  if (!pattern) return null;

  // The earliest update is the tram's next stop, the best guess for right now.
  const first = [...(update.stop_time_update ?? [])].sort((a, b) => (a.stop_sequence ?? 0) - (b.stop_sequence ?? 0))[0];
  const delay = first?.departure?.delay ?? first?.arrival?.delay ?? 0;
  const departedAt = serviceDayStart(trip.start_date) + (start + delay) * 1000;
  const at = locate(pattern, departedAt, now);
  if (!at) return null;

  return {
    id: `luas:${trip.trip_id}`,
    mode: 'luas',
    lat: at.lat,
    lon: at.lon,
    label: line,
    title: `${line} line`,
    to: pattern.to,
    status: at.status,
    next: at.next,
    delay: Math.round(delay / 60),
    operator: 'Luas',
    estimated: true,
  };
}

export async function fetchTrams(): Promise<Vehicle[]> {
  if (!process.env.NTA_API_KEY) return [];
  const { data } = await ntaFeed<{ entity?: { trip_update?: TripUpdate }[] }>('TripUpdates');
  // Positions come from the clock, so they're current even when the delays
  // are from a cached copy; the response is stamped now.
  const now = Date.now();
  return (data.entity ?? [])
    .map((e) => (e.trip_update ? toTram(e.trip_update, now) : null))
    .filter((v): v is Vehicle => v !== null);
}
