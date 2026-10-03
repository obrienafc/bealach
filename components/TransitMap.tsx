'use client';

import 'maplibre-gl/dist/maplibre-gl.css';
import type { GeoJSONSource, Map as MapLibre } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { MAPLIBRE_VERSION } from '@/lib/maplibre-version';
import { MODES, type Vehicle } from '@/lib/vehicles';

const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const IRELAND: [[number, number], [number, number]] = [
  [-10.7, 51.35],
  [-5.4, 55.45],
];
// Positions arrive every 15–60 seconds. Gliding between them reads as motion
// and shows which vehicle went where; it is skipped for reduced motion.
const GLIDE_MS = 1_600;

type Props = {
  vehicles: Vehicle[];
  selectedId: string | null;
  follow: boolean;
  dark: boolean;
  reducedMotion: boolean;
  /** Space the floating panels cover, so fitting and following avoid them. */
  padding: { top: number; bottom: number; left: number; right: number };
  onSelect: (id: string | null) => void;
  onReady?: (map: MapLibre) => void;
};

type Point = [number, number];

const byMode = (bus: number, other: number) => ['match', ['get', 'mode'], 'bus', bus, other];

function addLayers(map: MapLibre, dark: boolean) {
  if (map.getSource('vehicles')) return;
  map.addSource('vehicles', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const color = ['match', ['get', 'mode'], ...MODES.flatMap((m) => [m.mode, m.color]), '#888888'];
  // Zoom must be the outermost input, so the halo gets its own curve.
  const sized = (grow: number) =>
    ['interpolate', ['linear'], ['zoom'], 6, byMode(2.5 + grow, 4.5 + grow), 11, byMode(4.5 + grow, 6.5 + grow), 15, byMode(8 + grow, 10 + grow)];
  const radius = sized(0);

  map.addLayer({
    id: 'vehicle-halo',
    type: 'circle',
    source: 'vehicles',
    filter: ['==', ['get', 'id'], ''],
    paint: {
      'circle-radius': sized(7) as never,
      'circle-color': color as never,
      'circle-opacity': 0.25,
      'circle-stroke-width': 2,
      'circle-stroke-color': color as never,
    },
  });
  map.addLayer({
    id: 'vehicle-dot',
    type: 'circle',
    source: 'vehicles',
    // Trains are few and buses many: draw trains on top.
    layout: { 'circle-sort-key': byMode(0, 1) as never },
    paint: {
      'circle-radius': radius as never,
      'circle-color': color as never,
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 12, 1.5],
      'circle-stroke-color': dark ? '#000000' : '#ffffff',
    },
  });
  map.addLayer({
    id: 'vehicle-label',
    type: 'symbol',
    source: 'vehicles',
    // Trains are few, so label them sooner than buses.
    filter: ['any', ['!=', ['get', 'mode'], 'bus'], ['>=', ['zoom'], 13]],
    minzoom: 9,
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [0, 1.25],
      'text-anchor': 'top',
      'text-optional': true,
    },
    paint: {
      'text-color': dark ? '#f5f5f7' : '#1d1d1f',
      'text-halo-color': dark ? '#000000' : '#ffffff',
      'text-halo-width': 1.5,
    },
  });
  // Dots are small; a larger invisible circle gives fingers a 44px target.
  map.addLayer({
    id: 'vehicle-hit',
    type: 'circle',
    source: 'vehicles',
    paint: { 'circle-radius': 22, 'circle-opacity': 0.001 },
  });
}

