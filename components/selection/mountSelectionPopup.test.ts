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

  it('shows the trigger button after a real text selection', () => {
    vi.spyOn(window, 'getSelection').mockReturnValue(fakeSelection('hello'));
    const controller = mountSelectionPopup({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getTargetLanguage: () => 'es',
    });

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(shadowRoot()?.querySelector('.trigger')).not.toBeNull();
    controller.destroy();
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
    const trigger = shadowRoot()?.querySelector('.trigger') as HTMLButtonElement | undefined;
    trigger?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(shadowRoot()?.querySelector('.errorText')?.textContent).toBe('boom');
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
