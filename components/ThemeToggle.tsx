'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useLayoutEffect, useState } from 'react';
import { THEME_KEY } from '@/lib/theme';
import { STROKE } from './icons';

type Theme = 'system' | 'light' | 'dark';

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'Match system appearance', Icon: Monitor },
  { value: 'light', label: 'Light appearance', Icon: Sun },
  { value: 'dark', label: 'Dark appearance', Icon: Moon },
];

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  // React owns <html> and drops the attribute the pre-paint script set, so
  // reapply it before the browser paints.
  useLayoutEffect(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved);
        apply(saved);
      }
    } catch {}
  }, []);

  const choose = (next: Theme) => {
    setTheme(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {}
  };

  return (
    <div className="theme-toggle" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => choose(value)}
        >
          <Icon size={16} strokeWidth={STROKE} aria-hidden />
        </button>
      ))}
    </div>
  );
}
