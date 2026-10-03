// Saves route names and typical destinations from the national GTFS timetable
// to data/routes.json. If anything fails, the committed snapshot is kept and
// the build carries on.
import fs from 'node:fs';
import { directory, read, rows } from './gtfs.mjs';

const OUT = 'data/routes.json';

try {
  const entries = await directory();
  const [agencyTxt, routesTxt, tripsTxt] = await Promise.all(
    ['agency.txt', 'routes.txt', 'trips.txt'].map((n) => read(entries, n)),
  );
  const agencies = Object.fromEntries([...rows(agencyTxt)].map((a) => [a.agency_id, a.agency_name]));

  // The most common headsign per route and direction.
  const counts = new Map();
  for (const t of rows(tripsTxt)) {
    if (!t.trip_headsign) continue;
    const key = `${t.route_id}|${t.direction_id || '0'}`;
    const byHeadsign = counts.get(key) ?? new Map();
    byHeadsign.set(t.trip_headsign, (byHeadsign.get(t.trip_headsign) ?? 0) + 1);
    counts.set(key, byHeadsign);
  }
  const headsign = (route, dir) => {
    const m = counts.get(`${route}|${dir}`);
    return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : undefined;
  };

  const routes = {};
  for (const r of rows(routesTxt)) {
    routes[r.route_id] = {
      name: r.route_short_name || r.route_long_name,
      long: r.route_long_name,
      operator: agencies[r.agency_id] ?? '',
      type: Number(r.route_type),
      to: [headsign(r.route_id, '0'), headsign(r.route_id, '1')],
    };
  }
  fs.writeFileSync(OUT, JSON.stringify(routes));
  console.log(`Saved ${Object.keys(routes).length} routes to ${OUT}`);
} catch (err) {
  if (!fs.existsSync(OUT)) fs.writeFileSync(OUT, '{}');
  console.warn(`Couldn't update routes (${err.message}); using the committed snapshot.`);
}
