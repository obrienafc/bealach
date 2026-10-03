'use client';

import { Crosshair, List, Map as MapIcon, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MODE_BY_ID, MODES, type Mode, type Vehicle } from '@/lib/vehicles';
import { GitHubMark, MODE_ICONS, STROKE } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { TransitMap } from './TransitMap';
import { useIsDark, useReducedMotion } from './useAppearance';
import { useFeed } from './useFeed';

const TRAINS_EVERY = 20_000;
const BUSES_EVERY = 30_000;
// Irish Rail refreshes about once a minute; after this long, say so.
const STALE_AFTER = 3 * 60_000;

export function delayText(delay: number | undefined) {
  if (delay === undefined) return null;
  if (delay === 0) return 'On time';
  if (delay < 0) return `${-delay} min early`;
  return `${delay} min late`;
}

function matches(v: Vehicle, q: string) {
  if (!q) return true;
  const needle = q.toLowerCase();
  // Route numbers match exactly ("46" shouldn't find "146"); text matches anywhere.
  if (v.label.toLowerCase() === needle) return true;
  if (v.mode === 'bus' && /^\d+[a-z]?$/i.test(q)) return false;
  return [v.label, v.title, v.to, v.next, v.status].some((s) => s?.toLowerCase().includes(needle));
}

