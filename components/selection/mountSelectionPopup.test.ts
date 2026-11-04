// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PieceOutcome, Translator } from '../../src/engine/translator';
import { ok } from '../../src/shared/result';
import { SELECTION_TRIGGER_SIZE } from '../../src/shared/ui/selectionPanelPlacement';
import { TimeoutError } from '../../src/shared/withTimeout';
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
/** Comfortably past mountSelectionPopup's selectionchange settle delay. */
const SELECTIONCHANGE_SETTLE_MS = 500;

function pointerDown(pointerType: 'mouse' | 'touch' | 'pen'): void {
  const event = new MouseEvent('pointerdown', { bubbles: true, composed: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  document.body.dispatchEvent(trusted(event));
}

function pointerUp(pointerType: 'mouse' | 'touch' | 'pen'): void {
  const event = new MouseEvent('pointerup', { bubbles: true, composed: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  document.body.dispatchEvent(trusted(event));
}

function selectionChange(): void {
  document.dispatchEvent(trusted(new Event('selectionchange')));
}

/** A popup element that must be present; throws (failing the test) when it isn't. */
function shown(selector: string): HTMLElement {
  const el = shadowRoot()?.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`${selector} is not shown`);
  return el;
}

const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

function rejectingTranslator(cause: unknown): Translator {
  return {
    translateBatch: () => Promise.reject(cause),
  };
}

async function openPanelFor(text: string, translator: Translator) {
  vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection(text));
  const controller = mountSelectionPopup({ translator, getSourceLanguage: () => 'zh', getTargetLanguage: () => 'en' });
  document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
  trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return controller;
}

function shadowRoot(): ShadowRoot | null {
  return document.getElementById('prism-selection-popup-host')?.shadowRoot ?? null;
}

function fakeSelectionAt(text: string, rect: { top: number; left: number; bottom: number; right: number }): Selection {
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    removeAllRanges: () => {},
    getRangeAt: () =>
      ({
        getBoundingClientRect: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
        getClientRects: () => [{ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }],
      }) as unknown as Range,
  } as unknown as Selection;
}

function fakeSelection(text: string): Selection {
  return {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => text,
    removeAllRanges: () => {},
    getRangeAt: () =>
      ({
        getBoundingClientRect: () => ({ width: 40, height: 12, top: 100, left: 50, bottom: 112, right: 90 }),
        getClientRects: () => [{ width: 40, height: 12, top: 100, left: 50, bottom: 112, right: 90 }],
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

    expect(shadowRoot()?.querySelector('.errorText')?.textContent).toBe("Couldn't reach the translation service.");
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

    const live = shadowRoot()?.querySelector('.panel [role="status"]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('HELLO');
    // Only the message: buttons and the error's own alert sit outside it.
    expect(live?.querySelector('button, [role="alert"]')).toBeNull();
    controller.destroy();
  });

  it('copies the translation, not the original, and confirms it', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
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

    const copy = shadowRoot()?.querySelector('.copy') as HTMLButtonElement;
    expect(copy.textContent).toBe('Copy');
    copy.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).toHaveBeenCalledWith('HELLO');
    expect(copy.textContent).toBe('Copied');
    controller.destroy();
    vi.unstubAllGlobals();
  });

  it('ignores a synthetic Copy click, like the translate button does', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
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

    const copy = shadowRoot()?.querySelector('.copy') as HTMLButtonElement;
    copy.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).not.toHaveBeenCalled();
    controller.destroy();
    vi.unstubAllGlobals();
  });

  it('translates text it is handed directly — the right-click "Translate selection" path — showing the result in the panel', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    controller.translateText('hello world');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('HELLO WORLD');
    controller.destroy();
  });

  it('still translates handed-in text when the selection lives somewhere this frame cannot see (e.g. inside an iframe), placing the panel on screen instead of failing', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(null);
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    controller.translateText('from a frame');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = shadowRoot()?.querySelector('.panel') as HTMLElement;
    expect(panel.querySelector('.result')?.textContent).toBe('FROM A FRAME');
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0);
    controller.destroy();
  });

  it('with autoTrigger off, attaches no selection listeners at all — so the floating button stays off when the user turned it off — but an explicit request still works', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const added = vi.spyOn(document, 'addEventListener');
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
      autoTrigger: false,
    });

    const listened = added.mock.calls.map(([type]) => type);
    expect(listened).not.toContain('mouseup');
    expect(listened).not.toContain('keyup');
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowRoot()?.querySelector('.trigger')).toBeNull();

    controller.translateText('hello');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('HELLO');
    controller.destroy();
  });

  it("isn't superseded by a stray key-up while a right-click translation is still detecting its language — real race, caught driving the built extension: the key-up's debounced re-check bumped the shared request counter, and the in-flight translation silently gave up", async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    spyOnDetectLanguage().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ isReliable: true, languages: [{ language: 'en', percentage: 100 }] }), 300),
        ),
    );
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    controller.translateText('hello');
    // e.g. the key-up of the Menu key that opened the context menu
    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'ContextMenu', bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 450));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('HELLO');
    controller.destroy();
  });

  it("stays open when the right-click text and the page's selection aren't character-for-character identical — the browser's own selectionText normalises whitespace differently from Selection.toString(), which is what let this race through the first fix in a real browser", async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('Good morning,\n my friend.'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    controller.translateText('Good morning, my friend.');
    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('GOOD MORNING, MY FRIEND.');
    controller.destroy();
  });

  it('keeps an open translation open when a key is pressed without changing the selection — it used to close on any keystroke', async () => {
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

    document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

    expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('HELLO');
    controller.destroy();
  });

  describe('touch selection (iPhone): no mouseup or keyup ever fires', () => {
    it('shows the trigger once a touch selection settles', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('修士'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });

      pointerDown('touch');
      selectionChange();
      selectionChange();
      expect(shadowRoot()?.querySelector('.trigger')).toBeNull(); // still settling
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
      controller.destroy();
    });

    it("puts the trigger on the selected line, after its end, clear of iOS's menu above or below it", async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('修士'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });

      pointerDown('touch');
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      const trigger = shadowRoot()?.querySelector('.trigger') as HTMLElement;
      const top = Number.parseFloat(trigger.style.top);
      const left = Number.parseFloat(trigger.style.left);
      // The fake selection's line runs from top 100 to bottom 112 and ends at x 90.
      expect(left).toBeGreaterThanOrEqual(90 + 6);
      expect(top + SELECTION_TRIGGER_SIZE / 2).toBe(106);
      controller.destroy();
    });

    it("clears the page selection when the button is tapped, so iOS's own menu closes off the result", async () => {
      const selection = fakeSelection('修士');
      const removeAllRanges = vi.fn();
      Object.assign(selection, { removeAllRanges });
      vi.spyOn(window, 'getSelection').mockReturnValue(selection);
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });
      pointerDown('touch');
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
      trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(removeAllRanges).toHaveBeenCalled();
      expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('修士');
      controller.destroy();
    });

    it('also works for a pen', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('修士'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });

      pointerDown('pen');
      pointerUp('pen');
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
      controller.destroy();
    });

    it('ignores a selectionchange the page dispatched itself', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('修士'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });

      pointerDown('touch');
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
      controller.destroy();
    });

    it('keeps an open translation open when tapping it clears the page selection', async () => {
      const selection = vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('修士'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });
      pointerDown('touch');
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));
      const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
      trigger.dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot()?.querySelector('.result')?.textContent).toBe('修士');

      selection.mockReturnValue(null);
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      expect(shadowRoot()?.querySelector('.panel')).not.toBeNull();
      controller.destroy();
    });

    it('hides the trigger when a touch clears the selection', async () => {
      const selection = vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('修士'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'zh',
        getTargetLanguage: () => 'en',
      });
      pointerDown('touch');
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));
      expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();

      selection.mockReturnValue(null);
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
      controller.destroy();
    });

    it('does not run a second time for a desktop mouse selection, which mouseup already handles', async () => {
      const detect = spyOnDetectLanguage().mockResolvedValue({
        isReliable: true,
        languages: [{ language: 'en', percentage: 100 }],
      });
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });

      pointerDown('mouse');
      selectionChange(); // a drag fires selectionchange while the button is held
      expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
      pointerUp('mouse');
      document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
      selectionChange();
      await new Promise((resolve) => setTimeout(resolve, SELECTIONCHANGE_SETTLE_MS));

      expect(shadowRoot()?.querySelectorAll('.trigger').length).toBe(1);
      expect(detect).toHaveBeenCalledTimes(1);
      controller.destroy();
    });
  });

  describe('scrolling', () => {
    function movableSelection(text: string, rect: { top: number; bottom: number; left: number; right: number }) {
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

    it('moves the trigger with the selection when the page scrolls', async () => {
      const rect = { top: 300, bottom: 320, left: 50, right: 90 };
      vi.spyOn(window, 'getSelection').mockReturnValue(movableSelection('hello', rect));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });
      document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const before = Number.parseFloat(shown('.trigger').style.top);

      rect.top -= 150;
      rect.bottom -= 150;
      document.dispatchEvent(new Event('scroll'));
      await nextFrame();

      const after = Number.parseFloat(shown('.trigger').style.top);
      expect(after).toBe(before - 150);
      controller.destroy();
    });

    it('moves an open result panel with the selection too, including for scrolling inside a scrollable box', async () => {
      const rect = { top: 300, bottom: 320, left: 50, right: 90 };
      vi.spyOn(window, 'getSelection').mockReturnValue(movableSelection('hello', rect));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });
      document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      shown('.trigger').dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const before = Number.parseFloat(shown('.panel').style.top);

      rect.top -= 100;
      rect.bottom -= 100;
      const box = document.createElement('div');
      document.body.append(box);
      box.dispatchEvent(new Event('scroll')); // element scroll events don't bubble
      await nextFrame();

      const after = Number.parseFloat(shown('.panel').style.top);
      expect(after).toBe(before - 100);
      box.remove();
      controller.destroy();
    });

    it('hides the trigger while its selection is scrolled off screen, and brings it back when it returns', async () => {
      const rect = { top: 300, bottom: 320, left: 50, right: 90 };
      vi.spyOn(window, 'getSelection').mockReturnValue(movableSelection('hello', rect));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });
      document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      rect.top = -200;
      rect.bottom = -180;
      document.dispatchEvent(new Event('scroll'));
      await nextFrame();
      expect(shadowRoot()?.querySelector('.trigger')).toBeNull();

      rect.top = 300;
      rect.bottom = 320;
      document.dispatchEvent(new Event('scroll'));
      await nextFrame();
      expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
      controller.destroy();
    });
  });

  describe('keys pressed inside the popup', () => {
    it("don't reach the page's own shortcuts", async () => {
      const controller = await openPanelFor('hello', uppercaseTranslator());
      const pageKeys = vi.fn();
      document.addEventListener('keydown', pageKeys);
      document.addEventListener('keyup', pageKeys);

      const close = shadowRoot()?.querySelector('.close') as HTMLButtonElement;
      close.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'j', bubbles: true, composed: true })));
      close.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'j', bubbles: true, composed: true })));

      expect(pageKeys).not.toHaveBeenCalled();
      document.removeEventListener('keydown', pageKeys);
      document.removeEventListener('keyup', pageKeys);
      controller.destroy();
    });

    it('Escape inside the popup still closes it, without reaching the page', async () => {
      const controller = await openPanelFor('hello', uppercaseTranslator());
      const pageKeys = vi.fn();
      document.addEventListener('keydown', pageKeys);

      const close = shadowRoot()?.querySelector('.close') as HTMLButtonElement;
      close.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true })));

      expect(shadowRoot()?.querySelector('.panel')).toBeNull();
      expect(pageKeys).not.toHaveBeenCalled();
      document.removeEventListener('keydown', pageKeys);
      controller.destroy();
    });
  });

  describe('failed translations', () => {
    it('stops the spinner and explains when the request itself fails (Prism was updated while the tab was open)', async () => {
      const controller = await openPanelFor('修士', rejectingTranslator(new Error('Extension context invalidated.')));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot()?.querySelector('.spinner')).toBeNull();
      const message = shadowRoot()?.querySelector('.errorText')?.textContent ?? '';
      expect(message).toMatch(/reload the page/i);
      expect(message).not.toMatch(/context invalidated/i);
      controller.destroy();
    });

    it('stops the spinner and says the service is slow when the request times out', async () => {
      const controller = await openPanelFor('修士', rejectingTranslator(new TimeoutError('timed out after 90000ms')));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shadowRoot()?.querySelector('.spinner')).toBeNull();
      expect(shadowRoot()?.querySelector('.errorText')?.textContent).toBe(
        'The translation service is taking too long to answer.',
      );
      controller.destroy();
    });

    it("shows a provider error in plain words, not the provider's raw diagnostic", async () => {
      const translator: Translator = {
        async translateBatch(request) {
          return request.pieces.map(() => ({ ok: false, error: { kind: 'timeout', message: '[google] timed out' } }));
        },
      };
      const controller = await openPanelFor('修士', translator);

      const message = shadowRoot()?.querySelector('.errorText')?.textContent ?? '';
      expect(message).toBe('The translation service is taking too long to answer.');
      controller.destroy();
    });

    it("doesn't promise an automatic retry it won't make", async () => {
      const translator: Translator = {
        async translateBatch(request) {
          return request.pieces.map(() => ({
            ok: false,
            error: { kind: 'http', status: 503, message: '[google] 503' },
          }));
        },
      };
      const controller = await openPanelFor('修士', translator);

      const message = shadowRoot()?.querySelector('.errorText')?.textContent ?? '';
      expect(message).toContain('HTTP 503');
      expect(message).not.toMatch(/retry/i);
      controller.destroy();
    });
  });

  it('places the trigger above the selected line, not over the next one', async () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(
      fakeSelectionAt('hello', { top: 300, bottom: 320, left: 50, right: 90 }),
    );
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });
    document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLElement;
    expect(Number.parseFloat(trigger.style.top) + 30).toBeLessThanOrEqual(300);
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

  describe('dismissing a right-click translation', () => {
    it("stays dismissed after Escape when the browser's right-click text differs in whitespace from the page selection", async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('Good morning,\n my friend.'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });
      controller.translateText('Good morning, my friend.');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(shadowRoot()?.querySelector('.panel')).not.toBeNull();

      document.dispatchEvent(trusted(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));

      expect(shadowRoot()?.querySelector('.panel')).toBeNull();
      expect(shadowRoot()?.querySelector('.trigger')).toBeNull();
      controller.destroy();
    });
  });

  describe('keyboard users', () => {
    async function keyboardSelect(text: string) {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection(text));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });
      document.dispatchEvent(trusted(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, KEYUP_SETTLE_MS));
      return controller;
    }
    function tab(): KeyboardEvent {
      const event = trusted(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      document.body.dispatchEvent(event);
      return event;
    }

    it('Tab after a keyboard selection moves focus to the translate button', async () => {
      const controller = await keyboardSelect('hello');
      const trigger = shown('.trigger');

      const event = tab();

      expect(shadowRoot()?.activeElement).toBe(trigger);
      expect(event.defaultPrevented).toBe(true);
      controller.destroy();
    });

    it('opening the result from the keyboard puts focus in the panel, not on the page', async () => {
      const controller = await keyboardSelect('hello');
      tab();

      shown('.trigger').dispatchEvent(trusted(new MouseEvent('click', { bubbles: true, composed: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(shown('.result').textContent).toBe('HELLO');
      expect(shadowRoot()?.activeElement).toBe(shown('.close'));
      controller.destroy();
    });

    it('leaves Tab alone after a mouse selection', async () => {
      vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
      const controller = mountSelectionPopup({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getTargetLanguage: () => 'es',
      });
      document.dispatchEvent(trusted(new MouseEvent('mouseup', { bubbles: true })));
      await new Promise((resolve) => setTimeout(resolve, 0));
      shown('.trigger');

      const event = tab();

      expect(event.defaultPrevented).toBe(false);
      expect(shadowRoot()?.activeElement ?? null).toBeNull();
      controller.destroy();
    });
  });
});
