// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../shared/result';
import { connectivity } from '../connectivity';
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

  it('translates a detached-then-reattached node whose content changed while off-DOM (recycled/virtualized list nodes)', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    const p = document.body.querySelector('p') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;

    // Simulate a virtualized-list-style node pool: detach the node (no
    // mutation record fires for a disconnected node), mutate its content
    // while off-DOM, then reattach it with the new content already set.
    p.removeChild(textNode);
    textNode.data = 'reused for new content';
    p.appendChild(textNode);

    await waitFor(() => p.textContent === 'REUSED FOR NEW CONTENT');
    expect(p.textContent).toBe('REUSED FOR NEW CONTENT');

    pageTranslator.restorePage();
  });

  it('restores the CURRENT original text, not the text captured when the node was first queued', async () => {
    // Regression: nodesToRestore was only written in queueNode, so a node
    // whose content legitimately changed while translated (a live score, an
    // edited comment) restored to its first-ever text — silently discarding
    // whatever the page had since changed it to.
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    const p = document.body.querySelector('p') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    p.removeChild(textNode);
    textNode.data = 'updated by the page';
    p.appendChild(textNode);
    await waitFor(() => p.textContent === 'UPDATED BY THE PAGE');

    pageTranslator.restorePage();

    expect(p.textContent).toBe('updated by the page');
  });

  it('discards a slow batch from an abandoned cycle instead of overwriting the newer translation', async () => {
    // Ask for one language, switch to another before the first response
    // lands, then let the stale response arrive. It must not overwrite.
    document.body.innerHTML = '<p>hello</p>';
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    const translator: Translator = {
      async translateBatch(request) {
        callCount++;
        if (callCount === 1) {
          await firstHeld;
          return request.pieces.map((piece): PieceOutcome => ok(piece.map(() => 'STALE')));
        }
        return request.pieces.map((piece): PieceOutcome => ok(piece.map(() => 'FRESH')));
      },
    };
    const pageTranslator = createPageTranslator({
      translator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    void pageTranslator.translatePage('fr'); // starts, hangs on firstHeld
    await new Promise((resolve) => setTimeout(resolve, 20));
    await pageTranslator.translatePage('de'); // abandons the first cycle
    await waitFor(() => document.body.textContent === 'FRESH');

    releaseFirst();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(document.body.textContent).toBe('FRESH');
    pageTranslator.restorePage();
  });

  it('retranslates a node that was disconnected while its translation was in flight, once reattached with the same content', async () => {
    // Regression: a node disconnected between being sent and the response
    // landing had its result silently dropped (correct), but lastSeenText
    // still matched its still-untranslated content — so reattaching it
    // unchanged looked like "nothing changed" and it was never requeued.
    document.body.innerHTML = '<p>hello</p>';
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let callCount = 0;
    const translator: Translator = {
      async translateBatch(request) {
        callCount++;
        if (callCount === 1) await firstHeld;
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const pageTranslator = createPageTranslator({
      translator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    void pageTranslator.translatePage('es'); // first batch is now in flight, hanging
    await new Promise((resolve) => setTimeout(resolve, 20));

    const p = document.body.querySelector('p') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    p.removeChild(textNode); // detach while the request for it is in flight
    releaseFirst(); // response now lands for a disconnected node — dropped
    await new Promise((resolve) => setTimeout(resolve, 20));

    p.appendChild(textNode); // reattach with the SAME (still-untranslated) content
    await waitFor(() => p.textContent === 'HELLO');

    expect(p.textContent).toBe('HELLO');
    pageTranslator.restorePage();
  });

  it('does not re-translate a detached-then-reattached node whose content is unchanged (no spurious requeue)', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const translateBatch = vi.fn(async (request: { pieces: string[][] }) =>
      request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase()))),
    );
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');
    translateBatch.mockClear();

    const p = document.body.querySelector('p') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;
    p.removeChild(textNode);
    // No content change this time — the node still holds the translated text.
    p.appendChild(textNode);

    // Give the mutation watcher/resweep a real chance to (wrongly) queue it.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(translateBatch).not.toHaveBeenCalled();
    expect(p.textContent).toBe('HELLO');

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

  it('requeues and retries a piece that came back as a provider error, rather than leaving it untranslated silently — while an unrelated piece in the same batch still succeeds', async () => {
    // Deliberately a *partial* failure (one node ok, one not) rather than
    // every piece failing — an all-failed batch takes the separate
    // allFailed/consecutive-failure-tracking path (see the tests above),
    // which bypasses this per-node retry logic entirely by design (a
    // systemic provider failure shouldn't be treated as "one weird node").
    // This is what actually exercises noteMissingResult()'s isolated-node
    // give-up-after-3-tries cooldown/retry logic below.
    document.body.innerHTML = '<p>hello</p><p>world</p>';
    const translateBatch = vi.fn(async (request: { pieces: string[][] }) =>
      request.pieces.map(
        (piece): PieceOutcome =>
          piece[0] === 'hello'
            ? { ok: false, error: { kind: 'network', message: 'boom' } }
            : ok(piece.map((s) => s.toUpperCase())),
      ),
    );
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'helloWORLD');
    // Initial attempt, then one immediate requeue retry for the failing
    // node — a second requeue is throttled to at most once per 1500ms
    // (noteMissingResult's cooldown guard), so this window only ever
    // observes the first retry, not the full give-up-after-3 exhaustion.
    await waitFor(() => translateBatch.mock.calls.length >= 2);

    expect(document.body.textContent).toBe('helloWORLD'); // "hello" never got a real translation, "world" did
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

  // Regression test for a real shipped bug: a misconfigured/rate-limited
  // provider whose translateBatch() always throws used to retry forever
  // in silence, with getState() staying 'translated' — the UI reported
  // success while nothing on the page ever changed (see this repo's
  // CLAUDE.md for the incident writeup). getLastError()/onError() must
  // surface a real error after a few consecutive failures.
  it('surfaces a real error via getLastError()/onError() after repeated batch failures, without ever throwing', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const alwaysFailingTranslator: Translator = {
      async translateBatch() {
        throw new Error('HTTP 429');
      },
    };
    const errorSpy = vi.fn();
    const pageTranslator = createPageTranslator({
      translator: alwaysFailingTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });
    pageTranslator.onError(errorSpy);

    await pageTranslator.translatePage('es');
    await waitFor(() => pageTranslator.getLastError() !== null);

    expect(pageTranslator.getLastError()).toBe('HTTP 429');
    expect(errorSpy).toHaveBeenCalledWith('HTTP 429', 'provider');
    // The page must stay untranslated — no false success.
    expect(document.body.textContent).toBe('hello');

    pageTranslator.restorePage();
    expect(pageTranslator.getLastError()).toBeNull();
  });

  // The actual real-world shape of this bug, found via manual verification
  // against a real broken provider: createBatchedHttpProvider's
  // translateBatch() deliberately never throws for an HTTP-level failure —
  // it resolves with an `ok: false` PieceOutcome per piece instead (so one
  // bad request can't crash a whole batch). The test above only covers a
  // translator that throws; this covers the far more common path a
  // misconfigured/rate-limited provider actually takes.
  it('surfaces a real error when every outcome in a batch resolves ok:false, not just on a thrown exception', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const alwaysErrorOutcomeTranslator: Translator = {
      async translateBatch(request) {
        return request.pieces.map((): PieceOutcome => err({ kind: 'http', message: 'HTTP 429' }));
      },
    };
    const errorSpy = vi.fn();
    const pageTranslator = createPageTranslator({
      translator: alwaysErrorOutcomeTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });
    pageTranslator.onError(errorSpy);

    await pageTranslator.translatePage('es');
    await waitFor(() => pageTranslator.getLastError() !== null);

    expect(pageTranslator.getLastError()).toBe('HTTP 429');
    expect(errorSpy).toHaveBeenCalledWith('HTTP 429', 'provider');
    expect(document.body.textContent).toBe('hello');

    pageTranslator.restorePage();
    expect(pageTranslator.getLastError()).toBeNull();
  });

  it('surfaces a real error even when the thrown value is not an Error instance', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const throwsAStringTranslator: Translator = {
      async translateBatch() {
        // Deliberately not an Error instance — to cover the String(e) fallback branch.
        throw 'connection reset';
      },
    };
    const pageTranslator = createPageTranslator({
      translator: throwsAStringTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => pageTranslator.getLastError() !== null);

    expect(pageTranslator.getLastError()).toBe('connection reset');
    pageTranslator.restorePage();
  });

  it('falls back to a generic message if a batch resolves with no outcomes at all for its pieces', async () => {
    document.body.innerHTML = '<p>hello</p>';
    // Deliberately malformed (bypassing the real PieceOutcome contract) —
    // a provider that returns a shorter/empty-slot array rather than one
    // real outcome per piece. Real providers shouldn't do this, but
    // translateLoop.ts defensively handles it (`!o?.ok`), so it's worth
    // proving the fallback message actually fires rather than throwing.
    const malformedTranslator: Translator = {
      async translateBatch(request) {
        return request.pieces.map(() => undefined) as unknown as PieceOutcome[];
      },
    };
    const pageTranslator = createPageTranslator({
      translator: malformedTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => pageTranslator.getLastError() !== null);

    expect(pageTranslator.getLastError()).toBe('translation failed');
    pageTranslator.restorePage();
  });

  it('skips applying a translation result to a node that was removed from the DOM before the response arrived', async () => {
    document.body.innerHTML = '<p id="p">hello</p>';
    const p = document.getElementById('p') as HTMLParagraphElement;
    const translateBatch = vi.fn(async (request: { pieces: string[][] }) => {
      p.remove(); // disconnect the node mid-flight, before the result comes back
      return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
    });
    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => translateBatch.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Never throws, and never writes to a node that's no longer connected.
    expect(document.body.innerHTML).toBe('');
    pageTranslator.restorePage();
  });

  it('resets the surfaced-error backoff on restore, so a fresh translate starts its first surfaced retry at ~8s, not inheriting a long backoff', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const translateBatchSpy = vi.fn(async () => {
      throw new Error('boom');
    });
    const pageTranslator = createPageTranslator({
      translator: { translateBatch: translateBatchSpy },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      // 3 failing ticks at the fast 150ms interval to first surface the error.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(150);
      expect(pageTranslator.getLastError()).not.toBeNull();

      // Let the surfaced-error streak climb well past its first value —
      // 30000ms comfortably covers the growing backoff at every step.
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(30000);
      }

      pageTranslator.restorePage();

      void pageTranslator.translatePage('es'); // a brand-new attempt
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(150);
      await vi.advanceTimersByTimeAsync(150); // 3rd failing tick — surfaces again here
      const callsAtSurfacing = translateBatchSpy.mock.calls.length;

      // Advance well past the fixed 8000ms first-surfacing delay but well
      // short of the 30000ms cap a leftover high streak would clamp to.
      await vi.advanceTimersByTimeAsync(8500);

      // Fixed: streak reset to 0 by restorePage(), so this surfacing's delay
      // is 8000ms — another retry has already fired within the window.
      // Unfixed: the streak kept climbing before the restore, so this
      // delay is clamped to 30000ms and no retry happens within 8500ms.
      expect(translateBatchSpy.mock.calls.length).toBeGreaterThan(callsAtSurfacing);

      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
  });

  it('restorePage() is safe to call again with nothing pending (no active routine timer)', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');
    pageTranslator.restorePage();

    expect(() => pageTranslator.restorePage()).not.toThrow();
    expect(pageTranslator.getState()).toBe('original');
  });

  describe('connectivity awareness (graceful degradation under flaky/no internet)', () => {
    it('does not call translateBatch at all while offline — reports a distinct "offline" error instead of "provider broken"', async () => {
      const isOnlineSpy = vi.spyOn(connectivity, 'isOnline').mockReturnValue(false);
      document.body.innerHTML = '<p>hello</p>';
      const translateBatch = vi.fn(async (request: { pieces: string[][] }) =>
        request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase()))),
      );
      const errorSpy = vi.fn();
      const pageTranslator = createPageTranslator({
        translator: { translateBatch },
        getSourceLanguage: () => 'en',
        getBatchingHint: () => undefined,
      });
      pageTranslator.onError(errorSpy);

      await pageTranslator.translatePage('es');
      await waitFor(() => pageTranslator.getLastErrorKind() === 'offline');

      expect(translateBatch).not.toHaveBeenCalled();
      expect(pageTranslator.getLastErrorKind()).toBe('offline');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('resume automatically'), 'offline');
      // The queued node is untouched — no false success, no data loss.
      expect(document.body.textContent).toBe('hello');

      pageTranslator.restorePage();
      isOnlineSpy.mockRestore();
    });

    it('resumes translating within one tick of connectivity returning, without waiting for the next scheduled backoff', async () => {
      const isOnlineSpy = vi.spyOn(connectivity, 'isOnline').mockReturnValue(false);
      let capturedListener: ((online: boolean) => void) | undefined;
      const onChangeSpy = vi.spyOn(connectivity, 'onChange').mockImplementation((cb) => {
        capturedListener = cb;
        return () => {};
      });
      document.body.innerHTML = '<p>hello</p>';
      const pageTranslator = createPageTranslator({
        translator: uppercaseTranslator(),
        getSourceLanguage: () => 'en',
        getBatchingHint: () => undefined,
      });

      await pageTranslator.translatePage('es');
      await waitFor(() => pageTranslator.getLastErrorKind() === 'offline');
      expect(document.body.textContent).toBe('hello'); // still untranslated while offline

      isOnlineSpy.mockReturnValue(true);
      capturedListener?.(true);
      await waitFor(() => document.body.textContent === 'HELLO');

      expect(document.body.textContent).toBe('HELLO');
      expect(pageTranslator.getLastErrorKind()).toBeNull();

      pageTranslator.restorePage();
      isOnlineSpy.mockRestore();
      onChangeSpy.mockRestore();
    });

    it('a provider failure while online is reported as "provider", not "offline"', async () => {
      const isOnlineSpy = vi.spyOn(connectivity, 'isOnline').mockReturnValue(true);
      document.body.innerHTML = '<p>hello</p>';
      const alwaysFailingTranslator: Translator = {
        async translateBatch() {
          throw new Error('HTTP 500');
        },
      };
      const pageTranslator = createPageTranslator({
        translator: alwaysFailingTranslator,
        getSourceLanguage: () => 'en',
        getBatchingHint: () => undefined,
      });

      await pageTranslator.translatePage('es');
      await waitFor(() => pageTranslator.getLastError() !== null);

      expect(pageTranslator.getLastErrorKind()).toBe('provider');

      pageTranslator.restorePage();
      isOnlineSpy.mockRestore();
    });
  });
});

