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
        originalLanguage: 'und',
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
      state: {
        pageState: 'translated',
        busy: false,
        errorMessage: null,
        errorKind: null,
        progress: null,
        originalLanguage: 'und',
      },
    });
    expect(el.querySelector('.primary')?.textContent).toBe('Show original');
  });

  it('disables the primary button and shows a busy label while busy', () => {
    // pageState:'translated' + busy:true is what an active RE-translate
    // looks like, not a restore in progress — see mountBubble.test.ts's
    // matching test for the full explanation.
    const { el } = mount({
      state: {
        pageState: 'translated',
        busy: true,
        errorMessage: null,
        errorKind: null,
        progress: null,
        originalLanguage: 'und',
      },
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
      state: {
        pageState: 'original',
        busy: true,
        errorMessage: null,
        errorKind: null,
        progress: null,
        originalLanguage: 'und',
      },
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
      state: {
        pageState: 'translated',
        busy: false,
        errorMessage: null,
        errorKind: null,
        progress: null,
        originalLanguage: 'und',
      },
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
      state: {
        pageState: 'translated',
        busy: false,
        errorMessage: 'HTTP 429',
        errorKind: 'provider',
        progress: null,
        originalLanguage: 'und',
      },
    });
    expect(el.querySelector('.htitle')?.textContent).toBe('Translation failed');
    expect(el.querySelector('.errorText')?.textContent).toBe('HTTP 429');
    expect(el.querySelector('.primary')?.textContent).not.toBe('Show original');
  });

  it("the error state's primary button retries via onTranslate, not onRestore", () => {
    const onTranslate = vi.fn();
    const onRestore = vi.fn();
    const { el } = mount({
      state: {
        pageState: 'translated',
        busy: false,
        errorMessage: 'HTTP 429',
        errorKind: 'provider',
        progress: null,
        originalLanguage: 'und',
      },
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
        originalLanguage: 'und',
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
      state: {
        pageState: 'translated',
        busy: false,
        errorMessage: 'offline',
        errorKind: 'offline',
        progress: null,
        originalLanguage: 'und',
      },
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

  describe('accessibility — UI audit', () => {
    function stateOf(overrides: Record<string, unknown> = {}) {
      return {
        pageState: 'original' as const,
        busy: false,
        errorMessage: null as string | null,
        errorKind: null as 'offline' | 'provider' | null,
        progress: null as number | null,
        originalLanguage: 'und',
        ...overrides,
      };
    }

    it('gives every panel select an accessible name — the From/To/Service captions were sibling spans, so a screen reader heard three unnamed pop-up buttons (the popup and options page already label theirs)', () => {
      const { el } = mount();
      // Each select sits inside a <label>, whose caption is its accessible name.
      const names = Array.from(el.querySelectorAll('select')).map(
        (select) => select.closest('label')?.querySelector('.sellbl')?.textContent,
      );
      expect(names).toEqual(['From', 'To', 'Service']);
    });

    it("names the ball after what clicking it will actually do, not always 'Translate this page'", () => {
      const label = (state: ReturnType<typeof stateOf>) => {
        const { el } = mount({ state });
        const value = el.querySelector('.ball')?.getAttribute('aria-label');
        dispose?.();
        container?.remove();
        return value;
      };
      expect(label(stateOf())).toBe('Translate this page');
      expect(label(stateOf({ pageState: 'translated' }))).toBe('Show original');
      expect(label(stateOf({ errorMessage: 'Provider down', errorKind: 'provider' }))).toBe('Retry translation');
      expect(label(stateOf({ errorMessage: 'You are offline', errorKind: 'offline' }))).toBe(
        'Offline — waiting for connection',
      );
      expect(label(stateOf({ busy: true }))).toBe('Translating…');
    });

    it('announces status changes through a live region that sits OUTSIDE the panel — the panel is visibility:hidden most of the time, and screen readers do not announce content in hidden regions', () => {
      const { el } = mount({ state: stateOf({ pageState: 'translated' }) });
      const live = el.querySelector('[role="status"]');
      expect(live).not.toBeNull();
      expect(live?.closest('.panel')).toBeNull();
      expect(live?.textContent).toBe('Page translated');
    });

    it('exposes the Always chip as a toggle with its real state, not just a colour change', async () => {
      const { el } = mount();
      const always = Array.from(el.querySelectorAll('.chip')).find((c) => c.textContent?.includes('Always'));
      expect(always?.getAttribute('aria-pressed')).toBe('false');

      await configStore.set('alwaysTranslateSites', ['example.com']);

      expect(always?.getAttribute('aria-pressed')).toBe('true');
    });

    it('closes the panel on Escape from INSIDE it and returns focus to the ball — the key handler used to live on the ball only, so once ArrowDown moved focus into the panel, Escape did nothing', () => {
      const { el } = mount();
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      const panel = el.querySelector('.panel') as HTMLElement;
      ball.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
      expect(panel.classList.contains('pinned')).toBe(true);
      const inside = document.activeElement as HTMLElement;
      expect(panel.contains(inside)).toBe(true);

      inside.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

      expect(panel.classList.contains('pinned')).toBe(false);
      expect(document.activeElement).toBe(ball);
    });

    it('unpins the panel when keyboard focus leaves the bubble entirely, instead of leaving it open until a pointer click somewhere', () => {
      const { el } = mount();
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      const panel = el.querySelector('.panel') as HTMLElement;
      const outside = document.createElement('button');
      document.body.append(outside);
      ball.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
      expect(panel.classList.contains('pinned')).toBe(true);

      outside.focus();

      expect(panel.classList.contains('pinned')).toBe(false);
      outside.remove();
    });
  });

  describe('layout work on viewport changes — UI audit', () => {
    /** Counts reads of the panel's size — the forced layout read positionPanelNow() does. */
    function countPanelMeasurements(panel: HTMLElement): { reads: number } {
      const counter = { reads: 0 };
      Object.defineProperty(panel, 'offsetWidth', {
        configurable: true,
        get() {
          counter.reads++;
          return 296;
        },
      });
      return counter;
    }
    const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    it('does not measure the panel on viewport changes while it is closed — it is hidden almost all the time, and gets re-measured the moment it opens anyway', async () => {
      const { el } = mount();
      const counter = countPanelMeasurements(el.querySelector('.panel') as HTMLElement);

      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
      await nextFrame();

      expect(counter.reads).toBe(0);
    });

    it('coalesces a burst of viewport events into one update per frame while the panel IS open', async () => {
      const { el } = mount();
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      const panel = el.querySelector('.panel') as HTMLElement;
      ball.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
      await nextFrame();
      const counter = countPanelMeasurements(panel);

      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
      await nextFrame();

      expect(counter.reads).toBe(1);
    });
  });

  describe('provider setup — UI audit', () => {
    beforeEach(async () => {
      await configStore.set('googleCloudTranslateApiKey', '');
      await configStore.set('llmBaseUrl', '');
      await configStore.set('llmApiKey', '');
      await configStore.set('llmModel', '');
    });

    function serviceSelect(el: HTMLElement) {
      return el.querySelectorAll('.selrow select')[2] as HTMLSelectElement;
    }

    it('marks providers that still need setup, and only those', () => {
      const { el } = mount();
      const labels = Array.from(serviceSelect(el).options).map((o) => [o.value, o.textContent]);
      expect(labels.find(([id]) => id === 'google')?.[1]).not.toMatch(/needs setup/);
      expect(labels.find(([id]) => id === 'googleCloudTranslate')?.[1]).toMatch(/needs setup$/);
    });

    it('clears the mark live once the missing setting is filled in', async () => {
      const { el } = mount();
      await configStore.set('googleCloudTranslateApiKey', 'a-real-key');
      const cloud = Array.from(serviceSelect(el).options).find((o) => o.value === 'googleCloudTranslate');
      expect(cloud?.textContent).not.toMatch(/needs setup/);
    });

    it('does not retranslate into a failure when an unconfigured provider is picked — it used to be accepted silently and fail on the next translate', () => {
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const select = serviceSelect(el);
      select.value = 'googleCloudTranslate';
      select.dispatchEvent(trusted(new Event('change', { bubbles: true })));
      expect(onTranslate).not.toHaveBeenCalled();
    });

    it('still retranslates right away for a provider that is ready', async () => {
      await configStore.set('googleCloudTranslateApiKey', 'a-real-key');
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const select = serviceSelect(el);
      select.value = 'googleCloudTranslate';
      select.dispatchEvent(trusted(new Event('change', { bubbles: true })));
      expect(onTranslate).toHaveBeenCalledTimes(1);
    });
  });

  describe('translation direction — UI audit', () => {
    const translatedFrom = (originalLanguage: string) => ({
      pageState: 'translated' as const,
      busy: false,
      errorMessage: null,
      errorKind: null,
      progress: null,
      originalLanguage,
    });

    it('titles a translated page with where it went — "Page translated" said nothing about which way', () => {
      const { el } = mount({ state: translatedFrom('vi') });
      expect(el.querySelector('.htitle')?.textContent).toBe('Vietnamese → Spanish');
    });

    it('uses the source the user forced with the From picker — that is what the page was actually translated from', async () => {
      await configStore.set('sourceLanguageByHost', { 'example.com': 'zh' });
      const { el } = mount({ state: translatedFrom('vi') });
      expect(el.querySelector('.htitle')?.textContent).toBe('Chinese → Spanish');
    });

    it('falls back to the plain title while the page language is still unknown', () => {
      const { el } = mount({ state: translatedFrom('und') });
      expect(el.querySelector('.htitle')?.textContent).toBe('Page translated');
    });
  });
});
