import { Bealach } from '@/components/Bealach';
import { busesEnabled } from '@/lib/buses';

// Reads NTA_API_KEY at request time, so adding a key needs no rebuild.
export const dynamic = 'force-dynamic';

export default function Home() {
  return <Bealach busesEnabled={busesEnabled()} />;
}
