// @vitest-environment happy-dom
import { fakeBrowser } from '@webext-core/fake-browser';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../entrypoints/options/App';
import { BubbleTab } from '../../entrypoints/options/tabs/BubbleTab';
import { PageTranslationTab } from '../../entrypoints/options/tabs/PageTranslationTab';
import { SelectionTab } from '../../entrypoints/options/tabs/SelectionTab';
import type { SettingsTabProps } from '../../entrypoints/options/tabs/types';
import { type Config, type ConfigKey, defaultConfig } from '../../src/shared/config/schema';

// The Settings tabs live under entrypoints/, which Vitest doesn't collect, so
// their render tests sit next to the options components.

let container: HTMLDivElement | undefined;
let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  container?.remove();
  container = undefined;
  dispose = undefined;
  vi.useRealTimers();
});

function mountTab(Tab: (props: SettingsTabProps) => unknown, overrides: Partial<Config> = {}) {
  const setField = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  dispose = render(() => {
    const [settings, setSettings] = createStore<Config>({ ...structuredClone(defaultConfig), ...overrides });
    const [savedField] = createSignal<ConfigKey | null>(null);
    setField.mockImplementation(async (key: ConfigKey, value: unknown) => {
      setSettings({ [key]: value } as Partial<Config>);
    });
    return Tab({ settings, setField, savedField, onError: () => {} }) as never;
  }, container);
  return { el: container, setField };
}

function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

describe('BubbleTab', () => {
  it('confirms "Bubble position reset" after Reset remembered position', async () => {
    const { el, setField } = mountTab(BubbleTab, { bubblePosition: { side: 'left', yFrac: 0.3 } });
    expect(el.textContent).not.toContain('Bubble position reset');
    button(el, 'Reset remembered position').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(setField).toHaveBeenCalledWith('bubblePosition', null);
    expect(el.querySelector('[role="status"]')?.textContent).toContain('Bubble position reset');
  });
});

describe('PageTranslationTab', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('explains the lists the way the controls work: type a site, pick a language', () => {
    const { el } = mountTab(PageTranslationTab);
    const text = el.textContent ?? '';
    expect(text).not.toMatch(/per line/i);
    expect(text).not.toMatch(/language code/i);
    expect(text).toMatch(/pick/i);
  });
});

describe('SelectionTab', () => {
  it('shows per-site source-language overrides by language name', () => {
    const { el } = mountTab(SelectionTab, { sourceLanguageByHost: { 'example.com': 'zh-CN' } });
    expect(el.querySelector('.siteTable')?.textContent).toContain('Chinese (Simplified)');
    expect(el.querySelector('.siteTable')?.textContent).not.toContain('zh-CN');
  });
});

describe('Settings page', () => {
  async function mountApp() {
    vi.spyOn(fakeBrowser.commands, 'getAll').mockResolvedValue([] as never);
    container = document.createElement('div');
    document.body.append(container);
    dispose = render(() => App(), container);
    await vi.waitFor(() => expect(container?.querySelector('[role="tablist"]')).not.toBeNull());
    return container;
  }

  const visiblePanel = (el: HTMLElement) => el.querySelector('[role="tabpanel"]:not([hidden])')?.id;

  it('switches section when an already-open Settings tab is sent to a new #section', async () => {
    history.replaceState(null, '', '#general');
    const el = await mountApp();
    expect(visiblePanel(el)).toBe('panel-general');
    location.hash = '#page';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(visiblePanel(el)).toBe('panel-page');
  });

  it('keeps the address in step with the chosen tab, so a later link to the same section still switches', async () => {
    history.replaceState(null, '', '#page');
    const el = await mountApp();
    (el.querySelector('#tab-general') as HTMLButtonElement).click();
    expect(location.hash).toBe('#general');
  });
});
