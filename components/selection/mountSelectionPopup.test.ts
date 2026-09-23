// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PieceOutcome, Translator } from '../../src/engine/translator';
import { ok } from '../../src/shared/result';
import { trusted } from '../../tests/trustedEvent';
import { mountSelectionPopup } from './mountSelectionPopup';
import { SelectionPopup } from './SelectionPopup';

// Wrapped (behaviour unchanged) so a test can count how many times the view
// is actually rendered — the direct measure of the render-once fix. A DOM
// mutation count can't see it: re-rendering a HIDDEN popup rebuilds an empty
// tree, which is real wasted work but changes nothing in the DOM.
vi.mock('./SelectionPopup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SelectionPopup')>();
  return { ...actual, SelectionPopup: vi.fn(actual.SelectionPopup) };
});

/** Comfortably past mountSelectionPopup's keyup debounce. */
const KEYUP_SETTLE_MS = 250;

function shadowRoot(): ShadowRoot | null {
  return document.getElementById('prism-selection-popup-host')?.shadowRoot ?? null;
}

function fakeSelectionAt(text: string, rect: { top: number; left: number; bottom: number; right: number }): Selection {
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () =>
      ({
        getBoundingClientRect: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
      }) as unknown as Range,
  } as unknown as Selection;
}

function fakeSelection(text: string): Selection {
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    getRangeAt: () =>
      ({
        getBoundingClientRect: () => ({ width: 40, height: 12, top: 100, left: 50, bottom: 112, right: 90 }),
      }) as unknown as Range,
  } as unknown as Selection;
}

/**
 * `browser.i18n.detectLanguage`'s type is an overloaded
 * (Promise-returning / callback-returning-void) signature from
 * webextension-polyfill's types — `vi.spyOn` resolves to the callback
 * overload's `void` return type in that situation, so `mockResolvedValue`/
 * `mockRejectedValue` need a cast to accept a real detection result. Same
 * pattern as `originalLanguageTracker.test.ts`'s `spyOnDetectLanguage`.
 */
function spyOnDetectLanguage() {
  return vi.spyOn(browser.i18n, 'detectLanguage') as unknown as ReturnType<
    typeof vi.fn<() => Promise<{ isReliable: boolean; languages: Array<{ language: string; percentage: number }> }>>
  >;
}

function uppercaseTranslator(): Translator {
  return {
    async translateBatch(request) {
      return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
    },
  };
}

