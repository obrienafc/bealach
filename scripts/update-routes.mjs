// Saves route names and typical destinations from the national GTFS timetable
// to data/routes.json. The zip is ~150 MB, so this reads only the two files it
// needs with HTTP range requests. If anything fails, the committed snapshot is
// kept and the build carries on.
import fs from 'node:fs';
import zlib from 'node:zlib';

const URL = 'https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip';
const OUT = 'data/routes.json';

async function range(start, end) {
  const res = await fetch(URL, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`Range request returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads the zip's central directory: name -> { offset, size, method }. */
async function directory() {
  const head = await fetch(URL, { method: 'HEAD' });
  const total = Number(head.headers.get('content-length'));
  const tail = await range(Math.max(0, total - 65_536), total - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('No end of central directory');
  const size = tail.readUInt32LE(eocd + 12);
  const offset = tail.readUInt32LE(eocd + 16);
  const cd = await range(offset, offset + size - 1);
  const entries = new Map();
  for (let i = 0; i + 46 <= cd.length && cd.readUInt32LE(i) === 0x02014b50; ) {
    const method = cd.readUInt16LE(i + 10);
    const compressed = cd.readUInt32LE(i + 20);
    const nameLen = cd.readUInt16LE(i + 28);
    const extraLen = cd.readUInt16LE(i + 30);
    const commentLen = cd.readUInt16LE(i + 32);
    const local = cd.readUInt32LE(i + 42);
    entries.set(cd.toString('utf8', i + 46, i + 46 + nameLen), { local, compressed, method });
    i += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function read(entries, name) {
  const e = entries.get(name);
  if (!e) throw new Error(`${name} not in zip`);
  const header = await range(e.local, e.local + 29);
  const start = e.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = await range(start, start + e.compressed - 1);
  const raw = e.method === 8 ? zlib.inflateRawSync(data) : data;
  return raw.toString('utf8').replace(/^﻿/, '');
}

/** Minimal RFC 4180 parser: quoted fields may contain commas and quotes. */
function* rows(text) {
  let header;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') (cell += '"'), i++;
        else if (c === '"') quoted = false;
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') cells.push(cell), (cell = '');
      else cell += c;
    }
    cells.push(cell);
    if (!header) header = cells;
    else yield Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
  }
}

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
