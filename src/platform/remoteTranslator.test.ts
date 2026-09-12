import { fakeBrowser } from '@webext-core/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../shared/result';

// `vi.resetModules()` + a fresh dynamic import per test, rather than the
// usual static import — needed once `remoteTranslator.ts` started
// registering its own PERSISTENT `translatePiecesProgress` listener (never
// unsubscribed, by design — see that file's header comment for why).
// `fakeBrowser.reset()` wipes the fake `chrome.runtime.onMessage`
// listener array out from under `@webext-core/messaging`'s own internal
// bookkeeping (`generic.ts`'s `removeRootListener`/`perTypeListeners`),
// which previously went unnoticed here only because every listener this
// file registered was ALSO torn down at the end of every test (via
// `unsubscribe()`), which coincidentally reset the messaging library's
// own state back to "nothing registered" at the same time. With a listener
// that intentionally never unsubscribes, that bookkeeping desyncs after
// the first test: the messaging library still believes a root listener is
// registered (so a later `onMessage()` call skips re-registering one) even
// though `fakeBrowser.reset()` already removed the real one — every
// `translatePieces` send in a later test then fails with "No listeners
// available". A fresh module instance per test (a fresh
// `defineExtensionMessaging()` closure, via `protocol.ts`) sidesteps this
// entirely instead of trying to keep the two layers' bookkeeping in sync.
describe('createRemoteTranslator', () => {
  let onMessage: typeof import('./messaging/protocol').onMessage;
  let createRemoteTranslator: typeof import('./remoteTranslator').createRemoteTranslator;
  let unsubscribe: (() => void) | undefined;

  beforeEach(async () => {
    fakeBrowser.reset();
    vi.resetModules();
    ({ onMessage } = await import('./messaging/protocol'));
    ({ createRemoteTranslator } = await import('./remoteTranslator'));
  });

  afterEach(() => {
    // @webext-core/messaging only allows one listener per message type per
    // JS context — belt-and-braces alongside the fresh-module reset above
    // (a test that registers its own `translatePieces` listener still
    // tears it down explicitly, matching this file's original discipline).
    unsubscribe?.();
    unsubscribe = undefined;
  });

  it('sends a translatePieces message and returns the response as-is', async () => {
    let received: unknown;
    unsubscribe = onMessage('translatePieces', (message) => {
      received = message.data;
      return [ok(['hola'])];
    });

    const translator = createRemoteTranslator();
    const result = await translator.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(result).toEqual([{ ok: true, value: ['hola'] }]);
    expect(received).toMatchObject({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });
  });

  it('forwards dontSortResults through to the message', async () => {
    let received: unknown;
    unsubscribe = onMessage('translatePieces', (message) => {
      received = message.data;
      return [];
    });

    const translator = createRemoteTranslator();
    await translator.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [],
      dontSortResults: true,
    });

    expect(received).toMatchObject({ dontSortResults: true });
  });

  describe('timeout — reliability fix, found via a real mobile bug report: a translatePieces call whose response never arrives (e.g. the background service worker was killed mid-request by mobile OS memory pressure, losing its sendResponse closure) used to hang translateBatch() forever, pinning translateLoop.ts\'s "working" state permanently true with no recovery short of reloading the page', () => {
    it('rejects once the round trip exceeds the timeout instead of hanging forever', async () => {
      unsubscribe = onMessage('translatePieces', () => new Promise(() => {}));
      vi.useFakeTimers();
      try {
        const translator = createRemoteTranslator();
        const resultPromise = translator.translateBatch({
          sourceLanguage: 'en',
          targetLanguage: 'es',
          pieces: [['a']],
        });
        const assertion = expect(resultPromise).rejects.toThrow(/timed out/);
        await vi.advanceTimersByTimeAsync(90000);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not reject before the timeout elapses', async () => {
      unsubscribe = onMessage('translatePieces', () => new Promise(() => {}));
      vi.useFakeTimers();
      try {
        const translator = createRemoteTranslator();
        const resultPromise = translator.translateBatch({
          sourceLanguage: 'en',
          targetLanguage: 'es',
          pieces: [['a']],
        });
        let settled = false;
        resultPromise.then(
          () => (settled = true),
          () => (settled = true),
        );
        await vi.advanceTimersByTimeAsync(89000);
        expect(settled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("onPieceComplete relay — reliability/speed fix, found via audit: a function property cannot survive chrome.runtime message serialization, so translateLoop.ts's onPieceComplete (the beta.34 incremental write-back callback) was silently dropped before this fix, and the whole point of that feature — visible text appearing progressively instead of only once a whole tick resolves — never actually happened outside a unit test's in-process mock Translator", () => {
    it('tags the outgoing message with a numeric requestId', async () => {
      let received: { requestId?: unknown } = {};
      unsubscribe = onMessage('translatePieces', (message) => {
        received = message.data as { requestId?: unknown };
        return [];
      });

      const translator = createRemoteTranslator();
      await translator.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [] });

      expect(typeof received.requestId).toBe('number');
    });

    it('strips onPieceComplete out of the outgoing message entirely — real bug this closed: a function property silently vanishes under structured-clone serialization instead of throwing, so a naive pass-through looked correct in a same-process unit test while doing nothing in the real extension', async () => {
      let received: Record<string, unknown> = {};
      unsubscribe = onMessage('translatePieces', (message) => {
        received = message.data as unknown as Record<string, unknown>;
        return [];
      });

      const translator = createRemoteTranslator();
      await translator.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [],
        onPieceComplete: () => {},
      });

      expect(received.onPieceComplete).toBeUndefined();
      expect(Object.keys(received)).not.toContain('onPieceComplete');
    });

    it("forwards an incoming translatePiecesProgress notification to the matching request's onPieceComplete, using fakeBrowser's onMessage.trigger() to simulate the background->content relay directly (chrome.tabs.sendMessage itself isn't implemented by @webext-core/fake-browser)", async () => {
      let requestId: number | undefined;
      unsubscribe = onMessage('translatePieces', (message) => {
        requestId = (message.data as { requestId: number }).requestId;
        return new Promise(() => {}); // never resolves — this test only cares about the progress relay, not completion
      });

      const received: Array<{ index: number; outcome: unknown }> = [];
      const translator = createRemoteTranslator();
      void translator.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [['a'], ['b']],
        onPieceComplete: (index, outcome) => received.push({ index, outcome }),
      });
      await vi.waitFor(() => expect(requestId).not.toBeUndefined());

      await fakeBrowser.runtime.onMessage.trigger(
        {
          id: 1,
          type: 'translatePiecesProgress',
          timestamp: Date.now(),
          data: { requestId, index: 1, outcome: ok(['B']) },
        },
        {},
        () => {},
      );

      expect(received).toEqual([{ index: 1, outcome: ok(['B']) }]);
    });

    it("does NOT invoke a DIFFERENT in-flight request's onPieceComplete — routes strictly by requestId, since the main tick, attributeTranslator.ts, and titleTranslator.ts can all have their own translatePieces call in flight from the same frame at once", async () => {
      const requestIds: number[] = [];
      unsubscribe = onMessage('translatePieces', (message) => {
        requestIds.push((message.data as { requestId: number }).requestId);
        return new Promise(() => {});
      });

      const receivedA: unknown[] = [];
      const receivedB: unknown[] = [];
      const translator = createRemoteTranslator();
      void translator.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [['a']],
        onPieceComplete: (index, outcome) => receivedA.push({ index, outcome }),
      });
      void translator.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [['b']],
        onPieceComplete: (index, outcome) => receivedB.push({ index, outcome }),
      });
      await vi.waitFor(() => expect(requestIds).toHaveLength(2));
      const [, idB] = requestIds;

      await fakeBrowser.runtime.onMessage.trigger(
        {
          id: 2,
          type: 'translatePiecesProgress',
          timestamp: Date.now(),
          data: { requestId: idB, index: 0, outcome: ok(['B']) },
        },
        {},
        () => {},
      );

      expect(receivedA).toEqual([]);
      expect(receivedB).toEqual([{ index: 0, outcome: ok(['B']) }]);
    });

    it('does not throw for a progress notification whose requestId matches no in-flight request (already completed, or an abandoned/superseded cycle)', async () => {
      unsubscribe = onMessage('translatePieces', () => []);
      const translator = createRemoteTranslator();
      await translator.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [] });

      await expect(
        fakeBrowser.runtime.onMessage.trigger(
          {
            id: 3,
            type: 'translatePiecesProgress',
            timestamp: Date.now(),
            data: { requestId: 999999, index: 0, outcome: ok(['x']) },
          },
          {},
          () => {},
        ),
      ).resolves.not.toThrow();
    });
  });
});
