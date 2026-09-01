// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PieceOutcome, Translator } from '../../src/engine/translator';
import { ok } from '../../src/shared/result';
import { mountSelectionPopup } from './mountSelectionPopup';

function shadowRoot(): ShadowRoot | null {
  return document.getElementById('prism-selection-popup-host')?.shadowRoot ?? null;
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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

    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

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

    const event = new MouseEvent('mouseup', { bubbles: true });
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.click();
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement | undefined;
    trigger?.click();
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
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const firstTrigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    firstTrigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Before it resolves, select "second" and translate that instead — this
    // one resolves immediately.
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('second'));
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const secondTrigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    secondTrigger.click();
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.click();
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

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement;
    trigger.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sourceLanguagesSeen).toEqual(['auto']);
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
});
