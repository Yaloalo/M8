import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';
type ThemePreference = Theme | 'system';
const listeners = new Set<() => void>();
let preference: ThemePreference = 'system';
let theme: Theme = 'light';
let media: MediaQueryList | undefined;
let initialized = false;

/** Nothing is stored, so a fresh tab always starts from the system setting. */
function readPreference(): ThemePreference {
  return 'system';
}

function applyTheme() {
  theme = preference === 'system' ? (media?.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#050505' : '#141414');
  listeners.forEach((listener) => listener());
}

/** Apply before React mounts so an existing preference also governs the first render. */
export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  preference = readPreference();
  media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (preference === 'system') applyTheme();
  });
  applyTheme();
}

export function setThemePreference(value: ThemePreference) {
  preference = value;
  applyTheme();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme() {
  return useSyncExternalStore(
    subscribe,
    () => theme,
    () => 'light' as Theme,
  );
}
