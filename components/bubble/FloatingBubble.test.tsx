// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configStore } from '../../src/platform/configStore';
import { FloatingBubble } from './FloatingBubble';

describe('FloatingBubble', () => {
  let container: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    await configStore.onReady();
    await configStore.set('alwaysTranslateSites', []);
    await configStore.set('sourceLanguageByHost', {});
    await configStore.set('bubbleByHost', {});
    await configStore.set('targetLanguage', 'es');
    await configStore.set('pageTranslatorProvider', 'google');
  });

  afterEach(() => {
    dispose?.();
    container?.remove();
    container = undefined;
    dispose = undefined;
  });

  function mount(overrides: Partial<Parameters<typeof FloatingBubble>[0]> = {}) {
    container = document.createElement('div');
    document.body.append(container);
    const props = {
      state: { pageState: 'original' as const, busy: false, errorMessage: null as string | null },
      hostname: 'example.com',
      shadowHost: container,
      onTranslate: vi.fn(),
      onRestore: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    dispose = render(() => FloatingBubble(props), container);
    return { el: container, props };
  }

  it('renders the ball and panel primary button', () => {
    const { el } = mount();
    expect(el.querySelector('.ball')).not.toBeNull();
    expect(el.querySelector('.primary')).not.toBeNull();
  });

  it('shows "Translate page" before translation', () => {
    const { el } = mount();
    expect(el.querySelector('.primary')?.textContent).toBe('Translate page');
  });

  it('shows "Show original" once translated', () => {
    const { el } = mount({ state: { pageState: 'translated', busy: false, errorMessage: null } });
    expect(el.querySelector('.primary')?.textContent).toBe('Show original');
  });

  it('disables the primary button and shows a busy label while busy', () => {
    const { el } = mount({ state: { pageState: 'translated', busy: true, errorMessage: null } });
    const primary = el.querySelector('.primary') as HTMLButtonElement;
    expect(primary.textContent).toBe('Restoring…');
    expect(primary.disabled).toBe(true);
  });

  it('invokes onRestore when the primary button is clicked while translated', () => {
    const onRestore = vi.fn();
    const { el } = mount({ state: { pageState: 'translated', busy: false, errorMessage: null }, onRestore });
    (el.querySelector('.primary') as HTMLButtonElement).click();
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('invokes onTranslate with the current target language when the primary button is clicked while original', () => {
    const onTranslate = vi.fn();
    const { el } = mount({ onTranslate });
    (el.querySelector('.primary') as HTMLButtonElement).click();
    expect(onTranslate).toHaveBeenCalledWith('es');
  });

  it('shows a real error instead of the normal "Translated" success, even in the translated state', () => {
    const { el } = mount({ state: { pageState: 'translated', busy: false, errorMessage: 'HTTP 429' } });
    expect(el.querySelector('.htitle')?.textContent).toBe('Translation failed');
    expect(el.querySelector('.errorText')?.textContent).toBe('HTTP 429');
    expect(el.querySelector('.primary')?.textContent).not.toBe('Show original');
  });

  it("the error state's primary button retries via onTranslate, not onRestore", () => {
    const onTranslate = vi.fn();
    const onRestore = vi.fn();
    const { el } = mount({
      state: { pageState: 'translated', busy: false, errorMessage: 'HTTP 429' },
      onTranslate,
      onRestore,
    });
    expect(el.querySelector('.primary')?.textContent).toBe('Retry');
    (el.querySelector('.primary') as HTMLButtonElement).click();
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('invokes onClose when the Hide chip is clicked', () => {
    const onClose = vi.fn();
    const { el } = mount({ onClose });
    const hideChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Hide'));
    (hideChip as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the Always chip reflects an existing alwaysTranslateSites entry for this host', async () => {
    await configStore.set('alwaysTranslateSites', ['example.com']);
    const { el } = mount();
    const alwaysChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Always'));
    expect(alwaysChip?.className).toContain('on');
  });

  it('clicking the Always chip immediately triggers a translate when the page is still original', () => {
    const onTranslate = vi.fn();
    const { el } = mount({ onTranslate });
    const alwaysChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Always'));
    (alwaysChip as HTMLElement).click();
    expect(onTranslate).toHaveBeenCalledWith('es');
  });

  it('renders From/To/Service selects with the current values selected', () => {
    const { el } = mount();
    const selects = el.querySelectorAll('.selrow select');
    expect(selects).toHaveLength(3);
    const [fromSelect, toSelect, serviceSelect] = Array.from(selects) as [
      HTMLSelectElement,
      HTMLSelectElement,
      HTMLSelectElement,
    ];
    expect(fromSelect.value).toBe('auto');
    expect(toSelect.value).toBe('es');
    expect(serviceSelect.value).toBe('google');
  });

  it('changing the To select calls onTranslate with the newly picked code', () => {
    const onTranslate = vi.fn();
    const { el } = mount({ onTranslate });
    const selects = el.querySelectorAll('.selrow select');
    const toSelect = selects[1] as HTMLSelectElement;
    toSelect.value = 'ja';
    toSelect.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onTranslate).toHaveBeenCalledWith('ja');
  });
});