function useNow(everyMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

function ago(date: Date, now: number) {
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)} min ago`;
}

function readParams() {
  const p = new URLSearchParams(location.search);
  return { selected: p.get('v'), query: p.get('q') ?? '' };
}

export function Bealach({ busesEnabled }: { busesEnabled: boolean }) {
  const trains = useFeed('/api/trains', TRAINS_EVERY);
  const buses = useFeed(busesEnabled ? '/api/buses' : null, BUSES_EVERY);
  const dark = useIsDark();
  const reducedMotion = useReducedMotion();
  const now = useNow(5_000);

  const [hidden, setHidden] = useState<Set<Mode>>(new Set());
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  // Read on first render (the map is created client-side only), so the
  // initial fit uses the right padding. Padding isn't rendered, so this can't
  // cause a hydration mismatch.
  const [wide, setWide] = useState(() => (typeof window === 'undefined' ? true : innerWidth >= 768));

  // Selection and search live in the URL, so a link can point at one train.
  useEffect(() => {
    const { selected, query } = readParams();
    if (selected) {
      setSelectedId(selected);
      setFollow(true);
    }
    setQuery(query);
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    if (selectedId) url.searchParams.set('v', selectedId);
    else url.searchParams.delete('v');
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    history.replaceState(null, '', url);
  }, [selectedId, query]);

  useEffect(() => {
    const measure = () => setWide(innerWidth >= 768);
    measure();
    addEventListener('resize', measure);
    return () => removeEventListener('resize', measure);
  }, []);

  const all = useMemo(() => [...trains.vehicles, ...buses.vehicles], [trains.vehicles, buses.vehicles]);
  const searched = useMemo(() => all.filter((v) => matches(v, query.trim())), [all, query]);
  const visible = useMemo(() => searched.filter((v) => !hidden.has(v.mode)), [searched, hidden]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(MODES.map((m) => [m.mode, 0])) as Record<Mode, number>;
    for (const v of searched) c[v.mode]++;
    return c;
  }, [searched]);
  const selected = all.find((v) => v.id === selectedId) ?? null;

  // Keep fitted and followed vehicles clear of the floating panels.
  const padding = useMemo(
    () =>
      wide
        ? { top: 40, bottom: 40, left: 420, right: selected ? 400 : 40 }
        : { top: 220, bottom: selected ? 320 : 40, left: 24, right: 24 },
    [wide, Boolean(selected)], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Trains always; buses with an NTA key. The NTA feed has no Luas trams at
  // present, so their filter appears only if some do.
  const hasLuas = buses.vehicles.some((v) => v.mode === 'luas');
  const modes = MODES.filter((m) => (m.mode === 'bus' ? busesEnabled : m.mode === 'luas' ? hasLuas : true));
  const loading = trains.loading || buses.loading;
  const failed = trains.error && trains.vehicles.length === 0 && !trains.loading;
  const updated = trains.updated;
  const stale = updated ? now - updated.getTime() > STALE_AFTER : false;

  const toggle = (mode: Mode) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      return next;
    });

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setFollow(false);
  }, []);

  const noun = busesEnabled ? (visible.length === 1 ? 'vehicle' : 'vehicles') : visible.length === 1 ? 'train' : 'trains';

  return (
    <main className="app">
      <TransitMap
        vehicles={visible}
        selectedId={selectedId}
        follow={follow}
        dark={dark}
        reducedMotion={reducedMotion}
        padding={padding}
        onSelect={select}
      />

      <div className="top-actions">
        <ThemeToggle />
        <a className="icon-button" href="https://github.com/obrienafc/bealach" aria-label="Bealach on GitHub" title="GitHub">
          <GitHubMark />
        </a>
      </div>

      <section className={`panel ${view === 'list' ? 'expanded' : ''}`} aria-label="Live services">
        <header className="brand">
          <svg className="logo" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="8" />
            <path d="M8 22c3-8 13-4 16-12" />
            <circle cx="8" cy="22" r="2.5" />
            <circle cx="24" cy="10" r="2.5" />
          </svg>
          <div>
            <h1>Bealach</h1>
            <p className="muted">Ireland’s trains{busesEnabled ? ' and buses' : ''}, live.</p>
          </div>
        </header>

        <div className="hero" aria-live="polite">
          {failed ? (
            <div className="state">
              <p className="state-title">Couldn’t reach Irish Rail</p>
              <p className="muted">{trains.error}</p>
              <button className="button" onClick={trains.retry}>
                <RefreshCw size={16} strokeWidth={STROKE} aria-hidden /> Try again
              </button>
            </div>
          ) : loading && all.length === 0 ? (
            <>
              <span className="count placeholder" aria-hidden>
                00
              </span>
              <span className="muted">Finding trains…</span>
            </>
          ) : all.length === 0 ? (
            <div className="state">
              <p className="state-title">No trains running right now</p>
              <p className="muted">Irish Rail services run from about 5:30am to midnight.</p>
            </div>
          ) : (
            <>
              <span className="count">{visible.length.toLocaleString('en-IE')}</span>
              <span className="muted">
                {noun} {query ? `matching “${query.trim()}”` : 'moving now'}
              </span>
            </>
          )}
        </div>

        <label className="search">
          <Search size={16} strokeWidth={STROKE} aria-hidden />
          <input
            type="search"
            placeholder={busesEnabled ? 'Route, train or station' : 'Train or station'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter by route, train code or station"
            enterKeyHint="search"
          />
          {query && (
            <button className="clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={14} strokeWidth={STROKE} aria-hidden />
            </button>
          )}
        </label>

        <div className="chips" role="group" aria-label="Show services">
          {modes.map((m) => (
            <button
              key={m.mode}
              className="chip"
              aria-pressed={!hidden.has(m.mode)}
              onClick={() => toggle(m.mode)}
              style={{ '--mode': m.color } as React.CSSProperties}
            >
              <span className="dot" aria-hidden />
              {m.plural}
              <span className="chip-count">{counts[m.mode]}</span>
            </button>
          ))}
        </div>

        <div className="panel-foot">
          <p className={`status ${stale || trains.error ? 'warn' : ''}`}>
            <span className="live-dot" aria-hidden />
            {trains.error && updated
              ? `Couldn’t refresh, showing ${ago(updated, now)}`
              : trains.error
                ? 'Retrying every 20 seconds'
              : stale && updated
                ? `Feed delayed, last update ${ago(updated, now)}`
                : updated
                  ? `Live, updated ${ago(updated, now)}`
                  : 'Connecting…'}
          </p>
          <div className="segmented" role="radiogroup" aria-label="View">
            <button role="radio" aria-checked={view === 'map'} onClick={() => setView('map')}>
              <MapIcon size={14} strokeWidth={STROKE} aria-hidden /> Map
            </button>
            <button role="radio" aria-checked={view === 'list'} onClick={() => setView('list')}>
              <List size={14} strokeWidth={STROKE} aria-hidden /> List
            </button>
          </div>
        </div>

        {view === 'list' && <VehicleList vehicles={visible} selectedId={selectedId} onSelect={(id) => {
          setSelectedId(id);
          setFollow(true);
          if (innerWidth < 768) setView('map');
        }} />}

        <footer className="credits">
          Train data: Iarnród Éireann{busesEnabled ? '. Bus data: NTA, CC BY 4.0' : ''}.{' '}
          Built by <a href="https://patrickob.tech">Patrick O’Brien</a>.
        </footer>
      </section>

      {selected && (
        <VehicleCard
          vehicle={selected}
          now={now}
          follow={follow}
          onFollow={() => setFollow((f) => !f)}
          onClose={() => select(null)}
        />
      )}
      {selectedId && !selected && !loading && (
        <aside className="card" aria-live="polite">
          <div className="card-head">
            <div>
              <p className="card-title">Not running now</p>
              <p className="muted">This service has finished or hasn’t started yet.</p>
            </div>
            <button className="icon-button" onClick={() => select(null)} aria-label="Close">
              <X size={16} strokeWidth={STROKE} aria-hidden />
            </button>
          </div>
        </aside>
      )}
    </main>
  );
}

function VehicleList({
  vehicles,
  selectedId,
  onSelect,
}: {
  vehicles: Vehicle[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // Most-delayed trains first: the list answers "what's running late?".
  const sorted = useMemo(
    () => [...vehicles].sort((a, b) => (b.delay ?? -99) - (a.delay ?? -99) || a.label.localeCompare(b.label)),
    [vehicles],
  );
  const shown = sorted.slice(0, 300);
  if (!vehicles.length) return <p className="muted list-empty">Nothing matches.</p>;
  return (
    <div className="list">
      <ul>
        {shown.map((v) => {
          const Icon = MODE_ICONS[v.mode];
          const delay = delayText(v.delay);
          return (
            <li key={v.id}>
              <button
                className="row"
                aria-current={v.id === selectedId}
                onClick={() => onSelect(v.id)}
                style={{ '--mode': MODE_BY_ID[v.mode].color } as React.CSSProperties}
              >
                <span className="row-icon" aria-hidden>
                  <Icon size={16} strokeWidth={STROKE} />
                </span>
                <span className="row-main">
                  <span className="row-title">
                    <strong>{v.label}</strong> {v.to ? `to ${v.to}` : v.title}
                  </span>
                  <span className="muted">{v.status ?? v.operator}</span>
                </span>
                {delay && <span className={`delay ${(v.delay ?? 0) >= 5 ? 'late' : ''}`}>{delay}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {sorted.length > shown.length && (
        <p className="muted list-empty">Showing 300 of {sorted.length.toLocaleString('en-IE')}. Search to narrow down.</p>
      )}
    </div>
  );
}

function VehicleCard({
  vehicle: v,
  now,
  follow,
  onFollow,
  onClose,
}: {
  vehicle: Vehicle;
  now: number;
  follow: boolean;
  onFollow: () => void;
  onClose: () => void;
}) {
  const mode = MODE_BY_ID[v.mode];
  const Icon = MODE_ICONS[v.mode];
  const delay = delayText(v.delay);
  return (
    <aside className="card" aria-label={`${mode.label} ${v.label}`} style={{ '--mode': mode.color } as React.CSSProperties}>
      <div className="card-head">
        <span className="card-icon" aria-hidden>
          <Icon size={20} strokeWidth={STROKE} />
        </span>
        <div className="card-heading">
          <p className="eyebrow">
            {mode.label} · {v.label}
          </p>
          <p className="card-title">{v.to ? `To ${v.to}` : v.title}</p>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close">
          <X size={16} strokeWidth={STROKE} aria-hidden />
        </button>
      </div>

      {delay && <p className={`card-delay ${(v.delay ?? 0) >= 5 ? 'late' : ''}`}>{delay}</p>}

      <dl className="facts">
        {v.title && v.to && (
          <div>
            <dt>Route</dt>
            <dd>{v.title}</dd>
          </div>
        )}
        {v.departed && (
          <div>
            <dt>Scheduled departure</dt>
            <dd>{v.departed}</dd>
          </div>
        )}
        {v.status && (
          <div>
            <dt>Last seen</dt>
            <dd>{v.status}</dd>
          </div>
        )}
        {v.next && (
          <div>
            <dt>Next stop</dt>
            <dd>{v.next}</dd>
          </div>
        )}
        {v.operator && (
          <div>
            <dt>Operator</dt>
            <dd>{v.operator}</dd>
          </div>
        )}
        {v.seen && (
          <div>
            <dt>Position from</dt>
            <dd>{ago(new Date(v.seen), now)}</dd>
          </div>
        )}
      </dl>

      <button className="button" aria-pressed={follow} onClick={onFollow}>
        <Crosshair size={16} strokeWidth={STROKE} aria-hidden />
        {follow ? 'Following' : 'Follow on map'}
      </button>
    </aside>
  );
}