describe('mountSelectionPopup', () => {
  afterEach(() => {
    document.getElementById('prism-selection-popup-host')?.remove();
    vi.restoreAllMocks();
  });

  it('shows the trigger button after a real text selection', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0)); // language detection is now always awaited, see selectedTextLanguage's doc comment

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('shows the trigger button after a keyboard-driven selection (Shift+Arrow), real gap: the trigger was mouse-only', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
    // Keyboard-driven updates are debounced (see KEYUP_DEBOUNCE_MS) — wait past it.
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('does not tear down and rebuild its view on every keystroke — real perf bug this closed, found via a UI audit: keyup is listened for on the WHOLE document, and every one used to end in a full dispose() + render() of the popup, including while typing into any form field on any site, where the selection is collapsed and the popup was already hidden', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const triggerBefore = shadowRoot()?.querySelector('.trigger');
    expect(triggerBefore).not.toBeNull();

    // Same selection, several keystrokes: nothing about the view changed,
    // so the SAME DOM node must survive. A re-render replaces it.
    for (let i = 0; i < 4; i++) {
      document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })));
    }
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(shadowRoot()?.querySelector('.trigger')).toBe(triggerBefore);
    controller.destroy();
  });

  it('renders its view ONCE, however much the user types elsewhere on the page — the realistic case: typing into a form field, with no selection and the popup already hidden, used to rebuild it per keystroke', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    vi.mocked(SelectionPopup).mockClear();
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    for (let i = 0; i < 20; i++) {
      document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'a', bubbles: true })));
    }
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(SelectionPopup).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it('detects the selection language once for a rapid run of selection-extending keys, not once per key', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello world'));
    const detect = spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'en', percentage: 100 }],
    });
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    // Shift+ArrowRight held down across a word — one keyup per character.
    for (let i = 0; i < 6; i++) {
      document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
    }
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(detect).toHaveBeenCalledTimes(1);
    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('reads a selection from inside a shadow root, real gap: window.getSelection() never sees into shadow DOM, real bug: highlighting text inside a sealed comment widget did nothing', async () => {
    // happy-dom doesn't implement the non-standard ShadowRoot.getSelection()
    // (documented in resolveActiveSelection's own comment) — mock it
    // directly on a real shadow root, and stub the event's composedPath()
    // since happy-dom's own shadow-crossing event path isn't reliable for
    // this either. window.getSelection() is deliberately left returning
    // nothing selected, so a pass here can only be explained by the
    // shadow-root path actually being used.
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const innerShadow = host.attachShadow({ mode: 'open' });
    const shadowSelection = fakeSelection('shadow text');
    (innerShadow as unknown as { getSelection(): Selection }).getSelection = () => shadowSelection;

    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    const event = trusted(new MouseEvent('mouseup', { bubbles: true }));
    Object.defineProperty(event, 'composedPath', { value: () => [host] });
    document.dispatchEvent(event);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
    host.remove();
  });

  it('hides the trigger when there is no active selection', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));

    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
    controller.destroy();
  });

  it('translates the selected text and shows the result when the trigger is clicked', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('HELLO');
    controller.destroy();
  });

  it('shows an error message when the translator returns an error', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const failingTranslator: Translator = {
      async translateBatch(request) {
        return request.pieces.map(() => ({ ok: false, error: { kind: 'network', message: 'boom' } }));
      },
    };
    const controller = mountSelectionPopup({
      translator: failingTranslator,
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement | undefined;
    trigger?.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.errorText')?.textContent).toBe('boom');
    controller.destroy();
  });

  it('discards a stale translation result that resolves after a newer selection was already translated (race condition)', async () => {
    let resolveFirst!: (outcomes: PieceOutcome[]) => void;
    const firstRequestPending = new Promise<PieceOutcome[]>((resolve) => {
      resolveFirst = resolve;
    });
    const translator: Translator = {
      async translateBatch(request) {
        const text = request.pieces[0]?.[0];
        if (text === 'first') return firstRequestPending; // deliberately held open
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const controller = mountSelectionPopup({
      translator,
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    // Select "first" and click translate — starts a request that won't
    // resolve until resolveFirst() is called below.
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('first'));
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstTrigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    firstTrigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Before it resolves, select "second" and translate that instead — this
    // one resolves immediately.
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('second'));
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondTrigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    secondTrigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('SECOND');

    // Now the stale "first" request finally resolves — it must not
    // clobber the "second" result the user is actually looking at.
    resolveFirst([ok(['FIRST'])]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('SECOND');
    controller.destroy();
  });

  it('hides the trigger for a selection with nothing translatable in it, by default', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('123'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));

    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
    controller.destroy();
  });

  it('still shows the trigger for invalid text when getSkipInvalidText explicitly returns false', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('123'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
      getSkipInvalidText: () => false,
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('hides the trigger when getSkipTargetLanguageText is on and the selection is detected as the target language', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hola mundo'));
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'es', percentage: 95 }],
    });
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
      getSkipTargetLanguageText: () => true,
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
    controller.destroy();
  });

  it('still shows the trigger when getSkipTargetLanguageText is on but the detected language does not match target', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello world'));
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'en', percentage: 95 }],
    });
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
      getSkipTargetLanguageText: () => true,
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('still shows the trigger when getSkipTargetLanguageText is on but detection fails/returns "und"', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello world'));
    spyOnDetectLanguage().mockRejectedValue(new Error('boom'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
      getSkipTargetLanguageText: () => true,
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('translates using the detected selection language as the source, not the ambient getSourceLanguage() default', async () => {
    // Real bug this fixed, found via an audit: this popup always sent
    // options.getSourceLanguage() (the global config value, 'auto' by
    // default) as the translate request's source language, even though it
    // already detects the SELECTED TEXT's own language for the
    // skip-target-language-text feature — that detection was being
    // discarded instead of reused. 'auto' can silently fail (echo the
    // input back unchanged) for short non-Latin selections, the same class
    // of bug page translation already fixed (beta.29) by using a
    // freshly-detected language instead of the literal 'auto'.
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('登陸'));
    spyOnDetectLanguage().mockResolvedValue({
      isReliable: true,
      languages: [{ language: 'zh', percentage: 95 }],
    });
    const sourceLanguagesSeen: string[] = [];
    const spyTranslator: Translator = {
      async translateBatch(request) {
        sourceLanguagesSeen.push(request.sourceLanguage);
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const controller = mountSelectionPopup({
      translator: spyTranslator,
      getSourceLanguage: () => 'auto',
      getTargetLanguage: () => 'en',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sourceLanguagesSeen).toEqual(['zh']);
    controller.destroy();
  });

  it('falls back to getSourceLanguage() when detection fails/returns "und"', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello world'));
    spyOnDetectLanguage().mockRejectedValue(new Error('boom'));
    const sourceLanguagesSeen: string[] = [];
    const spyTranslator: Translator = {
      async translateBatch(request) {
        sourceLanguagesSeen.push(request.sourceLanguage);
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const controller = mountSelectionPopup({
      translator: spyTranslator,
      getSourceLanguage: () => 'auto',
      getTargetLanguage: () => 'en',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sourceLanguagesSeen).toEqual(['auto']);
    controller.destroy();
  });

  it("keeps the trigger and the result panel on screen for a selection at the right edge, and flips the panel above a selection near the bottom — real bug this closed, found via a UI audit: both were placed at the selection's bottom-left with no clamping and no height limit, so the 280px panel ran off the side and a long translation grew below the fold", async () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    vi.spyOn(window, 'getSelection').mockReturnValue(
      fakeSelectionAt('hello', { top: vh - 40, bottom: vh - 20, left: vw - 20, right: vw - 5 }),
    );
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    expect(Number.parseFloat(trigger.style.left) + 30).toBeLessThanOrEqual(vw);
    expect(Number.parseFloat(trigger.style.top) + 30).toBeLessThanOrEqual(vh);

    trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const panel = shadowRoot()?.querySelector('.panel') as HTMLElement;
    expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.maxWidth)).toBeLessThanOrEqual(vw);
    // Anchored by its bottom edge above the selection, not pushed below the fold.
    expect(panel.style.top).toBe('');
    expect(panel.style.bottom).not.toBe('');
    controller.destroy();
  });

  it('closes on Escape — previously the only way to dismiss it was a mouse click on its close button', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowRoot()?.querySelector('.panel')).not.toBeNull();

    document.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    expect(shadowRoot()?.querySelector('.panel')).toBeNull();
    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
    controller.destroy();
  });

  it("stays dismissed after Escape even though the Escape key's own keyup follows — real bug, caught by a real-browser check, not by the keydown-only test above: a physical keypress is keydown AND keyup, and the keyup re-read the still-present selection and brought the trigger straight back", async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();

    document.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
    // A later incidental key (Shift, an arrow that doesn't change the
    // selection) must not resurrect it either.
    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
    controller.destroy();
  });

  it('shows again for a NEW selection after being dismissed', async () => {
    const getSelection = vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();

    getSelection.mockReturnValue(fakeSelection('a different sentence'));
    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('shows again when the user deliberately re-selects with the mouse, even the same text', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
  });

  it('announces the translation to screen readers as a polite live region', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = shadowRoot()?.querySelector('.panel');
    expect(panel?.getAttribute('role')).toBe('status');
    expect(panel?.getAttribute('aria-live')).toBe('polite');
    controller.destroy();
  });

  it('destroy() removes the host', () => {
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });
    expect(document.getElementById('prism-selection-popup-host')).not.toBeNull();

    controller.destroy();

    expect(document.getElementById('prism-selection-popup-host')).toBeNull();
  });

  describe('rejects synthetic (page-dispatched) events — security fix, round-4 audit', () => {
    // The trigger mounts into an open shadow root at a fixed, guessable id
    // (`prism-selection-popup-host`), and `onMouseUp`/`onKeyUp` are plain
    // `document`-level listeners with no origin check — a page can fake
    // "the user just finished selecting text" with a bare
    // `document.dispatchEvent(new MouseEvent('mouseup'))` (no shadow access
    // even needed for that part) and then reach the trigger the same way
    // `bubbleShadowRoot()`-style test helpers do, to fire a real translate
    // request through the user's configured (possibly billed) provider
    // with attacker-controlled text. These tests use a bare, unmarked
    // event to simulate exactly that.

    it('a synthetic mouseup does not show the trigger even with a real selection present', () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });

      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

      expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
      controller.destroy();
    });

    it('a synthetic click on the trigger does not call the translator, even if the trigger is already showing from a real selection', async () => {
      const translateBatch = vi.fn(uppercaseTranslator().translateBatch);
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
      const controller = mountSelectionPopup({
        translator: { translateBatch },
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });

      document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;

      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(translateBatch).not.toHaveBeenCalled();
      controller.destroy();
    });
  });
});
