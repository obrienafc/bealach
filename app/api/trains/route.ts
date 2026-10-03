import { feedResponse } from '@/lib/respond';
import { fetchTrains } from '@/lib/trains';

export const dynamic = 'force-dynamic';

export function GET() {
  return feedResponse(fetchTrains, 15);
}
