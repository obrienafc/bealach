'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Feed, Vehicle } from '@/lib/vehicles';

export type FeedState = {
  vehicles: Vehicle[];
  /** When the server last read the upstream feed. */
  updated: Date | null;
  loading: boolean;
  /** Set when the latest refresh failed; older vehicles are kept. */
  error: string | null;
  retry: () => void;
};

/** Polls a feed while the page is visible. Pauses in background tabs. */
export function useFeed(url: string | null, everyMs: number): FeedState {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inFlight = useRef<AbortController>(undefined);

  const load = useCallback(async () => {
    if (!url) return;
    clearTimeout(timer.current);
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = (await res.json()) as Feed | { error: string };
      if ('error' in body) throw new Error(body.error);
      setVehicles(body.vehicles);
      setUpdated(new Date(body.updated));
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof TypeError ? 'You appear to be offline.' : (err as Error).message);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        if (document.visibilityState === 'visible') timer.current = setTimeout(load, everyMs);
      }
    }
  }, [url, everyMs]);

  useEffect(() => {
    if (!url) return;
    load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
      else clearTimeout(timer.current);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer.current);
      inFlight.current?.abort();
    };
  }, [url, load]);

  return { vehicles, updated, loading, error, retry: load };
}