function toGeoJSON(vehicles: Vehicle[], at: Map<string, Point>) {
  return {
    type: 'FeatureCollection' as const,
    features: vehicles.map((v) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: at.get(v.id) ?? [v.lon, v.lat] },
      properties: { id: v.id, mode: v.mode, label: v.label },
    })),
  };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function TransitMap({ vehicles, selectedId, follow, dark, reducedMotion, padding, onSelect, onReady }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const shown = useRef(new Map<string, Point>()); // where each dot is drawn now
  const latest = useRef(vehicles);
  const frame = useRef(0);
  const props = useRef({ onSelect, dark, padding, selectedId });
  props.current = { onSelect, dark, padding, selectedId };
  latest.current = vehicles;

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibre | undefined;
    (async () => {
      // Loaded from public/ rather than bundled; see scripts/copy-maplibre.mjs.
      const url = `/maplibre/${MAPLIBRE_VERSION}/maplibre-gl.mjs`;
      const maplibre = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url)) as typeof import('maplibre-gl');
      if (cancelled || !container.current) return;
      map = new maplibre.Map({
        container: container.current,
        style: props.current.dark ? STYLES.dark : STYLES.light,
        bounds: IRELAND,
        fitBoundsOptions: { padding: props.current.padding },
        attributionControl: { compact: true },
        maxZoom: 17,
        minZoom: 5,
        dragRotate: false,
        pitchWithRotate: false,
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'bottom-right');
      map.addControl(
        new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: false }, fitBoundsOptions: { maxZoom: 14 } }),
        'bottom-right',
      );

      map.on('style.load', () => {
        addLayers(map!, props.current.dark);
        (map!.getSource('vehicles') as GeoJSONSource).setData(toGeoJSON(latest.current, shown.current));
        // A selection can arrive (e.g. from a shared link) before the layers exist.
        map!.setFilter('vehicle-halo', ['==', ['get', 'id'], props.current.selectedId ?? '']);
      });
      map.on('click', (e) => {
        const hit = map!.queryRenderedFeatures(e.point, { layers: ['vehicle-hit'] });
        props.current.onSelect(hit.length ? String(hit[0].properties.id) : null);
      });
      map.on('mouseenter', 'vehicle-hit', () => (map!.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'vehicle-hit', () => (map!.getCanvas().style.cursor = ''));
      mapRef.current = map;
      // For poking at the map from devtools; never in production.
      if (process.env.NODE_ENV === 'development') Object.assign(window, { __map: map });
      onReady?.(map);
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame.current);
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap with the appearance; layers are re-added on style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(dark ? STYLES.dark : STYLES.light, { diff: false });
  }, [dark]);

  // Glide every dot from where it's drawn to its new position.
  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('vehicles') as GeoJSONSource | undefined;
    const from = new Map(shown.current);
    const to = new Map(vehicles.map((v) => [v.id, [v.lon, v.lat] as Point]));
    cancelAnimationFrame(frame.current);

    const settle = () => {
      shown.current = to;
      source?.setData(toGeoJSON(vehicles, to));
    };
    const moving = [...to].some(([id, p]) => {
      const f = from.get(id);
      return f && (f[0] !== p[0] || f[1] !== p[1]);
    });
    if (!source || reducedMotion || !moving) return settle();

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      const k = ease(t);
      const at = new Map<string, Point>();
      for (const [id, p] of to) {
        const f = from.get(id) ?? p;
        at.set(id, [f[0] + (p[0] - f[0]) * k, f[1] + (p[1] - f[1]) * k]);
      }
      shown.current = at;
      source.setData(toGeoJSON(vehicles, at));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [vehicles, reducedMotion]);

  // Highlight the selected vehicle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map?.getLayer('vehicle-halo')) return;
    map.setFilter('vehicle-halo', ['==', ['get', 'id'], selectedId ?? '']);
  }, [selectedId, vehicles]);

  // Keep a followed vehicle in view as it moves.
  useEffect(() => {
    const map = mapRef.current;
    const v = vehicles.find((x) => x.id === selectedId);
    if (!map || !v || !follow) return;
    map.easeTo({
      center: [v.lon, v.lat],
      zoom: Math.max(map.getZoom(), 12),
      padding: props.current.padding,
      duration: reducedMotion ? 0 : GLIDE_MS,
    });
  }, [vehicles, selectedId, follow, reducedMotion]);

  return (
    <div
      ref={container}
      className="map"
      role="application"
      aria-label="Map of trains and buses. For a text list, use the List view."
    />
  );
}
