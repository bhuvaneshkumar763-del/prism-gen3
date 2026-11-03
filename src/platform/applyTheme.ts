import { type ResolvedTheme, resolveTheme } from '../shared/theme';
import { configStore } from './configStore';

/**
 * Last resolved theme, cached in synchronous `localStorage` so the page can
 * apply it before first paint instead of flashing light while config loads
 * asynchronously. Corrected moments later if stale.
 */
const LAST_THEME_KEY = 'prism-last-theme';

function readCachedTheme(): ResolvedTheme | null {
  try {
    const cached = localStorage.getItem(LAST_THEME_KEY);
    return cached === 'light' || cached === 'dark' ? cached : null;
  } catch {
    // localStorage can throw in some sandboxed/private-browsing contexts; skip the cache.
    return null;
  }
}

function writeCachedTheme(theme: ResolvedTheme): void {
  try {
    localStorage.setItem(LAST_THEME_KEY, theme);
  } catch {
    // Best-effort only; the next open falls back to the async path.
  }
}

/**
 * Sets `data-theme` on `<html>` from the `theme` config key, live, for the
 * popup and options pages. A `prefers-color-scheme` query alone can't express
 * an explicit light/dark override.
 */
export function applyTheme(): void {
  const cached = readCachedTheme();
  if (cached) document.documentElement.dataset.theme = cached;

  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function apply(): void {
    const theme = resolveTheme(configStore.get('theme'), media.matches);
    document.documentElement.dataset.theme = theme;
    writeCachedTheme(theme);
  }

  void configStore.onReady().then(apply);
  configStore.onChanged((name) => {
    if (name === 'theme') apply();
  });
  media.addEventListener('change', apply);
}
