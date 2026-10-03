import 'server-only';
import type { Feed, Vehicle } from './vehicles';

/**
 * Serves a feed through the CDN: every visitor in a region shares one upstream
 * request per `fresh` seconds, and a slow or failed upstream never blocks
 * a visitor while a recent copy exists.
 */
export async function feedResponse(load: () => Promise<Vehicle[] | Feed>, fresh: number) {
  try {
    const loaded = await load();
    // A loader may serve an older copy (see lib/nta.ts) and say how old.
    const body: Feed = Array.isArray(loaded) ? { vehicles: loaded, updated: new Date().toISOString() } : loaded;
    return Response.json(body, {
      headers: { 'Cache-Control': `public, max-age=0, s-maxage=${fresh}, stale-while-revalidate=${fresh * 4}` },
    });
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: 'The live feed didn’t respond. Retrying shortly.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