describe('viewport-priority reordering — dirty-flag gating', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /** Every paragraph reports itself as visible — content of the rect doesn't matter for these tests, only how many times it's measured. */
  function stubAllRectsVisible(): void {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 0,
      bottom: 10,
      left: 0,
      right: 0,
      width: 0,
      height: 10,
      x: 0,
      y: 0,
    } as DOMRect);
  }

  it('does not re-measure node positions on a later tick when nothing changed since the last reorder', async () => {
    // 250 paragraphs: tick 1 (queue=250, >100) reorders and translates the
    // first 100, leaving 150 (still >100 — eligible again on tick 2, but
    // nothing changed since tick 1's reorder).
    for (let i = 0; i < 250; i++) {
      const p = document.createElement('p');
      p.textContent = `hello ${i}`;
      document.body.appendChild(p);
    }
    stubAllRectsVisible();
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => rectSpy.mock.calls.length > 0); // tick 1's reorder measured something
    const callsAfterTick1 = rectSpy.mock.calls.length;

    // Let tick 2 run (150ms cadence while queue.length > 0).
    await waitFor(
      () => document.querySelectorAll('p').length === 250 && document.body.textContent?.includes('HELLO 150'),
      3000,
    );

    // No NEW measurement calls — tick 2 was eligible by queue size alone,
    // but the dirty flag (cleared after tick 1) correctly skipped it.
    expect(rectSpy.mock.calls.length).toBe(callsAfterTick1);

    pageTranslator.restorePage();
  });

  it('re-measures after a scroll invalidates the previous ordering', async () => {
    // A large node count keeps `queue.length > MAX_PIECES_PER_TICK` true for
    // many ticks (~150ms cadence) — comfortably longer than resweep's 400ms
    // scroll debounce, so there's a real reorder-eligible tick for the
    // dirty flag to actually take effect on after the scroll.
    for (let i = 0; i < 1000; i++) {
      const p = document.createElement('p');
      p.textContent = `hello ${i}`;
      document.body.appendChild(p);
    }
    stubAllRectsVisible();
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    const pageTranslator = createPageTranslator({
      translator: uppercaseTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => rectSpy.mock.calls.length > 0);
    const callsAfterTick1 = rectSpy.mock.calls.length;

    // Let at least one "eligible but not dirty" tick pass and confirm it's
    // correctly skipped, same as the previous test.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(rectSpy.mock.calls.length).toBe(callsAfterTick1);

    // Scroll — resweep.ts's own debounced listener (400ms) marks the
    // ordering dirty again via onViewportChanged.
    window.dispatchEvent(new Event('scroll'));

    await waitFor(() => rectSpy.mock.calls.length > callsAfterTick1, 3000);

    pageTranslator.restorePage();
  });
});
