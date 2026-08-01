// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../shared/result';
import type { PieceOutcome, Translator } from '../translator';
import { createTitleTranslator, type TitleTranslatorOptions } from './titleTranslator';

const translateBatch = vi.fn<Translator['translateBatch']>();
const translator: Translator = { translateBatch };

function mockTranslateOnce(outcome: PieceOutcome): void {
  translateBatch.mockResolvedValueOnce([outcome]);
}

function setDocumentTitle(text: string): void {
  document.title = text;
}

// catchUp() is deliberately `void`-returning in production (every call site
// fires it and moves on — see translateLoop.ts) rather than something
// callers await, so awaiting it directly only waits one microtask tick, not
// the full async chain it kicks off underneath. A real macrotask boundary
// guarantees every pending microtask — however many levels deep — has
// settled first.
function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// document.head is shared across every test in this file (happy-dom's
// document isn't recreated per test) — a translator whose start() was
// called leaves a live MutationObserver on <head> until restore() is
// called. Without tracking + tearing every one of them down, a later
// test's title mutation fires ALL previous tests' still-active observers
// too, each firing its own independent (and duplicate) translation
// request. newTranslator() below is the only way tests in this file
// should construct one, so cleanup can't be forgotten per-test.
const activeTranslators: ReturnType<typeof createTitleTranslator>[] = [];
function newTranslator(options: Omit<TitleTranslatorOptions, 'translator'>) {
  const t = createTitleTranslator({ translator, ...options });
  activeTranslators.push(t);
  return t;
}

beforeEach(() => {
  translateBatch.mockReset();
  document.title = '';
  // Ensure a clean <title> per test — happy-dom carries document state
  // across tests within the same file otherwise.
  document.querySelectorAll('title').forEach((el) => {
    el.remove();
  });
  const titleEl = document.createElement('title');
  document.head.appendChild(titleEl);
});

afterEach(() => {
  activeTranslators.splice(0).forEach((t) => {
    t.restore();
  });
  vi.restoreAllMocks();
});

describe('createTitleTranslator', () => {
  it('sends the title through the [[title, " "]] two-item batching workaround, not a bare single string', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(translateBatch).toHaveBeenCalledWith({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['Hello World', ' ']],
      dontSortResults: false,
    });
  });

  it('dual-writes the translated title to both document.title and the <title> element', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(document.title).toBe('Hola Mundo');
    expect(document.querySelector('title')?.textContent).toBe('Hola Mundo');
  });

  it('creates a <title> element if the page has none', async () => {
    document.querySelectorAll('title').forEach((el) => {
      el.remove();
    });
    setDocumentTitle('Hello World'); // document.title still works without a <title> element present
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(document.querySelector('title')?.textContent).toBe('Hola Mundo');
  });

  it('does nothing when the page title is empty', async () => {
    setDocumentTitle('');
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('leaves the title untouched when the provider returns the same text back (no real translation)', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hello World', ' '])); // provider echoed it back untranslated
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(document.title).toBe('Hello World');
  });

  it('leaves the title untouched when the request fails', async () => {
    setDocumentTitle('Hello World');
    translateBatch.mockRejectedValueOnce(new Error('network down'));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(document.title).toBe('Hello World');
  });

  it('leaves the title untouched when the outcome is a provider error', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce({ ok: false, error: { kind: 'network', message: 'boom' } });
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.start('es');

    expect(document.title).toBe('Hello World');
  });

  it('restore() writes the original (pre-translation) title back', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });
    await titleTranslator.start('es');
    expect(document.title).toBe('Hola Mundo');

    titleTranslator.restore();

    expect(document.title).toBe('Hello World');
    expect(document.querySelector('title')?.textContent).toBe('Hello World');
  });

  it('caches a translation result and does not re-request for the same source/target/text', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });
    await titleTranslator.start('es');
    expect(translateBatch).toHaveBeenCalledTimes(1);

    // Restore, then translate the exact same title/language pair again —
    // should hit the cache, not send a second request.
    titleTranslator.restore();
    setDocumentTitle('Hello World');
    await titleTranslator.start('es');

    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('Hola Mundo');
  });

  it('catchUp() retranslates when the page JS changed the title since the last translation', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });
    await titleTranslator.start('es');
    expect(document.title).toBe('Hola Mundo');

    // Simulate a site rewriting its own title (SPA chapter switch, a
    // notification counter, ...).
    setDocumentTitle('Chapter 2');
    mockTranslateOnce(ok(['Capítulo 2', ' ']));

    titleTranslator.catchUp();
    await flushAsyncWork();

    expect(translateBatch).toHaveBeenCalledTimes(2);
    expect(document.title).toBe('Capítulo 2');
  });

  it('catchUp() does nothing when the title has not changed since the last translation', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });
    await titleTranslator.start('es');
    translateBatch.mockClear();

    await titleTranslator.catchUp();

    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('catchUp() is a no-op before start() / after restore()', async () => {
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });

    await titleTranslator.catchUp();

    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('does not retranslate while the page is hidden', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    let visible = true;
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => visible });
    await titleTranslator.start('es');
    translateBatch.mockClear();

    visible = false;
    setDocumentTitle('Chapter 2');
    await titleTranslator.catchUp();

    expect(translateBatch).not.toHaveBeenCalled();
  });

  it('a MutationObserver on <head> triggers retranslation when the site rewrites <title> directly (not via document.title)', async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });
    await titleTranslator.start('es');
    translateBatch.mockClear();
    mockTranslateOnce(ok(['Capítulo 2', ' ']));

    const titleEl = document.querySelector('title');
    if (!titleEl) throw new Error('expected a <title> element');
    titleEl.textContent = 'Chapter 2';

    await flushAsyncWork();

    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(document.title).toBe('Capítulo 2');
  });

  it("the observer does not re-trigger on the module's own dual-write (no infinite loop)", async () => {
    setDocumentTitle('Hello World');
    mockTranslateOnce(ok(['Hola Mundo', ' ']));
    const titleTranslator = newTranslator({ getSourceLanguage: () => 'en', isPageVisible: () => true });
    await titleTranslator.start('es');
    translateBatch.mockClear();

    // Let any pending async work from the module's own <title> write settle.
    await flushAsyncWork();

    expect(translateBatch).not.toHaveBeenCalled();
  });
});
