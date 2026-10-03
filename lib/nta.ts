import 'server-only';

// NTA's GTFS-Realtime API rate-limits each key across all its feeds and
// answers 429 with Retry-After. Every call goes through here, so a server
// instance asks for each feed at most once per interval, shares in-flight
// requests, backs off when told to, and serves the last good copy meanwhile.
// The CDN in front (see lib/respond.ts) absorbs visitor traffic on top.

export type NtaFeed = 'Vehicles' | 'TripUpdates';

const BASE = 'https://api.nationaltransport.ie/gtfsr/v2/';

/**
 * Minimum time between upstream calls per feed. Measured in October 2026: a
 * key gets 3 calls per ~60 s window across all feeds. These intervals use 2 a
 * minute, leaving room for a second server instance.
 */
const MIN_INTERVAL: Record<NtaFeed, number> = {
  Vehicles: 45_000,
  // Delays change slowly, and tram positions are recomputed from the clock on
  // every request, so trip updates can be older.
  TripUpdates: 90_000,
};

type Entry = { data: unknown; at: number };
const last = new Map<NtaFeed, Entry>();
const pending = new Map<NtaFeed, Promise<Entry>>();
let blockedUntil = 0;

async function request(feed: NtaFeed): Promise<Entry> {
  const res = await fetch(`${BASE}${feed}?format=json`, {
    headers: { 'x-api-key': process.env.NTA_API_KEY ?? '', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (res.status === 429) {
    const wait = Number(res.headers.get('retry-after')) || 60;
    blockedUntil = Date.now() + wait * 1000;
    throw new Error(`NTA rate limit; retrying in ${wait}s`);
  }
  if (!res.ok) throw new Error(`NTA returned ${res.status}`);
  const entry = { data: await res.json(), at: Date.now() };
  last.set(feed, entry);
  console.info(`NTA ${feed} fetched`);
  return entry;
}

/** The feed's JSON and when it was fetched. Throws only if there's no copy at all. */
export async function ntaFeed<T>(feed: NtaFeed): Promise<{ data: T; at: number }> {
  const cached = last.get(feed);
  const fresh = cached && Date.now() - cached.at < MIN_INTERVAL[feed];
  if (fresh || (cached && Date.now() < blockedUntil)) return cached as { data: T; at: number };

  let inflight = pending.get(feed);
  if (!inflight) {
    inflight = request(feed).finally(() => pending.delete(feed));
    pending.set(feed, inflight);
  }
  try {
    return (await inflight) as { data: T; at: number };
  } catch (err) {
    if (cached) {
      console.warn(`${feed}: ${(err as Error).message}; serving a copy from ${Math.round((Date.now() - cached.at) / 1000)}s ago`);
      return cached as { data: T; at: number };
    }
    throw err;
  }
}
