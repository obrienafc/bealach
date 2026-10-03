import 'server-only';
import { XMLParser } from 'fast-xml-parser';
import type { Mode, Vehicle } from './vehicles';

// Irish Rail's public realtime API: no key, positions refresh about once a
// minute. Positions are the last place a train reported (usually a station),
// not GPS.
const BASE = 'https://api.irishrail.ie/realtime/realtime.asmx/getCurrentTrainsXML_WithTrainType?TrainType=';
const TYPES: [string, Mode][] = [
  ['D', 'dart'],
  ['S', 'commuter'],
  ['M', 'intercity'],
];

type Raw = {
  TrainStatus: string;
  TrainLatitude: number;
  TrainLongitude: number;
  TrainCode: string;
  PublicMessage: string;
  Direction: string;
};

const parser = new XMLParser({ parseTagValue: false, isArray: (name) => name === 'objTrainPositions' });

// "12:50 - Dublin Connolly to Belfast (6 mins late)"; the time and delay are
// missing before departure, and the space before "(" sometimes is too.
const ROUTE = /^(?:(\d{1,2}:\d{2}) - )?(.+?) to (.+?)\s*(?:\((-?\d+) mins? late\))?$/;
// "Departed Dundalk next stop Newry", "Arrived Portlaoise next stop Dublin Heuston"
const PROGRESS = /^(Departed|Arrived) (.+?) next stop (.+)$/;

export function parseTrain(raw: Raw, mode: Mode): Vehicle | null {
  // N: not yet departed, T: terminated. Only show trains on the move.
  if (raw.TrainStatus !== 'R') return null;
  const lat = Number(raw.TrainLatitude);
  const lon = Number(raw.TrainLongitude);
  if (!lat || !lon) return null;

  const [, routeLine = '', progressLine = ''] = String(raw.PublicMessage).split('\\n');
  const route = ROUTE.exec(routeLine.trim());
  const progress = PROGRESS.exec(progressLine.trim());
  const code = String(raw.TrainCode).trim();

  return {
    id: `train:${code}`,
    mode,
    lat,
    lon,
    label: code,
    title: route ? `${route[2]} → ${route[3]}` : String(raw.Direction),
    to: route?.[3],
    departed: route?.[1],
    delay: route?.[4] !== undefined ? Number(route[4]) : undefined,
    status: progress ? `${progress[1]} ${progress[2]}` : progressLine.trim() || undefined,
    next: progress?.[3],
    operator: 'Iarnród Éireann',
  };
}

async function fetchType(type: string, mode: Mode): Promise<Vehicle[]> {
  const res = await fetch(BASE + type, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`Irish Rail returned ${res.status}`);
  const xml = parser.parse(await res.text());
  const list: Raw[] = xml?.ArrayOfObjTrainPositions?.objTrainPositions ?? [];
  return list.map((raw) => parseTrain(raw, mode)).filter((v): v is Vehicle => v !== null);
}

export async function fetchTrains(): Promise<Vehicle[]> {
  const lists = await Promise.all(TYPES.map(([type, mode]) => fetchType(type, mode)));
  return lists.flat();
}
