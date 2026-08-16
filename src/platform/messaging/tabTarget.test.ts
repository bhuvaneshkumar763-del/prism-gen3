import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveTab, getActiveTabId } from './tabTarget';

describe('getActiveTabId', () => {
  let windowId: number | undefined;

  beforeEach(async () => {
    fakeBrowser.reset();
    // fake-browser's tabs.query({currentWindow: true}) resolves via
    // windows.getCurrent(), which returns undefined until some window has
    // actually been created with focused:true (windows.update() is a
    // no-op stub in this fake implementation) — a real browser always has
    // a focused window, so this is just test setup, not something
    // getActiveTabId itself needs to handle.
    const win = await fakeBrowser.windows.create({ focused: true });
    if (!win?.id) throw new Error('expected a window id');
    windowId = win.id;
  });

  it('resolves the active tab in the current window', async () => {
    await fakeBrowser.tabs.create({ active: false, windowId });
    const active = await fakeBrowser.tabs.create({ active: true, windowId });

    const tabId = await getActiveTabId();

    expect(tabId).toBe(active.id);
  });

  it('throws when there is no active tab', async () => {
    await expect(getActiveTabId()).rejects.toThrow('No active tab');
  });

  // Exercised from two conceptual call sites in the real extension —
  // popup/App.tsx's translate/restore buttons, and background.ts's
  // context-menu/keyboard-command handlers — both calling this exact same
  // function rather than each re-implementing tab lookup, which is the
  // specific duplication this module exists to prevent. Simulated here as
  // two independent calls against the same active-tab state.
  it('returns the same tab id across multiple independent calls (usable from more than one call site)', async () => {
    const active = await fakeBrowser.tabs.create({ active: true, windowId });

    const fromCallSiteA = await getActiveTabId();
    const fromCallSiteB = await getActiveTabId();

    expect(fromCallSiteA).toBe(active.id);
    expect(fromCallSiteB).toBe(active.id);
  });
});

describe('getActiveTab', () => {
  let windowId: number | undefined;

  beforeEach(async () => {
    fakeBrowser.reset();
    const win = await fakeBrowser.windows.create({ focused: true });
    if (!win?.id) throw new Error('expected a window id');
    windowId = win.id;
  });

  it('resolves the full active tab (id and url), not just its id', async () => {
    const active = await fakeBrowser.tabs.create({ active: true, windowId, url: 'https://example.com/' });

    const tab = await getActiveTab();

    expect(tab.id).toBe(active.id);
    expect(tab.url).toBe('https://example.com/');
  });

  it('throws when there is no active tab', async () => {
    await expect(getActiveTab()).rejects.toThrow('No active tab');
  });
});
