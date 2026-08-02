import { resolveTheme } from '../shared/theme';
import { configStore } from './configStore';

/**
 * Sets `data-theme` on `<html>` from the `theme` config key, live. Used by
 * both `entrypoints/popup/main.tsx` and `entrypoints/options/main.tsx` — a
 * real top-level extension page (not a shadow-DOM content-script surface)
 * can `@import` `styles/tokens.css`-style CSS variables keyed off this
 * attribute directly; a `prefers-color-scheme` media query alone can't
 * express an explicit "always light"/"always dark" override.
 */
export function applyTheme(): void {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function apply(): void {
    document.documentElement.dataset.theme = resolveTheme(configStore.get('theme'), media.matches);
  }

  void configStore.onReady().then(apply);
  configStore.onChanged((name) => {
    if (name === 'theme') apply();
  });
  media.addEventListener('change', apply);
}
