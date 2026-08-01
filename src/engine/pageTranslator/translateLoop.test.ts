// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../shared/result';
import type { PieceOutcome, Translator } from '../translator';
import { createPageTranslator } from './translateLoop';

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Translates each piece by uppercasing every string in it — deterministic and easy to assert on. */
function uppercaseTranslator(): Translator {
  return {
    async translateBatch(request) {
      return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
    },
  };
}

describe('createPageTranslator', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('translates every collected text node and updates the DOM', async () => {
    document.body.innerHTML = '<p>hello</p><p>world</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLOWORLD');

    expect(document.body.textContent).toBe('HELLOWORLD');
    expect(pageTranslator.getState()).toBe('translated');

    pageTranslator.restorePage();
  });

  it('restorePage() restores the original text and returns to the original state', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    pageTranslator.restorePage();

    expect(document.body.textContent).toBe('hello');
    expect(pageTranslator.getState()).toBe('original');
  });

  it('groups sibling text nodes under the same block into one piece when a batching hint is given', async () => {
    document.body.innerHTML = '<p>Hello <b>world</b></p>';
    const translateBatch = vi.fn(async (request: { pieces: string[][] }) =>
      request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase()))),
    );
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => ({ groupByBlock: true, maxGroupChars: 2000 }),
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO WORLD');

    expect(translateBatch).toHaveBeenCalledWith(expect.objectContaining({ pieces: [['Hello ', 'world']] }));

    pageTranslator.restorePage();
  });

  it('picks up newly added DOM content via the mutation watcher and translates it', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    const newP = document.createElement('p');
    newP.textContent = 'added later';
    document.body.append(newP);

    await waitFor(() => newP.textContent === 'ADDED LATER');

    pageTranslator.restorePage();
  });

  it('notifies state-change listeners on translate and restore', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });
    const states: string[] = [];
    pageTranslator.onStateChange((s) => states.push(s));

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');
    pageTranslator.restorePage();

    expect(states).toEqual(['translated', 'original']);
  });

  it('an unsubscribed state-change listener stops receiving updates', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });
    const states: string[] = [];
    const unsubscribe = pageTranslator.onStateChange((s) => states.push(s));
    unsubscribe();

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');
    pageTranslator.restorePage();

    expect(states).toEqual([]);
  });

  it('re-translating while already translated restores first, so the true original is captured', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    await pageTranslator.translatePage('fr');
    await waitFor(() => document.body.textContent === 'HELLO');

    pageTranslator.restorePage();
    expect(document.body.textContent).toBe('hello');
  });

  it('requeues and retries a piece that came back as a provider error, rather than leaving it untranslated silently', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const translateBatch = vi.fn(async (request: { pieces: string[][] }) =>
      request.pieces.map((): PieceOutcome => ({ ok: false, error: { kind: 'network', message: 'boom' } })),
    );
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    // Initial attempt, then one immediate requeue retry — a second requeue
    // is throttled to at most once per 1500ms (noteMissingResult's guard),
    // so this window only ever observes the first retry, not the full
    // give-up-after-3 exhaustion.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(translateBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).toBe('hello'); // never got a real translation
    pageTranslator.restorePage();
  });

  it('getTranslatedNodes() exposes the currently-translated nodes and their pre-translation text', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    const translated = pageTranslator.getTranslatedNodes();
    expect(translated).toHaveLength(1);
    expect(translated[0]?.original).toBe('hello');
    expect(translated[0]?.node.data).toBe('HELLO');

    pageTranslator.restorePage();
    expect(pageTranslator.getTranslatedNodes()).toHaveLength(0);
  });

  function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it('disables the mutation watcher while the page is hidden, and re-enables (picking up new content) on becoming visible again', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    setVisibility('hidden');
    const hiddenP = document.createElement('p');
    hiddenP.textContent = 'added while hidden';
    document.body.append(hiddenP);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hiddenP.textContent).toBe('added while hidden'); // not observed — watcher disabled

    setVisibility('visible');
    await waitFor(() => hiddenP.textContent === 'ADDED WHILE HIDDEN');

    pageTranslator.restorePage();
  });

  it('the visibilitychange handler is a no-op while the page is not translated', () => {
    document.body.innerHTML = '<p>hello</p>';
    createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    expect(() => {
      setVisibility('hidden');
      setVisibility('visible');
    }).not.toThrow();
  });
});
