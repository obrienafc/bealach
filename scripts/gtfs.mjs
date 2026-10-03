// Reads files out of the national GTFS timetable zip (~150 MB) with HTTP
// range requests, so build scripts fetch only the parts they need.
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import readline from 'node:readline';

export const ZIP_URL = 'https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip';

async function range(start, end) {
  const res = await fetch(ZIP_URL, { headers: { Range: `bytes=${start}-${end}` } });
  if (res.status !== 206) throw new Error(`Range request returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Reads the zip's central directory: name -> { offset, size, method }. */
export async function directory() {
  const head = await fetch(ZIP_URL, { method: 'HEAD' });
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

export async function read(entries, name) {
  const e = entries.get(name);
  if (!e) throw new Error(`${name} not in zip`);
  const header = await range(e.local, e.local + 29);
  const start = e.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const data = await range(start, start + e.compressed - 1);
  const raw = e.method === 8 ? zlib.inflateRawSync(data) : data;
  return raw.toString('utf8').replace(/^﻿/, '');
}

/** Minimal RFC 4180 parser: quoted fields may contain commas and quotes. */
export function* rows(text) {
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

/** Calls `onLine` for each line of a large file without holding it in memory. */
export async function streamLines(entries, name, onLine) {
  const e = entries.get(name);
  if (!e) throw new Error(`${name} not in zip`);
  const header = await range(e.local, e.local + 29);
  const start = e.local + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const res = await fetch(ZIP_URL, { headers: { Range: `bytes=${start}-${start + e.compressed - 1}` } });
  if (res.status !== 206) throw new Error(`Range request returned ${res.status}`);
  const lines = readline.createInterface({ input: Readable.fromWeb(res.body).pipe(zlib.createInflateRaw()), crlfDelay: Infinity });
  for await (const line of lines) onLine(line.replace(/^\uFEFF/, ''));
}
