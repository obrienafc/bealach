import { busesEnabled } from '@/lib/buses';
import { fetchTrams } from '@/lib/luas';
import { feedResponse } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export function GET() {
  if (!busesEnabled()) {
    return Response.json({ error: 'Luas isn’t enabled on this instance.' }, { status: 404 });
  }
  return feedResponse(fetchTrams, 20);
}
