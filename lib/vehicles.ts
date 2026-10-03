// Shared between the API routes and the client.

export type Mode = 'dart' | 'commuter' | 'intercity' | 'luas' | 'bus';

export type Vehicle = {
  id: string;
  mode: Mode;
  lat: number;
  lon: number;
  /** Short label on the map: a train code or a route number. */
  label: string;
  /** "Dublin Connolly → Belfast", or a bus's route name. */
  title: string;
  /** Where it's heading, when known. */
  to?: string;
  /** "Departed Dundalk", "Arrived Portlaoise". */
  status?: string;
  next?: string;
  /** Minutes late; negative is early. Trains only. */
  delay?: number;
  operator?: string;
  /** Scheduled departure from origin, "HH:MM". */
  departed?: string;
  /** When the vehicle last reported its position (epoch ms). Buses only. */
  seen?: number;
};

export type Feed = { vehicles: Vehicle[]; updated: string };

export const MODES: { mode: Mode; label: string; plural: string; color: string }[] = [
  // Okabe–Ito colours, distinguishable with the common colour-vision deficiencies.
  { mode: 'dart', label: 'DART', plural: 'DART', color: '#009e73' },
  { mode: 'commuter', label: 'Commuter', plural: 'Commuter', color: '#e69f00' },
  { mode: 'intercity', label: 'Intercity', plural: 'Intercity', color: '#cc79a7' },
  { mode: 'luas', label: 'Luas', plural: 'Luas', color: '#7c3aed' },
  // Blue, not Okabe–Ito's vermilion, which sat too close to Commuter orange
  // once a thousand buses were on the map.
  { mode: 'bus', label: 'Bus', plural: 'Buses', color: '#0072b2' },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.mode, m])) as Record<
  Mode,
  (typeof MODES)[number]
>;
