import { type ResolvedTheme, resolveTheme } from '../shared/theme';
import { configStore } from './configStore';

/**
 * `configStore.onReady()` is an async storage read — every popup/options
 * open used to paint once with no `data-theme` set at all (default/light
 * styling), then flip to the real theme once config loaded, a visible
 * flash on every single open. `localStorage` on a real extension page (not
 * a shadow-DOM content-script surface) is synchronous and same-origin, so
 * the last *resolved* theme can be read and applied before any paint,
 * correcting itself moments later in the rare case it's stale (e.g. the
 * theme changed in another tab since this page was last opened).
 */
const LAST_THEME_KEY = 'prism-last-theme';

function readCachedTheme(): ResolvedTheme | null {
  try {
    const cached = localStorage.getItem(LAST_THEME_KEY);
    return cached === 'light' || cached === 'dark' ? cached : null;
  } catch {
    // localStorage can throw in rare sandboxed/private-browsing edge cases — just skip the cache.
    return null;
  }
}

function writeCachedTheme(theme: ResolvedTheme): void {
  try {
    localStorage.setItem(LAST_THEME_KEY, theme);
  } catch {
    // Best-effort only — next open just falls back to the async path.
  }
}

/**
 * Sets `data-theme` on `<html>` from the `theme` config key, live. Used by
 * both `entrypoints/popup/main.tsx` and `entrypoints/options/main.tsx` — a
 * real top-level extension page (not a shadow-DOM content-script surface)
 * can `@import` `styles/tokens.css`-style CSS variables keyed off this
 * attribute directly; a `prefers-color-scheme` media query alone can't
 * express an explicit "always light"/"always dark" override.
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
