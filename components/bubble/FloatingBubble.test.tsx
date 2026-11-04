// @vitest-environment happy-dom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { configStore } from '../../src/platform/configStore';
import { BALL_SIZE, LONG_PRESS_MS } from '../../src/shared/bubble/bubblePosition';
import { trusted } from '../../tests/trustedEvent';
import { BUBBLE_STYLES } from './bubbleStyles';
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
    dispose?.();
    container?.remove();
    document.getElementById('prism-bubble-undo-host')?.remove();
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
    const { el } = mount({
      state: {
        pageState: 'original',
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

  it('rolls the Always chip back and warns when saving the site list fails, instead of showing a saved state that was never stored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setMany = vi.spyOn(configStore, 'setMany').mockRejectedValue(new Error('quota'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { el } = mount();
      const always = Array.from(el.querySelectorAll('.chip')).find((c) => c.textContent?.includes('Always'));
      always?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(always?.getAttribute('aria-pressed')).toBe('false');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[prism\] /), expect.any(Error));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      setMany.mockRestore();
      warn.mockRestore();
    }
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

    /**
     * Stubs the two inputs isPanelOpen() reads for the hover route: whether the
     * device's primary pointer hovers, and whether the wrap is :hover. A touch
     * browser after a tap is the first false with the second true (sticky hover).
     */
    function stubHover(deviceCanHover: boolean, wrapIsHovered: boolean, wrap: HTMLElement) {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(hover: hover)' && deviceCanHover,
        media: query,
      }));
      const realMatches = wrap.matches.bind(wrap);
      vi.spyOn(wrap, 'matches').mockImplementation((selector: string) =>
        selector === ':hover' ? wrapIsHovered : realMatches(selector),
      );
    }

    it('a stuck :hover on a touch-only device (no hover capability) does not count as open — a tap on the ball used to leave the panel up over the page', async () => {
      const { el } = mount();
      const wrap = el.querySelector('.wrap') as HTMLElement;
      const counter = countPanelMeasurements(el.querySelector('.panel') as HTMLElement);
      stubHover(false, true, wrap);

      window.dispatchEvent(new Event('resize'));
      await nextFrame();

      expect(counter.reads).toBe(0);
    });

    it('a hovered ball on a device that can hover still counts as open, so mouse users keep hover-to-open', async () => {
      const { el } = mount();
      const wrap = el.querySelector('.wrap') as HTMLElement;
      const counter = countPanelMeasurements(el.querySelector('.panel') as HTMLElement);
      stubHover(true, true, wrap);

      window.dispatchEvent(new Event('resize'));
      await nextFrame();

      expect(counter.reads).toBe(1);
    });

    it('the hover-open CSS is gated behind @media (hover: hover) — jsdom cannot evaluate media queries, so the stylesheet itself is asserted', () => {
      expect(BUBBLE_STYLES).toMatch(/@media \(hover: hover\)\s*\{\s*\.wrap:hover \.panel \{/);
      expect(BUBBLE_STYLES).toMatch(/@media \(hover: hover\)\s*\{\s*\.wrap:hover \.ball \{/);
      expect(BUBBLE_STYLES.split('.wrap:hover .panel').length - 1).toBe(1);
      expect(BUBBLE_STYLES.split('.wrap:hover .ball').length - 1).toBe(1);
    });
  });

  describe('touch pickers', () => {
    it('uses 16px picker text on touch screens, so iOS does not zoom the page when a picker is tapped', () => {
      expect(BUBBLE_STYLES).toMatch(/@media \(hover: none\)\s*\{\s*\.sel \{\s*font-size: 16px;/);
    });
  });

  describe('provider setup — UI audit', () => {
    beforeEach(async () => {
      await configStore.set('googleCloudTranslateApiKey', '');
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

    it('does not switch to an unconfigured provider — every page would fail until its key was entered', async () => {
      const { el } = mount();
      const select = serviceSelect(el);
      select.value = 'googleCloudTranslate';
      select.dispatchEvent(trusted(new Event('change', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(configStore.get('pageTranslatorProvider')).toBe('google');
      expect(select.value).toBe('google');
    });

    it("handles a failure to open Settings instead of leaving an unhandled rejection — real bug, caught by CI: the message was fired with `void`, so when nothing answered (here, no background; in real use a restarting service worker or an extension context invalidated by an update) the rejection went unhandled, which on a real page is an 'Uncaught (in promise)' error in the site's own console", async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { el } = mount();
      const select = serviceSelect(el);
      select.value = 'googleCloudTranslate';
      select.dispatchEvent(trusted(new Event('change', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warn).toHaveBeenCalledWith('[prism] could not open Settings', expect.anything());
    });

    it('handles the same failure from the Settings chip', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const { el } = mount();
      const settings = Array.from(el.querySelectorAll('.chip')).find((c) => c.textContent?.includes('Settings'));
      settings?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warn).toHaveBeenCalledWith('[prism] could not open Settings', expect.anything());
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

  describe('ball press gestures', () => {
    it('a short tap without movement toggles translation', () => {
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const ball = el.querySelector('.ball') as HTMLButtonElement;

      ball.dispatchEvent(
        trusted(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 })),
      );
      ball.dispatchEvent(
        trusted(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 })),
      );

      expect(onTranslate).toHaveBeenCalledWith('es');
    });

    it('long-press opens the panel without toggling translation', () => {
      vi.useFakeTimers();
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      const panel = el.querySelector('.panel') as HTMLElement;

      ball.dispatchEvent(
        trusted(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 })),
      );
      vi.advanceTimersByTime(LONG_PRESS_MS + 1);
      ball.dispatchEvent(
        trusted(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 })),
      );

      expect(panel.classList.contains('pinned')).toBe(true);
      expect(onTranslate).not.toHaveBeenCalled();
    });

    it('a tap on the ball while its panel is pinned open closes the panel instead of toggling translation', () => {
      vi.useFakeTimers();
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      const panel = el.querySelector('.panel') as HTMLElement;
      const press = (type: string) =>
        ball.dispatchEvent(
          trusted(
            new PointerEvent(type, {
              bubbles: true,
              composed: true,
              pointerId: 1,
              button: 0,
              clientX: 10,
              clientY: 10,
            }),
          ),
        );

      press('pointerdown');
      vi.advanceTimersByTime(LONG_PRESS_MS + 1);
      press('pointerup');
      expect(panel.classList.contains('pinned')).toBe(true);

      press('pointerdown');
      press('pointerup');

      expect(panel.classList.contains('pinned')).toBe(false);
      expect(onTranslate).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('right-click does not toggle translation', () => {
      const onTranslate = vi.fn();
      const { el } = mount({ onTranslate });
      const ball = el.querySelector('.ball') as HTMLButtonElement;

      ball.dispatchEvent(
        trusted(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 2, clientX: 10, clientY: 10 })),
      );
      ball.dispatchEvent(
        trusted(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 2, clientX: 10, clientY: 10 })),
      );

      expect(onTranslate).not.toHaveBeenCalled();
    });
  });
  describe('touch use on a phone', () => {
    function press(ball: HTMLElement, type: string) {
      ball.dispatchEvent(
        trusted(
          new PointerEvent(type, { bubbles: true, composed: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }),
        ),
      );
    }
    function pinByLongPress(el: HTMLElement) {
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      press(ball, 'pointerdown');
      vi.advanceTimersByTime(LONG_PRESS_MS + 1);
      press(ball, 'pointerup');
      return el.querySelector('.panel') as HTMLElement;
    }
    /** What a finger tap on the page sends, in order. */
    function tapPage(target: HTMLElement) {
      const opts = { bubbles: true, composed: true, cancelable: true, pointerId: 2, button: 0 };
      target.dispatchEvent(trusted(new PointerEvent('pointerdown', opts)));
      target.dispatchEvent(trusted(new PointerEvent('pointerup', opts)));
      target.dispatchEvent(trusted(new MouseEvent('mousedown', opts)));
      target.dispatchEvent(trusted(new MouseEvent('mouseup', opts)));
      target.dispatchEvent(trusted(new MouseEvent('click', opts)));
    }
    function pageListener(types: string[]) {
      const seen: string[] = [];
      const record = (e: Event) => seen.push(e.type);
      for (const type of types) document.body.addEventListener(type, record);
      return {
        seen,
        remove: () => {
          for (const type of types) document.body.removeEventListener(type, record);
        },
      };
    }

    it('a tap outside that closes the pinned panel does not reach the page, so a reader site does not also turn the page', () => {
      vi.useFakeTimers();
      const { el } = mount();
      const panel = pinByLongPress(el);
      expect(panel.classList.contains('pinned')).toBe(true);
      const outside = document.createElement('p');
      document.body.append(outside);
      const page = pageListener(['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click']);

      tapPage(outside);

      expect(panel.classList.contains('pinned')).toBe(false);
      expect(page.seen).toEqual([]);
      page.remove();
      outside.remove();
    });

    it('only that first tap is swallowed: the next outside tap reaches the page', () => {
      vi.useFakeTimers();
      const { el } = mount();
      pinByLongPress(el);
      const outside = document.createElement('p');
      document.body.append(outside);
      const page = pageListener(['click']);

      tapPage(outside);
      tapPage(outside);

      expect(page.seen).toEqual(['click']);
      page.remove();
      outside.remove();
    });

    it('a closing gesture that never becomes a click (a scroll) stops swallowing once it ends', () => {
      vi.useFakeTimers();
      const { el } = mount();
      pinByLongPress(el);
      const outside = document.createElement('p');
      document.body.append(outside);
      const opts = { bubbles: true, composed: true, pointerId: 2, button: 0 };
      outside.dispatchEvent(trusted(new PointerEvent('pointerdown', opts)));
      outside.dispatchEvent(trusted(new PointerEvent('pointercancel', opts)));
      vi.advanceTimersByTime(2000);
      const page = pageListener(['click']);

      outside.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, cancelable: true })));

      expect(page.seen).toEqual(['click']);
      page.remove();
      outside.remove();
    });

    it('an outside tap with the panel closed reaches the page untouched', () => {
      mount();
      const outside = document.createElement('p');
      document.body.append(outside);
      const page = pageListener(['pointerdown', 'click']);

      tapPage(outside);

      expect(page.seen).toEqual(['pointerdown', 'click']);
      page.remove();
      outside.remove();
    });

    it("a tap on the ball doesn't reach the page as a click either", () => {
      const { el } = mount();
      const page = pageListener(['click']);

      (el.querySelector('.ball') as HTMLElement).dispatchEvent(
        trusted(new MouseEvent('click', { bubbles: true, composed: true })),
      );

      expect(page.seen).toEqual([]);
      page.remove();
    });

    function undoToast(): ShadowRoot | null {
      return document.getElementById('prism-bubble-undo-host')?.shadowRoot ?? null;
    }
    function undoButton(): HTMLButtonElement {
      const button = undoToast()?.querySelector<HTMLButtonElement>('button.undo');
      if (!button) throw new Error('no Undo button');
      return button;
    }
    function clickHide(el: HTMLElement) {
      const hideChip = Array.from(el.querySelectorAll('.chip')).find((chip) => chip.textContent?.includes('Hide'));
      (hideChip as HTMLElement).dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
    }

    it('Hide shows an undo toast, and Undo puts the setting back', async () => {
      await configStore.set('bubbleByHost', { 'other.org': false });
      const { el } = mount();

      clickHide(el);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(configStore.get('bubbleByHost')).toEqual({ 'other.org': false, 'example.com': false });
      const toast = undoToast();
      expect(toast?.querySelector('.toast')?.textContent).toContain('Bubble hidden on this site');
      const undo = undoButton();
      expect(undo.textContent).toBe('Undo');

      undo.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(configStore.get('bubbleByHost')).toEqual({ 'other.org': false });
      expect(undoToast()).toBeNull();
    });

    it("Undo restores a site's earlier 'show' override rather than dropping it", async () => {
      await configStore.set('bubbleByHost', { 'example.com': true });
      const { el } = mount();

      clickHide(el);
      undoButton().dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(configStore.get('bubbleByHost')).toEqual({ 'example.com': true });
    });

    it('the undo toast goes away by itself after about 5 seconds', () => {
      vi.useFakeTimers();
      const { el } = mount();
      clickHide(el);
      expect(undoToast()).not.toBeNull();

      vi.advanceTimersByTime(4900);
      expect(undoToast()).not.toBeNull();
      vi.advanceTimersByTime(200);
      expect(undoToast()).toBeNull();
    });

    it('a synthetic click on Undo does nothing', async () => {
      const { el } = mount();
      clickHide(el);
      await new Promise((resolve) => setTimeout(resolve, 0));

      undoButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(configStore.get('bubbleByHost')).toEqual({ 'example.com': false });
    });

    it('the ball is at least 44×44', () => {
      const { el } = mount();
      const wrap = el.querySelector('.wrap') as HTMLElement;
      expect(wrap.style.width).toBe(`${BALL_SIZE}px`);
      expect(wrap.style.height).toBe(`${BALL_SIZE}px`);
      expect(BUBBLE_STYLES).toMatch(/\.wrap \{[^}]*width: 44px; height: 44px;/);
    });

    it('fades while the page scrolls, and comes back when the ball is touched', () => {
      const { el } = mount();
      const wrap = el.querySelector('.wrap') as HTMLElement;
      expect(wrap.classList.contains('dim')).toBe(false);

      document.body.dispatchEvent(new Event('touchmove', { bubbles: true, composed: true }));
      expect(wrap.classList.contains('dim')).toBe(true);

      press(el.querySelector('.ball') as HTMLElement, 'pointerdown');
      expect(wrap.classList.contains('dim')).toBe(false);
      expect(BUBBLE_STYLES).toMatch(/\.wrap\.dim \.ball \{ opacity: \.2/);
    });

    it('does not fade for a scroll the user did not make (translated text reflowing the page), or for dragging the ball', () => {
      const { el } = mount();
      const wrap = el.querySelector('.wrap') as HTMLElement;

      document.dispatchEvent(new Event('scroll'));
      (el.querySelector('.ball') as HTMLElement).dispatchEvent(
        new Event('touchmove', { bubbles: true, composed: true }),
      );

      expect(wrap.classList.contains('dim')).toBe(false);
    });

    it('a long-press does not start an iOS text selection or callout on the ball', () => {
      const ballRule = BUBBLE_STYLES.match(/\n {2}\.ball \{([^}]*)\}/)?.[1] ?? '';
      expect(ballRule).toContain('-webkit-touch-callout: none');
      expect(ballRule).toContain('-webkit-user-select: none');
      expect(ballRule).toContain('user-select: none');
    });

    it('a tap while busy pulses the ball instead of doing nothing visible', () => {
      vi.useFakeTimers();
      const { el } = mount({
        state: {
          pageState: 'original',
          busy: true,
          errorMessage: null,
          errorKind: null,
          progress: null,
          originalLanguage: 'und',
        },
      });
      const ball = el.querySelector('.ball') as HTMLElement;

      press(ball, 'pointerdown');
      press(ball, 'pointerup');

      expect(ball.classList.contains('nudge')).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(ball.classList.contains('nudge')).toBe(false);
    });

    it('a tap when not busy does not pulse', () => {
      const { el } = mount();
      const ball = el.querySelector('.ball') as HTMLElement;
      press(ball, 'pointerdown');
      press(ball, 'pointerup');
      expect(ball.classList.contains('nudge')).toBe(false);
    });

    it('stays at the visible right edge, at its normal on-screen size, while the page is pinch-zoomed', async () => {
      await configStore.set('bubblePosition', { side: 'right', yFrac: 0.5 });
      const pinchZoomed = {
        width: 187.5,
        height: 350,
        offsetLeft: 120,
        offsetTop: 260,
        scale: 2,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const real = Object.getOwnPropertyDescriptor(window, 'visualViewport');
      Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => pinchZoomed });
      onTestFinished(() => {
        if (real) Object.defineProperty(window, 'visualViewport', real);
        else delete (window as { visualViewport?: unknown }).visualViewport;
      });
      const { el } = mount();
      const wrap = el.querySelector('.wrap') as HTMLElement;
      const size = BALL_SIZE / 2;

      expect(wrap.style.width).toBe(`${size}px`);
      // Docked right in the visible area, then moved to where that area sits on the page.
      expect(Number.parseFloat(wrap.style.left)).toBeCloseTo(120 + 187.5 - size - 6);
      const top = Number.parseFloat(wrap.style.top);
      expect(top).toBeGreaterThanOrEqual(260);
      expect(top + size).toBeLessThanOrEqual(260 + 350);
      expect(wrap.classList.contains('right')).toBe(true);
    });

    it('white text on the translated green meets 4.5:1', () => {
      const rule = BUBBLE_STYLES.match(/\.wrap\.translated \{([^}]*)\}/)?.[1] ?? '';
      const colors = [...rule.matchAll(/#([0-9a-f]{6})/gi)].map((m) => m[1]);
      expect(colors.length).toBe(2);
      const luminance = (hex: string) => {
        const channel = (i: number) => {
          const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
      };
      for (const hex of colors) expect(1.05 / (luminance(hex ?? '') + 0.05)).toBeGreaterThanOrEqual(4.5);
    });

    it('white text on the default accent colours meets 4.5:1', () => {
      const luminance = (hex: string) => {
        const channel = (i: number) => {
          const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
      };
      for (const name of ['accent', 'accent2']) {
        const hex = BUBBLE_STYLES.match(new RegExp(`--${name}: #([0-9a-f]{6})`, 'i'))?.[1] ?? '';
        expect(1.05 / (luminance(hex) + 0.05), name).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  describe('keyboard, busy pages and removal', () => {
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
    function press(ball: HTMLElement, type: string) {
      ball.dispatchEvent(
        trusted(
          new PointerEvent(type, { bubbles: true, composed: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }),
        ),
      );
    }
    function listenOnPage(types: string[]) {
      const seen: string[] = [];
      const record = (e: Event) => seen.push(`${e.type}:${(e as KeyboardEvent).key}`);
      for (const type of types) document.addEventListener(type, record);
      onTestFinished(() => {
        for (const type of types) document.removeEventListener(type, record);
      });
      return seen;
    }

    it("keys typed in the bubble don't reach the page's own shortcuts", () => {
      const { el } = mount();
      const seen = listenOnPage(['keydown', 'keyup', 'keypress']);
      const select = el.querySelector('select') as HTMLSelectElement;

      for (const type of ['keydown', 'keypress', 'keyup']) {
        select.dispatchEvent(trusted(new KeyboardEvent(type, { key: 'k', bubbles: true, composed: true })));
      }

      expect(seen).toEqual([]);
    });

    it('ArrowDown and Escape still work in the bubble, without reaching the page', () => {
      const { el } = mount();
      const seen = listenOnPage(['keydown']);
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      const panel = el.querySelector('.panel') as HTMLElement;

      ball.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true })));
      expect(panel.classList.contains('pinned')).toBe(true);
      (document.activeElement as HTMLElement).dispatchEvent(
        trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })),
      );

      expect(panel.classList.contains('pinned')).toBe(false);
      expect(document.activeElement).toBe(ball);
      expect(seen).toEqual([]);
    });

    it('a tap on the ball shows the original while a translated page is still busy (a live feed keeps it busy)', () => {
      const onRestore = vi.fn();
      const { el } = mount({ state: stateOf({ pageState: 'translated', busy: true }), onRestore });
      const ball = el.querySelector('.ball') as HTMLButtonElement;

      press(ball, 'pointerdown');
      press(ball, 'pointerup');

      expect(onRestore).toHaveBeenCalledTimes(1);
      expect(ball.getAttribute('aria-label')).toBe('Show original');
    });

    it("the panel's Show original works while a translated page is still busy", () => {
      const onRestore = vi.fn();
      const { el } = mount({ state: stateOf({ pageState: 'translated', busy: true }), onRestore });
      const primary = el.querySelector('.primary') as HTMLButtonElement;

      expect(primary.disabled).toBe(false);
      expect(primary.textContent).toBe('Show original');
      primary.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true })));

      expect(onRestore).toHaveBeenCalledTimes(1);
    });

    it('ArrowDown moves focus to the first control that can take it when the main button is disabled', () => {
      const { el } = mount({ state: stateOf({ busy: true }) });
      const ball = el.querySelector('.ball') as HTMLButtonElement;

      ball.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));

      expect(document.activeElement).toBe(el.querySelector('select'));
    });

    it('leaves no timers running once it is removed', () => {
      vi.useFakeTimers();
      const frame = vi.fn(() => 1);
      vi.stubGlobal('requestAnimationFrame', frame);
      const { el } = mount();
      const ball = el.querySelector('.ball') as HTMLButtonElement;
      window.dispatchEvent(new Event('orientationchange'));
      press(ball, 'pointerdown');
      press(ball, 'pointerup');

      dispose?.();
      dispose = undefined;

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(1000);
      expect(frame).not.toHaveBeenCalled();
    });

    it('does not announce a menu, and its tooltip says what a click will do', () => {
      const { el } = mount({ state: stateOf({ pageState: 'translated' }) });
      const ball = el.querySelector('.ball') as HTMLButtonElement;

      expect(ball.hasAttribute('aria-haspopup')).toBe(false);
      expect(ball.getAttribute('title')).toMatch(/^Show original/);
    });

    it('sets no class on the bubble that has no style rule', () => {
      const { el } = mount({ state: stateOf({ errorMessage: 'You are offline', errorKind: 'offline' }) });
      const wrap = el.querySelector('.wrap') as HTMLElement;

      // `right` is a placement hook read by the tests, not a styled state.
      for (const name of Array.from(wrap.classList).filter((c) => c !== 'wrap' && c !== 'right')) {
        expect(BUBBLE_STYLES, name).toMatch(new RegExp(`\\.wrap\\.${name}\\b`));
      }
    });
  });
});
