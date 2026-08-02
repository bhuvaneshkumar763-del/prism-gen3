// @vitest-environment happy-dom
import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubMatchMedia(prefersDark: boolean): { listeners: Set<() => void>; setPrefersDark(next: boolean): void } {
  const listeners = new Set<() => void>();
  let matches = prefersDark;
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_type: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_type: string, cb: () => void) => listeners.delete(cb),
  }));
  return {
    listeners,
    setPrefersDark(next: boolean) {
      matches = next;
      listeners.forEach((cb) => {
        cb();
      });
    },
  };
}

/**
 * `applyTheme.ts` imports the module-level `configStore` singleton, which
 * memoizes `onReady()`'s result — resetting modules between tests is
 * required so each test gets its own fresh singleton reading its own
 * `fakeBrowser` storage state, not the previous test's already-resolved one.
 */
async function freshApplyTheme() {
  vi.resetModules();
  const mod = await import('./applyTheme');
  return mod.applyTheme;
}

describe('applyTheme', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets data-theme from the resolved theme once config is ready', async () => {
    await fakeBrowser.storage.local.set({ theme: 'dark' });
    stubMatchMedia(false);
    const applyTheme = await freshApplyTheme();

    applyTheme();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it("defers to the OS signal for theme:'auto'", async () => {
    await fakeBrowser.storage.local.set({ theme: 'auto' });
    stubMatchMedia(true);
    const applyTheme = await freshApplyTheme();

    applyTheme();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('updates data-theme live when the OS signal changes (auto theme)', async () => {
    await fakeBrowser.storage.local.set({ theme: 'auto' });
    const media = stubMatchMedia(false);
    const applyTheme = await freshApplyTheme();

    applyTheme();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    media.setPrefersDark(true);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('updates data-theme live when the theme config key changes', async () => {
    await fakeBrowser.storage.local.set({ theme: 'light' });
    stubMatchMedia(false);
    vi.resetModules();
    const applyThemeMod = await import('./applyTheme');
    const configStoreMod = await import('./configStore');

    applyThemeMod.applyTheme();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await configStoreMod.configStore.set('theme', 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('ignores onChanged notifications for unrelated config keys', async () => {
    await fakeBrowser.storage.local.set({ theme: 'light' });
    stubMatchMedia(false);
    vi.resetModules();
    const applyThemeMod = await import('./applyTheme');
    const configStoreMod = await import('./configStore');

    applyThemeMod.applyTheme();
    await vi.waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));

    await configStoreMod.configStore.set('targetLanguage', 'ja');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
