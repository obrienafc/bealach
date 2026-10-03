import { busesEnabled, fetchBuses } from '@/lib/buses';
import { feedResponse } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export function GET() {
  if (!busesEnabled()) {
    return Response.json({ error: 'Buses aren’t enabled on this instance.' }, { status: 404 });
  }
  return feedResponse(fetchBuses, 45);
}
