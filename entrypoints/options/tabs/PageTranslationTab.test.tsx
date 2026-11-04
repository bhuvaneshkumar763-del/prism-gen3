// @vitest-environment happy-dom
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Config, defaultConfig } from '../../../src/shared/config/schema';
import { PageTranslationTab } from './PageTranslationTab';

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock('../../../src/platform/messaging/protocol', () => ({ sendMessage }));

describe('PageTranslationTab', () => {
  let container: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    container?.remove();
    sendMessage.mockReset();
  });

  function mount(overrides: Partial<Config>, setField: (key: string, value: unknown) => Promise<void>) {
    const [settings] = createStore<Config>({ ...defaultConfig, ...overrides });
    const [savedField] = createSignal(null);
    container = document.createElement('div');
    document.body.append(container);
    dispose = render(
      () =>
        PageTranslationTab({
          settings,
          setField: setField as never,
          savedField,
          onError: () => {},
        }),
      container,
    );
    return container;
  }

  it('"Test translation" waits for an API key typed just before it to finish saving', async () => {
    const pendingSaves: Array<() => void> = [];
    const setField = vi.fn(() => new Promise<void>((resolve) => pendingSaves.push(resolve)));
    sendMessage.mockResolvedValue({ ok: true, value: 'Bonjour' });
    const el = mount({ pageTranslatorProvider: 'googleCloudTranslate' }, setField);

    const keyInput = el.querySelector('input[type="password"]') as HTMLInputElement;
    keyInput.value = 'new-key';
    keyInput.dispatchEvent(new Event('change', { bubbles: true }));
    const testButton = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Test translation');
    testButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(setField).toHaveBeenCalledWith('googleCloudTranslateApiKey', 'new-key');
    expect(sendMessage).not.toHaveBeenCalled();
    for (const finish of pendingSaves) finish();
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
  });

  it('"Test translation" saves a key still in the box (no change event yet) before testing', async () => {
    const order: string[] = [];
    const setField = vi.fn(async (key: string) => {
      order.push(`save ${key}`);
    });
    sendMessage.mockImplementation(async () => {
      order.push('test');
      return { ok: true, value: 'Bonjour' };
    });
    const el = mount({ pageTranslatorProvider: 'googleCloudTranslate' }, setField);
    (el.querySelector('input[type="password"]') as HTMLInputElement).value = 'typed-key';
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Test translation')?.click();
    await vi.waitFor(() => expect(order).toEqual(['save googleCloudTranslateApiKey', 'test']));
    expect(setField).toHaveBeenCalledWith('googleCloudTranslateApiKey', 'typed-key');
  });

  it('lists the source languages picked in the bubble, with a way to remove them', () => {
    const setField = vi.fn(async () => {});
    const el = mount({ sourceLanguageByHost: { 'example.com': 'zh-CN' } }, setField);
    expect(el.querySelector('.siteTable')?.textContent).toContain('example.com');
    expect(el.querySelector('.siteTable')?.textContent).toContain('Chinese (Simplified)');
    const remove = el.querySelector('button[aria-label="Remove override for example.com"]') as HTMLButtonElement;
    remove.click();
    expect(setField).toHaveBeenCalledWith('sourceLanguageByHost', {});
  });
});
