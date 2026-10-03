// Saves the Luas timetable to data/luas.json, so /api/luas can estimate where
// each tram is: NTA's live feed gives Luas delays but not positions.
//
// stop_times.txt is ~450 MB, so it's streamed and only Luas rows are kept.
// Trips that share stops and timings are stored once as a "pattern". If
// anything fails, the committed snapshot is kept and the build carries on.
import fs from 'node:fs';
import { directory, read, rows, streamLines } from './gtfs.mjs';

const OUT = 'data/luas.json';
const LUAS = '10000';

const seconds = (hms) => {
  const [h, m, s] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

try {
  const started = Date.now();
  const entries = await directory();
  const [routesTxt, tripsTxt, stopsTxt] = await Promise.all(
    ['routes.txt', 'trips.txt', 'stops.txt'].map((n) => read(entries, n)),
  );

  const lines = Object.fromEntries(
    [...rows(routesTxt)].filter((r) => r.agency_id === LUAS).map((r) => [r.route_id, r.route_short_name]),
  );
  const trips = new Map();
  for (const t of rows(tripsTxt)) {
    if (lines[t.route_id]) {
      trips.set(t.trip_id, { line: lines[t.route_id], dir: t.direction_id || '0', to: t.trip_headsign, stops: [] });
    }
  }

  let header;
  await streamLines(entries, 'stop_times.txt', (line) => {
    const cells = line.split(',');
    if (!header) {
      header = Object.fromEntries(cells.map((c, i) => [c, i]));
      return;
    }
    const trip = trips.get(cells[header.trip_id]);
    if (!trip) return;
    trip.stops.push([
      Number(cells[header.stop_sequence]),
      cells[header.stop_id],
      seconds(cells[header.arrival_time]),
      seconds(cells[header.departure_time]),
    ]);
  });

  // Group trips into patterns: same stops, same offsets from the first departure.
  const patterns = [];
  const patternIndex = new Map();
  const byTrip = {};
  const byStart = {};
  const used = new Set();
  for (const [id, trip] of trips) {
    if (trip.stops.length < 2) continue;
    trip.stops.sort((a, b) => a[0] - b[0]);
    const start = trip.stops[0][3];
    const pattern = {
      line: trip.line,
      to: trip.to,
      stops: trip.stops.map((s) => s[1]),
      arr: trip.stops.map((s) => s[2] - start),
      dep: trip.stops.map((s) => s[3] - start),
    };
    const key = JSON.stringify(pattern);
    if (!patternIndex.has(key)) {
      patternIndex.set(key, patterns.length);
      patterns.push(pattern);
    }
    const p = patternIndex.get(key);
    byTrip[id] = p;
    // Realtime trip IDs change when the timetable is republished, so also
    // index by line, direction and start time, which don't.
    byStart[`${trip.line}|${trip.dir}|${start}`] ??= p;
    pattern.stops.forEach((s) => used.add(s));
  }

  const stops = {};
  for (const s of rows(stopsTxt)) {
    if (used.has(s.stop_id)) stops[s.stop_id] = [Number(s.stop_lat), Number(s.stop_lon), s.stop_name];
  }

  fs.writeFileSync(OUT, JSON.stringify({ stops, patterns, byTrip, byStart }));
  console.log(
    `Saved ${trips.size} Luas trips as ${patterns.length} patterns over ${Object.keys(stops).length} stops ` +
      `to ${OUT} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
} catch (err) {
  if (!fs.existsSync(OUT)) fs.writeFileSync(OUT, JSON.stringify({ stops: {}, patterns: [], byTrip: {}, byStart: {} }));
  console.warn(`Couldn't update the Luas timetable (${err.message}); using the committed snapshot.`);
}
