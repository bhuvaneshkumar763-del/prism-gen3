// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configStore } from '../../src/platform/configStore';
import { trusted } from '../../tests/trustedEvent';
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
      state: {
        pageState: 'original' as const,
        busy: false,
        errorMessage: null as string | null,
        errorKind: null as 'offline' | 'provider' | null,
        progress: null as number | null,
      },
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

  it('moves live when bubblePosition changes elsewhere (another tab), real gap: onChanged never actually handled this key despite the header comment claiming it did', async () => {
    await configStore.set('bubblePosition', { side: 'right', yFrac: 0.5 });
    const { el } = mount();
    const wrap = el.querySelector('.wrap');
    expect(wrap?.classList.contains('right')).toBe(true);

    await configStore.set('bubblePosition', { side: 'left', yFrac: 0.5 });

    expect(wrap?.classList.contains('right')).toBe(false);
  });

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
    const { el } = mount({
      state: { pageState: 'translated', busy: false, errorMessage: null, errorKind: null, progress: null },
    });
    expect(el.querySelector('.primary')?.textContent).toBe('Show original');
  });

  it('disables the primary button and shows a busy label while busy', () => {
    // pageState:'translated' + busy:true is what an active RE-translate
    // looks like, not a restore in progress — see mountBubble.test.ts's
    // matching test for the full explanation.
    const { el } = mount({
      state: { pageState: 'translated', busy: true, errorMessage: null, errorKind: null, progress: null },
    });
    const primary = el.querySelector('.primary') as HTMLButtonElement;
    expect(primary.textContent).toBe('Translating…');
    expect(primary.disabled).toBe(true);
  });

  it('clicking the ball while a translation is already in flight does not fire a second onTranslate', () => {
    // Regression: the ball button (unlike the panel's .primary button) has
    // no `disabled` binding at all — only a fixed 600ms local debounce,
    // far shorter than a real translation on a slow page/provider. A click
    // while props.state.busy is true used to fire another onTranslate.
    const onTranslate = vi.fn();
    const { el } = mount({
      state: { pageState: 'original', busy: true, errorMessage: null, errorKind: null, progress: null },
      onTranslate,
    });
    const ball = el.querySelector('.ball') as HTMLButtonElement;

    ball.dispatchEvent(
      trusted(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 })),
    );
    ball.dispatchEvent(
      trusted(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 })),
    );

    expect(onTranslate).not.toHaveBeenCalled();
  });

  it('invokes onRestore when the primary button is clicked while translated', () => {
    const onRestore = vi.fn();
    const { el } = mount({
      state: { pageState: 'translated', busy: false, errorMessage: null, errorKind: null, progress: null },
      onRestore,
    });
    (el.querySelector('.primary') as HTMLButtonElement).dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true })),
    );
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('invokes onTranslate with the current target language when the primary button is clicked while original', () => {
    const onTranslate = vi.fn();
    const { el } = mount({ onTranslate });
    (el.querySelector('.primary') as HTMLButtonElement).dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true })),
    );
    expect(onTranslate).toHaveBeenCalledWith('es');
  });

  it('shows a real error instead of the normal "Translated" success, even in the translated state', () => {
    const { el } = mount({
      state: { pageState: 'translated', busy: false, errorMessage: 'HTTP 429', errorKind: 'provider', progress: null },
    });
    expect(el.querySelector('.htitle')?.textContent).toBe('Translation failed');
    expect(el.querySelector('.errorText')?.textContent).toBe('HTTP 429');
    expect(el.querySelector('.primary')?.textContent).not.toBe('Show original');
  });

  it("the error state's primary button retries via onTranslate, not onRestore", () => {
    const onTranslate = vi.fn();
    const onRestore = vi.fn();
    const { el } = mount({
      state: { pageState: 'translated', busy: false, errorMessage: 'HTTP 429', errorKind: 'provider', progress: null },
      onTranslate,
      onRestore,
    });
    expect(el.querySelector('.primary')?.textContent).toBe('Retry');
    (el.querySelector('.primary') as HTMLButtonElement).dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true })),
    );
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('shows a distinct "Offline" state — not the generic "Translation failed" — and a disabled, non-retry button', () => {
    const { el } = mount({
      state: {
        pageState: 'translated',
        busy: false,
        errorMessage: 'Offline — translation will resume automatically once your connection is back.',
        errorKind: 'offline',
        progress: null,
      },
    });
    expect(el.querySelector('.htitle')?.textContent).toBe('Offline');
    expect(el.querySelector('.htitle')?.textContent).not.toBe('Translation failed');
    const primary = el.querySelector('.primary') as HTMLButtonElement;
    expect(primary.textContent).toBe('Waiting for connection…');
    expect(primary.textContent).not.toBe('Retry');
    expect(primary.disabled).toBe(true);
    // The offline banner text is redundant with the head title/primary
    // label above it (both already say "offline") — suppressed, unlike a
    // real provider error, which still shows its message in .errorText.
    expect(el.querySelector('.errorText')).toBeNull();
  });

  it('clicking the primary button while offline does nothing (belt-and-braces, on top of the disabled attribute)', () => {
    const onTranslate = vi.fn();
    const onRestore = vi.fn();
    const { el } = mount({
      state: { pageState: 'translated', busy: false, errorMessage: 'offline', errorKind: 'offline', progress: null },
      onTranslate,
      onRestore,
    });
    (el.querySelector('.primary') as HTMLButtonElement).dispatchEvent(
      trusted(new MouseEvent('click', { bubbles: true })),
    );
    expect(onTranslate).not.toHaveBeenCalled();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('invokes onClose when the Hide chip is clicked', () => {
    const onClose = vi.fn();
    const { el } = mount({ onClose });
    const hideChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Hide'));
    (hideChip as HTMLElement).dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
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
    (alwaysChip as HTMLElement).dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    expect(onTranslate).toHaveBeenCalledWith('es');
  });

  it('ArrowDown on the ball opens the panel and moves focus into it, real gap: the panel had no keyboard-open path at all (hover/long-press only)', () => {
    const { el } = mount();
    const ball = el.querySelector('.ball') as HTMLButtonElement;
    const panel = el.querySelector('.panel') as HTMLElement;
    expect(panel.classList.contains('pinned')).toBe(false);

    ball.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));

    expect(panel.classList.contains('pinned')).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
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
    toSelect.dispatchEvent(trusted(new Event('change', { bubbles: true })));
    expect(onTranslate).toHaveBeenCalledWith('ja');
  });

  describe('rejects synthetic (page-dispatched) events on every privileged handler — security fix, round-4 audit', () => {
    // The bubble mounts into an open shadow root at a fixed, guessable id
    // (`prism-bubble-host`), and this component holds no auth/origin check
    // of its own — any web page can get a reference to these exact
    // elements via `document.getElementById('prism-bubble-host').shadowRoot`
    // and dispatch events at them. A real user click/keypress always has
    // `isTrusted: true`; only a script-dispatched event does not — proven
    // live this session (the bubble was driven this exact way from
    // page-context JS during an unrelated investigation, and it worked).
    // These tests use a bare, unmarked event (no `trusted()` wrapper) to
    // simulate exactly what an attacker page would dispatch.

    it('a synthetic click on the primary button does not call onTranslate/onRestore', () => {
      const onTranslate = vi.fn();
      const onRestore = vi.fn();
      const { el } = mount({ onTranslate, onRestore });
      (el.querySelector('.primary') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onTranslate).not.toHaveBeenCalled();
      expect(onRestore).not.toHaveBeenCalled();
    });

    it('a synthetic click on the Always chip does not persist alwaysTranslateSites or trigger a translate', async () => {
      await configStore.set('alwaysTranslateSites', []);
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const alwaysChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Always'));
      (alwaysChip as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onTranslate).not.toHaveBeenCalled();
      expect(configStore.get('alwaysTranslateSites')).toEqual([]);
    });

    it('a synthetic click on the Hide chip does not persist bubbleByHost or call onClose', async () => {
      await configStore.set('bubbleByHost', {});
      const onClose = vi.fn();
      const { el } = mount({ onClose });
      const hideChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Hide'));
      (hideChip as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onClose).not.toHaveBeenCalled();
      expect(configStore.get('bubbleByHost')).toEqual({});
    });

    it('a synthetic change on the To select does not persist targetLanguage or call onTranslate', async () => {
      await configStore.set('targetLanguage', 'es');
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const toSelect = el.querySelectorAll('.selrow select')[1] as HTMLSelectElement;
      toSelect.value = 'ja';
      toSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(onTranslate).not.toHaveBeenCalled();
      expect(configStore.get('targetLanguage')).toBe('es');
    });

    it('a synthetic pointerdown+pointerup on the ball does not toggle translate', () => {
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      ball.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 }));
      ball.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 }));
      expect(onTranslate).not.toHaveBeenCalled();
    });

    it('a synthetic Enter keydown on the ball does not toggle translate', () => {
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      ball.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(onTranslate).not.toHaveBeenCalled();
    });
  });
});
