// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { err, ok } from '../../shared/result';
import { connectivity } from '../connectivity';
import type { PieceOutcome, Translator } from '../translator';
import { createPageTranslator, pruneDisconnectedRestoreEntries } from './translateLoop';

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

  it('an ordinary translatePage() always uses the ambient getSourceLanguage(), real bug this replaced: a manually-pinned site language used to be forced onto every request forever, mistranslating content that was already correct', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const sourceLanguagesSeen: string[] = [];
    const spyTranslator: Translator = {
      async translateBatch(request) {
        sourceLanguagesSeen.push(request.sourceLanguage);
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const pageTranslator = createPageTranslator({
      translator: spyTranslator,
      getSourceLanguage: () => 'auto',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    expect(sourceLanguagesSeen).toEqual(['auto']);
    pageTranslator.restorePage();
  });

  it('an explicit source language passed to translatePage() forces it for that translate, and keeps applying to later translates on the same page load until a fresh one is explicitly passed', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const sourceLanguagesSeen: string[] = [];
    const spyTranslator: Translator = {
      async translateBatch(request) {
        sourceLanguagesSeen.push(request.sourceLanguage);
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const pageTranslator = createPageTranslator({
      translator: spyTranslator,
      getSourceLanguage: () => 'auto',
      getBatchingHint: () => undefined,
    });

    // The bubble's From picker: force 'vi' for this one retranslate.
    await pageTranslator.translatePage('en', 'vi');
    await waitFor(() => sourceLanguagesSeen.length === 1);
    expect(sourceLanguagesSeen).toEqual(['vi']);

    // A later ordinary translate (e.g. the plain Translate button) on this
    // same page load keeps using the forced language — matches TWP's
    // improveTranslation semantics, which this was modeled on.
    await pageTranslator.translatePage('fr');
    await waitFor(() => sourceLanguagesSeen.length === 2);
    expect(sourceLanguagesSeen).toEqual(['vi', 'vi']);

    pageTranslator.restorePage();
  });

  // Accuracy fix, found via audit: the bubble's From picker (an explicit
  // source language forced via translatePage()'s second argument) applied
  // to every body text node's translate request, but the tab title used to
  // keep using the ambient getSourceLanguage() ('auto' in this extension's
  // real wiring) regardless — a page mis-detected as the wrong language and
  // manually corrected via the picker translated correctly everywhere
  // except the title.
  it('the tab-title translate request also uses an explicit source language forced via translatePage(), not the ambient getSourceLanguage()', async () => {
    document.title = 'Titre original';
    document.body.innerHTML = '<p>hello</p>';
    const sourceLanguagesSeen: string[] = [];
    const spyTranslator: Translator = {
      async translateBatch(request) {
        sourceLanguagesSeen.push(request.sourceLanguage);
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const pageTranslator = createPageTranslator({
      translator: spyTranslator,
      getSourceLanguage: () => 'auto',
      getBatchingHint: () => undefined,
    });

    // The bubble's From picker: force 'fr' for this translate — should
    // apply to the title's own translate request too, not just the body.
    await pageTranslator.translatePage('en', 'fr');
    await waitFor(() => document.title === 'TITRE ORIGINAL');

    expect(sourceLanguagesSeen).toContain('fr');
    expect(sourceLanguagesSeen).not.toContain('auto');

    pageTranslator.restorePage();
    document.title = '';
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

  it('does not overwrite a node the page updated in place while its translation was in flight, real bug this closed: write-back only ever checked node.isConnected, never that node.data was still the text that was actually sent for translation — a live-updating node (a score, a streaming chat message) stays connected the whole time, so that check alone caught nothing, and the node used to get silently clobbered with the translation of stale, already-superseded text', async () => {
    document.body.innerHTML = '<p id="score">score: 1</p>';
    const scoreNode = (document.getElementById('score') as HTMLElement).firstChild as Text;

    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const translator: Translator = {
      async translateBatch(request) {
        await firstHeld;
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => `TR:${s}`)));
      },
    };
    const pageTranslator = createPageTranslator({
      translator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    void pageTranslator.translatePage('es'); // starts, hangs on firstHeld with 'score: 1' as the sent text
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the request actually go out with the OLD text

    // The page updates the node in place while its translation is still
    // in flight — same shape as a live scoreboard or a streaming chat
    // message.
    scoreNode.data = 'score: 2';

    releaseFirst(); // the now-stale translation ('TR:score: 1') resolves
    await waitFor(() => scoreNode.data === 'TR:score: 2'); // must re-translate the NEW content, not write the stale one

    expect(scoreNode.data).toBe('TR:score: 2');
    pageTranslator.restorePage();
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

  // Reliability fix, found via audit: wakeRoutine() only ever cancels a
  // PENDING (not-yet-fired) scheduled tick via clearTimeout — it can't stop
  // one already mid-await. A mutation firing while a batch for the SAME
  // cycle was still in flight (no translatePage() call, unlike the
  // abandoned-cycle test above) used to schedule and immediately run a
  // fully concurrent second tick, calling translateBatch() again before the
  // first call had even resolved — racing shared queue/batchInFlight state.
  it('does not run a second concurrent tick for the SAME cycle while the previous tick is still awaiting its translateBatch response', async () => {
    document.body.innerHTML = '<p id="a">first</p>';
    const pEl = document.getElementById('a') as HTMLElement;

    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let concurrentCalls = 0;
    let maxConcurrentCalls = 0;
    const translateBatch = vi.fn(async (request: { pieces: string[][] }): Promise<PieceOutcome[]> => {
      concurrentCalls++;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
      if (translateBatch.mock.calls.length === 1) await firstHeld;
      concurrentCalls--;
      return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
    });

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es'); // tick 1 starts, hangs inside the first translateBatch call
    await new Promise((resolve) => setTimeout(resolve, 20)); // let it actually enter the hung call

    // A new node appears while the first tick's batch is still in flight —
    // same cycle (no translatePage() call), mirroring a page mutating
    // while a translate is genuinely still in progress.
    const newP = document.createElement('p');
    newP.textContent = 'second';
    document.body.append(newP);
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the mutation observer + any (mis)scheduled second tick fire

    // Real bug this closed: without the fix, a second, fully concurrent
    // translateBatch() call would already have fired by now.
    expect(translateBatch).toHaveBeenCalledTimes(1);
    expect(maxConcurrentCalls).toBe(1);

    releaseFirst();
    await waitFor(() => pEl.textContent === 'FIRST' && newP.textContent === 'SECOND');

    expect(translateBatch).toHaveBeenCalledTimes(2); // the second node's own, SEQUENTIAL tick
    expect(maxConcurrentCalls).toBe(1); // the two calls never overlapped

    pageTranslator.restorePage();
  });

  it('does not create a duplicate queue entry when the same node changes more than once before its previous entry has been drained, real bug this closed: requeueChangedTextNode pushed with no membership check, so two rapid mutations on the same node (a live score, a streaming counter) could each queue it separately — wasting a translate request and racing two write-backs for one node', async () => {
    document.body.innerHTML = '<p id="a">first</p>';
    const pEl = document.getElementById('a') as HTMLElement;
    const textNode = pEl.firstChild as Text;

    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const pieceCountsSeen: number[] = [];
    const translateBatch = vi.fn(async (request: { pieces: string[][] }): Promise<PieceOutcome[]> => {
      pieceCountsSeen.push(request.pieces.length);
      if (translateBatch.mock.calls.length === 1) await firstHeld;
      return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
    });

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es'); // tick 1 splices the node out, hangs on the request
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Two SEPARATE mutations on the same node, each in its own microtask
    // flush window, while its own translation is still in flight (so it's
    // not currently sitting in `queue` when the first mutation fires).
    textNode.data = 'changed once';
    await new Promise((resolve) => setTimeout(resolve, 20));
    textNode.data = 'changed twice';
    await new Promise((resolve) => setTimeout(resolve, 20));

    releaseFirst();
    await waitFor(() => pEl.textContent === 'CHANGED TWICE');

    // Exactly 2 calls, each carrying exactly 1 piece for this one node —
    // the original text, then its later content once. A duplicate queue
    // entry would have shown up as a 2nd piece in one of these calls (or a
    // 3rd call entirely), translating the same node's content twice.
    expect(pieceCountsSeen).toEqual([1, 1]);
    expect(translateBatch).toHaveBeenCalledTimes(2);

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

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      // Real spacing now sits between pre-surfacing retries (see
      // translateLoop.ts's nextDelay comment) — fake timers keep this fast
      // without waiting on real wall-clock time.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(pageTranslator.getLastError()).toBe('HTTP 429');
      expect(errorSpy).toHaveBeenCalledWith('HTTP 429', 'provider');
      // The page must stay untranslated — no false success.
      expect(document.body.textContent).toBe('hello');

      pageTranslator.restorePage();
      expect(pageTranslator.getLastError()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
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

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(pageTranslator.getLastError()).toBe('HTTP 429');
      expect(errorSpy).toHaveBeenCalledWith('HTTP 429', 'provider');
      expect(document.body.textContent).toBe('hello');

      pageTranslator.restorePage();
      expect(pageTranslator.getLastError()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Reliability fix, found via audit and reproduced live against Wikipedia
  // (a language-switcher endonym — a language's own name in its own
  // script — which Google correctly declines to translate, so the same
  // request keeps coming back looking like a silent-echo failure forever).
  // A batch whose every outcome is `kind: 'suspicious'` is NOT evidence the
  // provider is broken, unlike `kind: 'http'`/`'network'`/`'parse'` above —
  // it must NOT take the unconditional-retry-forever `allFailed` branch.
  // Instead it falls through to the per-node loop, which routes it through
  // noteMissingResult()'s existing bounded (give-up-after-3, cooldown-gated)
  // retry, and no error is surfaced.
  it("does not retry unconditionally forever, and never surfaces an error, when every outcome in a batch is kind:'suspicious'", async () => {
    document.body.innerHTML = '<p id="a">alpha</p>';
    const errorSpy = vi.fn();
    const translateBatch = vi.fn(
      async (request: { pieces: string[][] }): Promise<PieceOutcome[]> =>
        request.pieces.map(() => err({ kind: 'suspicious', message: 'confirmed suspicious after repair retry' })),
    );

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });
    pageTranslator.onError(errorSpy);

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      // noteMissingResult gives up after 3 requeues (a 4th attempt sees
      // attempts > 3), each gated behind its 1500ms cooldown — advance
      // comfortably past all of them.
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(1600);
      }

      const callCountAfterGivingUp = translateBatch.mock.calls.length;
      expect(callCountAfterGivingUp).toBe(4); // 1 original attempt + 3 bounded retries, then give-up

      // Confirm it's actually stopped, not just between cooldowns — the
      // real bug this closed had NO bound at all (an unconditional retry
      // every tick, forever).
      await vi.advanceTimersByTimeAsync(20_000);
      expect(translateBatch.mock.calls.length).toBe(callCountAfterGivingUp);

      expect(pageTranslator.getLastError()).toBeNull();
      expect(errorSpy).not.toHaveBeenCalled();

      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
  });

  // Contrast case, same fix: a batch failing for a REAL reason (not just
  // "confirmed suspicious") must keep taking the unconditional-retry-forever
  // `allFailed` branch exactly as before — this is the behavior a genuinely
  // down/misconfigured provider needs, and the fix above must not weaken it.
  it("still retries unconditionally forever (no cooldown, no give-up) when a batch's failures are genuine network/http failures, not kind:'suspicious'", async () => {
    document.body.innerHTML = '<p id="a">alpha</p>';
    const translateBatch = vi.fn(
      async (request: { pieces: string[][] }): Promise<PieceOutcome[]> =>
        request.pieces.map(() => err({ kind: 'network', message: 'provider unreachable' })),
    );

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      // Once an error surfaces (after 3 failures), retries back off
      // (8s, 12s, 18s, ... capped at 30s — see translateLoop.ts's
      // `nextDelay` comment) rather than the faster pre-surfacing pace, so
      // this needs a much longer window than the suspicious-batch test
      // above to observe a 5th call.
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(6000);
      }

      // noteMissingResult's 4-call plateau does NOT apply here — a genuine
      // failure keeps retrying well past it, and an error does surface.
      expect(translateBatch.mock.calls.length).toBeGreaterThan(4);
      expect(pageTranslator.getLastError()).toBe('provider unreachable');

      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
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

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(pageTranslator.getLastError()).toBe('connection reset');
      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
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

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(pageTranslator.getLastError()).toBe('translation failed');
      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
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
      // 3 failing ticks at the pre-surfacing spacing (0ms, then 1000ms, then
      // 2000ms — see translateLoop.ts's nextDelay comment) to first surface
      // the error.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(pageTranslator.getLastError()).not.toBeNull();

      // Let the surfaced-error streak climb well past its first value —
      // 30000ms comfortably covers the growing backoff at every step.
      for (let i = 0; i < 4; i++) {
        await vi.advanceTimersByTimeAsync(30000);
      }

      pageTranslator.restorePage();

      void pageTranslator.translatePage('es'); // a brand-new attempt
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000); // 3rd failing tick — surfaces again here
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

      vi.useFakeTimers();
      try {
        void pageTranslator.translatePage('es');
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000);

        expect(pageTranslator.getLastErrorKind()).toBe('provider');

        pageTranslator.restorePage();
      } finally {
        vi.useRealTimers();
      }
      isOnlineSpy.mockRestore();
    });
  });

  it('shows a plain-language message instead of the raw internal "no result for this piece" string', async () => {
    // Real bug, found via a live user report: the bubble's red panel showed
    // the raw internal string batchedHttpProvider.ts uses for this failure
    // mode verbatim — accurate, but not something a user should have to
    // parse.
    document.body.innerHTML = '<p>hello</p>';
    const alwaysFailingTranslator: Translator = {
      async translateBatch() {
        throw new Error('[google] no result for this piece');
      },
    };
    const pageTranslator = createPageTranslator({
      translator: alwaysFailingTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);

      expect(pageTranslator.getLastError()).toBe("Couldn't reach the translation service — retrying automatically.");
      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('isWorking/onWorkingChange', () => {
    // Real bug this replaced: `pageState` flips to 'translated' before any
    // real translate work has happened, so a caller awaiting only
    // translatePage() (e.g. the old bubble/popup busy toggle) saw "done"
    // in ~zero frames with nothing actually translated yet. isWorking()
    // tracks real activity — queued or in-flight work — separately.
    it('is true while the queue drains and false once it empties', async () => {
      let resolveBatch!: () => void;
      const controlledTranslator: Translator = {
        async translateBatch(request) {
          await new Promise<void>((resolve) => {
            resolveBatch = resolve;
          });
          return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
        },
      };
      document.body.innerHTML = '<p>hello</p>';
      const pageTranslator = createPageTranslator({
        translator: controlledTranslator,
        getSourceLanguage: () => 'en',
        getBatchingHint: () => undefined,
      });
      const workingValues: boolean[] = [];
      pageTranslator.onWorkingChange((w) => workingValues.push(w));

      expect(pageTranslator.isWorking()).toBe(false);

      const translatePromise = pageTranslator.translatePage('es');
      await translatePromise;
      // translatePage() itself never awaits real work — real work is
      // exactly what isWorking() is meant to still report as pending here.
      await waitFor(() => pageTranslator.isWorking());
      expect(pageTranslator.isWorking()).toBe(true);
      expect(pageTranslator.getState()).toBe('translated'); // reported early, same as before — isWorking() is the new, accurate signal

      resolveBatch();
      await waitFor(() => document.body.textContent === 'HELLO');
      await waitFor(() => !pageTranslator.isWorking());
      expect(pageTranslator.isWorking()).toBe(false);
      expect(workingValues).toContain(true);
      expect(workingValues[workingValues.length - 1]).toBe(false);

      pageTranslator.restorePage();
    });

    it('goes false once an error is surfaced, even though failed nodes keep retrying in the background (no perpetual spinner)', async () => {
      document.body.innerHTML = '<p>hello</p>';
      const alwaysFailingTranslator: Translator = {
        async translateBatch() {
          throw new Error('HTTP 429');
        },
      };
      const pageTranslator = createPageTranslator({
        translator: alwaysFailingTranslator,
        getSourceLanguage: () => 'en',
        getBatchingHint: () => undefined,
      });

      vi.useFakeTimers();
      try {
        void pageTranslator.translatePage('es');
        await vi.advanceTimersByTimeAsync(0);
        expect(pageTranslator.isWorking()).toBe(true); // first (unsurfaced) failure — still retrying quietly

        await vi.advanceTimersByTimeAsync(1000);
        await vi.advanceTimersByTimeAsync(2000); // 3rd failing tick — surfaces
        expect(pageTranslator.getLastError()).not.toBeNull();
        expect(pageTranslator.isWorking()).toBe(false);

        pageTranslator.restorePage();
      } finally {
        vi.useRealTimers();
      }
    });

    it('a transient blip that clears within ~1.5s never surfaces an error, because pre-surfacing retries are now genuinely spaced out', async () => {
      // Fails based on ELAPSED TIME, not attempt count — this is what
      // actually distinguishes the fix: the old fixed 150ms retry pace
      // could reach 3 failures (surfacing) in ~300ms, well before a blip
      // like this had cleared, even though a slightly later retry would
      // have succeeded. Real spacing (0, 1000, 2000ms — see
      // translateLoop.ts's nextDelay comment) gives this blip a real
      // chance to clear before the 3rd, surfacing attempt.
      document.body.innerHTML = '<p>hello</p>';
      const flakyTranslator: Translator = {
        async translateBatch(request) {
          if (Date.now() < blipClearsAt) throw new Error('network blip');
          return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
        },
      };
      const errorSpy = vi.fn();
      const pageTranslator = createPageTranslator({
        translator: flakyTranslator,
        getSourceLanguage: () => 'en',
        getBatchingHint: () => undefined,
      });
      pageTranslator.onError(errorSpy);

      vi.useFakeTimers();
      // Fake timers start at the real current time, not 0 — anchor the
      // blip's clear time relative to that, not an absolute timestamp.
      const blipClearsAt = Date.now() + 1500;
      try {
        void pageTranslator.translatePage('es');
        await vi.advanceTimersByTimeAsync(0); // attempt 1 (t=0): fails, still within the blip
        await vi.advanceTimersByTimeAsync(1000); // attempt 2 (t=1000): fails, still within the blip
        await vi.advanceTimersByTimeAsync(2000); // attempt 3 (t=3000): blip has cleared — succeeds

        expect(pageTranslator.getLastError()).toBeNull();
        expect(errorSpy).not.toHaveBeenCalled();
        expect(document.body.textContent).toBe('HELLO');

        pageTranslator.restorePage();
      } finally {
        vi.useRealTimers();
      }
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
    // 700 paragraphs: tick 1 (queue=700, >MAX_PIECES_PER_TICK) reorders and
    // translates the first batch, leaving a remainder still eligible on
    // tick 2 by queue size alone — but nothing changed since tick 1's
    // reorder, so tick 2 must not re-measure. Fake timers (not a real
    // wall-clock wait) give deterministic control over exactly how many
    // ticks run, since draining ticks no longer have a fixed inter-batch
    // delay (see translateLoop.ts's nextDelay comment).
    for (let i = 0; i < 700; i++) {
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

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      await vi.advanceTimersByTimeAsync(0); // tick 1: reorders (measures the whole queue) and translates the first batch
      const callsAfterTick1 = rectSpy.mock.calls.length;
      expect(callsAfterTick1).toBeGreaterThan(0);

      await vi.advanceTimersByTimeAsync(0); // tick 2: still eligible by queue size, but not dirty

      // No NEW measurement calls — tick 2 was eligible by queue size alone,
      // but the dirty flag (cleared after tick 1) correctly skipped it.
      expect(rectSpy.mock.calls.length).toBe(callsAfterTick1);

      pageTranslator.restorePage();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-measures after a scroll invalidates the previous ordering', async () => {
    // Real wall-clock time (multiple ~150ms batches) comfortably exceeds
    // vitest's default 5000ms test timeout — bumped below.
    // 1500 nodes at MAX_PIECES_PER_TICK=300 needs 5 batches to drain. Each
    // mock batch has a real, deliberately generous delay so the drain
    // naturally spans real wall-clock time well past resweep's 400ms
    // scroll debounce, instead of finishing near-instantly now that ticks
    // no longer have a fixed inter-batch pause (see translateLoop.ts's
    // nextDelay comment) — real timers throttled by a realistic per-batch
    // cost, not a race against fake-timer cascading semantics. Scroll is
    // dispatched immediately after the first reorder (not after an
    // additional wait) so the debounce's 400ms target lands mid-drain with
    // comfortable margin, rather than right at the finish line.
    for (let i = 0; i < 1500; i++) {
      const p = document.createElement('p');
      p.textContent = `hello ${i}`;
      document.body.appendChild(p);
    }
    stubAllRectsVisible();
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect');

    const slowTranslator: Translator = {
      async translateBatch(request) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.toUpperCase())));
      },
    };
    const pageTranslator = createPageTranslator({
      translator: slowTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => rectSpy.mock.calls.length > 0, 3000); // tick 1's reorder measured something
    const callsAfterTick1 = rectSpy.mock.calls.length;

    // Scroll — resweep.ts's own debounced listener (400ms) marks the
    // ordering dirty again via onViewportChanged, landing mid-drain (see
    // the timing comment above) so there's a real eligible tick left for
    // the dirty flag to take effect on.
    window.dispatchEvent(new Event('scroll'));
    await waitFor(() => rectSpy.mock.calls.length > callsAfterTick1, 5000);

    pageTranslator.restorePage();
  }, 10000);
});

describe('original whitespace restoration', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  /** Simulates Google's own real behavior, confirmed directly against the live endpoint: strips ALL leading/trailing whitespace from a piece's translated text, unless this fix restores it. */
  function whitespaceStrippingTranslator(): Translator {
    return {
      async translateBatch(request) {
        return request.pieces.map((piece): PieceOutcome => ok(piece.map((s) => s.trim().toUpperCase())));
      },
    };
  }

  it('restores a source Text node\'s own trailing whitespace, real bug: without this, adjacent inline siblings write back jammed together ("Read " + "more" → "ReadMORE" instead of "Read MORE") on any page with inline markup — confirmed live: Google\'s real endpoint strips trailing whitespace from a piece\'s own translated content, independent of and in addition to the separate padding-slot reflow issue already fixed', async () => {
    document.body.innerHTML = '<p>Read <b>more</b></p>';
    const pageTranslator = createPageTranslator({
      translator: whitespaceStrippingTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'READ MORE');

    expect(document.body.textContent).toBe('READ MORE'); // not 'READMORE'

    pageTranslator.restorePage();
  });

  it('restores a leading space the same way as a trailing one', async () => {
    document.body.innerHTML = '<p><b>Read</b> more</p>';
    const pageTranslator = createPageTranslator({
      translator: whitespaceStrippingTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'READ MORE');

    expect(document.body.textContent).toBe('READ MORE'); // not 'READMORE'

    pageTranslator.restorePage();
  });

  it('does not double whitespace when the provider already preserves some of its own (Google keeps most leading space, per the same investigation)', async () => {
    document.body.innerHTML = '<p>Read <b>more</b></p>';
    const preservesLeadingTranslator: Translator = {
      async translateBatch(request) {
        return request.pieces.map(
          (piece): PieceOutcome => ok(piece.map((s) => (s.startsWith(' ') ? ' ' : '') + s.trim().toUpperCase())),
        );
      },
    };
    const pageTranslator = createPageTranslator({
      translator: preservesLeadingTranslator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'READ MORE');

    expect(document.body.textContent).toBe('READ MORE'); // not 'READ  MORE' (doubled space)

    pageTranslator.restorePage();
  });

  it('leaves text with no leading/trailing whitespace untouched', async () => {
    document.body.innerHTML = '<p>hello</p>';
    const pageTranslator = createPageTranslator({
      translator: whitespaceStrippingTranslator(),
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => document.body.textContent === 'HELLO');

    expect(document.body.textContent).toBe('HELLO');

    pageTranslator.restorePage();
  });
});

describe('incremental write-back (onPieceComplete)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it("writes a fast piece to the DOM as soon as it individually resolves, without waiting for a slower piece in the SAME tick — real bug this closed: translateBatch() used to withhold every piece until the slowest one settled, so a fully-translated node sat untranslated on screen for as long as the slowest sibling's request took", async () => {
    document.body.innerHTML = '<p id="fast">alpha</p><p id="slow">beta</p>';
    const fastNode = (document.getElementById('fast') as HTMLElement).firstChild as Text;
    const slowNode = (document.getElementById('slow') as HTMLElement).firstChild as Text;

    // A translator that mimics batchedHttpProvider's real timing: it
    // calls onPieceComplete for each piece independently, well before
    // its own returned promise resolves.
    const translator: Translator = {
      translateBatch(request) {
        return new Promise((resolve) => {
          const outcomes: PieceOutcome[] = [];
          setTimeout(() => {
            const outcome = ok(['FAST']);
            outcomes[0] = outcome;
            request.onPieceComplete?.(0, outcome);
          }, 10);
          setTimeout(() => {
            const outcome = ok(['SLOW']);
            outcomes[1] = outcome;
            request.onPieceComplete?.(1, outcome);
            resolve(outcomes);
          }, 150);
        });
      },
    };

    const pageTranslator = createPageTranslator({
      translator,
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    void pageTranslator.translatePage('es');

    // Past the fast piece's 10ms but well short of the slow piece's
    // 150ms — the fast node must already be written.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(fastNode.data).toBe('FAST');
    expect(slowNode.data).toBe('beta'); // not yet translated — the whole call hasn't resolved

    await waitFor(() => slowNode.data === 'SLOW');
    expect(fastNode.data).toBe('FAST');

    pageTranslator.restorePage();
  });
});

describe('noteMissingResult — cooldown retry (not silent abandonment)', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it("eventually translates a node whose piece keeps failing while a CONTINUOUSLY-REFRESHED companion piece in the same batch keeps succeeding, real bug this closed: once the companion first succeeds and leaves the queue, a lone failing node's batch is JUST that node — every tick then hits the allFailed path (which unconditionally retries, no cooldown, its own separate mechanism), masking the real bug. With fresh succeeding content in EVERY tick's batch (matching a real page's live-updating content — a score, a chat message), a failing node instead hits noteMissingResult's cooldown-gated retry on every attempt, and used to be silently dropped from the queue forever the first time a retry landed inside its own 1500ms cooldown — no error surfaced (allFailed never fires while the companion keeps succeeding), and nothing ever re-added it since its content never actually changed", async () => {
    document.body.innerHTML = '<p id="a">alpha</p><p id="b">beta0</p>';
    const aNode = (document.getElementById('a') as HTMLElement).firstChild as Text;
    const bNode = (document.getElementById('b') as HTMLElement).firstChild as Text;
    let aAttempts = 0;
    let bCounter = 0;
    const translateBatch = vi.fn(async (request: { pieces: string[][] }) =>
      request.pieces.map((piece): PieceOutcome => {
        const text = piece[0] ?? '';
        if (text.startsWith('alpha')) {
          aAttempts++;
          // Fails its first 2 real attempts, succeeds on the 3rd — real
          // pieces DO eventually recover; the bug was that a node inside
          // the cooldown window never got a chance to find out.
          if (aAttempts < 3) return err({ kind: 'network', message: 'simulated transient failure' });
          return ok([text.toUpperCase()]);
        }
        return ok(piece.map((s) => s.toUpperCase())); // 'beta*' companion always succeeds
      }),
    );

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    vi.useFakeTimers();
    try {
      void pageTranslator.translatePage('es');
      await vi.advanceTimersByTimeAsync(0); // tick 1: 'a' fails (attempt 1) via noteMissingResult, 'b0' succeeds

      // Keep refreshing the companion (a characterData mutation, picked
      // up by mutationWatcher -> requeueChangedTextNode) every 100ms —
      // simulating a real page's live-updating content — so 'a' is never
      // left alone in a batch, which would route it through the
      // DIFFERENT allFailed bypass instead of the cooldown path under
      // test. 40 refreshes comfortably covers 'a's two retry cooldowns
      // (1500ms each).
      for (let i = 0; i < 40; i++) {
        bNode.data = `beta${++bCounter}`;
        await vi.advanceTimersByTimeAsync(100);
      }

      expect(aAttempts).toBe(3); // real bug: stayed at 1 forever without the fix
      await waitFor(() => aNode.data === 'ALPHA');
      expect(aNode.data).toBe('ALPHA');
    } finally {
      vi.useRealTimers();
    }

    pageTranslator.restorePage();
  });
});

describe('failure paths clear lastSeenText for disconnected nodes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it("re-translates a node that disconnected while its batch failed ENTIRELY (allFailed) and later reappears with unchanged content, real bug this closed: the allFailed requeue path filtered out disconnected nodes (correctly — they're not on the page) but, unlike the success path, never cleared their lastSeenText — so a recycled-list node reattached with the SAME (still-untranslated) text looked unchanged to queueOrRequeueIfChanged and was never requeued, permanently stuck", async () => {
    document.body.innerHTML = '<p id="a">alpha</p>';
    const p = document.getElementById('a') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;

    let callCount = 0;
    const translateBatch = vi.fn(async (): Promise<PieceOutcome[]> => {
      callCount++;
      if (callCount === 1) {
        // The node is recycled out of the DOM while this (single-piece,
        // whole-batch-failing) request is in flight.
        p.remove();
        return [err({ kind: 'network', message: 'simulated whole-batch failure' })];
      }
      return [ok(['ALPHA'])];
    });

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => callCount >= 1);

    // Reattached with the SAME, still-untranslated content — the exact
    // shape of a virtualized-list node pool reusing a recycled element.
    document.body.appendChild(p);

    await waitFor(() => textNode.data === 'ALPHA');
    expect(textNode.data).toBe('ALPHA');
    expect(callCount).toBeGreaterThanOrEqual(2); // proves it was actually re-sent, not left stuck

    pageTranslator.restorePage();
  });

  it('re-translates a node that disconnected while its batch threw an exception, same fix applied to the catch(e) path for the same reason', async () => {
    document.body.innerHTML = '<p id="a">alpha</p>';
    const p = document.getElementById('a') as HTMLParagraphElement;
    const textNode = p.firstChild as Text;

    let callCount = 0;
    const translateBatch = vi.fn(async (): Promise<PieceOutcome[]> => {
      callCount++;
      if (callCount === 1) {
        p.remove();
        throw new Error('simulated thrown failure');
      }
      return [ok(['ALPHA'])];
    });

    const pageTranslator = createPageTranslator({
      translator: { translateBatch },
      getSourceLanguage: () => 'en',
      getBatchingHint: () => undefined,
    });

    await pageTranslator.translatePage('es');
    await waitFor(() => callCount >= 1);

    document.body.appendChild(p);

    await waitFor(() => textNode.data === 'ALPHA');
    expect(textNode.data).toBe('ALPHA');
    expect(callCount).toBeGreaterThanOrEqual(2);

    pageTranslator.restorePage();
  });
});

describe('pruneDisconnectedRestoreEntries', () => {
  it('keeps an entry after a single disconnected tick — only pruned once a SECOND consecutive tick still finds it disconnected', () => {
    const node = document.createTextNode('HELLO');
    // Deliberately never attached to document.body — `.isConnected` is
    // `false` by construction, standing in for "detached this tick"
    // without needing a real DOM attach/detach or any timer at all: this
    // is what makes the test deterministic instead of racing the real
    // resweep-scheduler/MutationObserver timing stack (interval-driven,
    // not something a test can pin to an exact tick count).
    const nodesToRestore = new Map<Text, string>([[node, 'hello']]);
    const disconnectedLastTick = new WeakSet<Text>();

    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 1: disconnected — marked as a candidate, not pruned yet
    expect(nodesToRestore.has(node)).toBe(true);
  });

  it('prunes an entry after two CONSECUTIVE disconnected ticks — a real removal, not a recycle-pool blip', () => {
    const node = document.createTextNode('HELLO');
    const nodesToRestore = new Map<Text, string>([[node, 'hello']]);
    const disconnectedLastTick = new WeakSet<Text>();

    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 1: disconnected
    expect(nodesToRestore.has(node)).toBe(true);
    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 2: still disconnected
    expect(nodesToRestore.has(node)).toBe(false);
  });

  it('resets the disconnected streak once a node reconnects, so a later real removal needs its own two consecutive ticks again', () => {
    document.body.innerHTML = '<p id="item">hello</p>';
    const item = document.getElementById('item');
    if (!item) throw new Error('unreachable');
    const node = item.firstChild;
    if (!(node instanceof Text)) throw new Error('unreachable');

    const nodesToRestore = new Map<Text, string>([[node, 'hello']]);
    const disconnectedLastTick = new WeakSet<Text>();

    item.remove();
    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 1: disconnected — candidate
    expect(nodesToRestore.has(node)).toBe(true);

    document.body.appendChild(item); // reconnected before a 2nd consecutive disconnected tick
    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 2: connected — streak reset, entry untouched
    expect(nodesToRestore.has(node)).toBe(true);

    item.remove();
    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 3: disconnected again — candidate (streak was reset, not carried over)
    expect(nodesToRestore.has(node)).toBe(true);
    pruneDisconnectedRestoreEntries(nodesToRestore, disconnectedLastTick); // tick 4: still disconnected — now genuinely pruned
    expect(nodesToRestore.has(node)).toBe(false);

    document.body.innerHTML = '';
  });
});
