'use client';

import { useEffect, useState } from 'react';

/** Whether the page is currently dark: the viewer's choice, else the system's. */
export function useIsDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const read = () => {
      const chosen = document.documentElement.dataset.theme;
      setDark(chosen ? chosen === 'dark' : media.matches);
    };
    read();
    media.addEventListener('change', read);
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', read);
      observer.disconnect();
    };
  }, []);
  return dark;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const read = () => setReduced(media.matches);
    read();
    media.addEventListener('change', read);
    return () => media.removeEventListener('change', read);
  }, []);
  return reduced;
}
