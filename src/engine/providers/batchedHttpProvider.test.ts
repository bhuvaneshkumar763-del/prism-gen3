import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectivity } from '../connectivity';
import * as networkQuality from '../networkQuality';
import { createBatchedHttpProvider } from './batchedHttpProvider';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A minimal callback set: one string in, one string out, no separator logic. */
function plainCallbacks() {
  return {
    transformPiece: (strings: string[]) => strings.join('|'),
    parseResponse: (response: unknown, _pieceCount: number) =>
      (response as { texts: string[] }).texts.map((text) => ({ text, detectedLanguage: null })),
    splitPieceResponse: (raw: string) => raw.split('|'),
  };
}

describe('createBatchedHttpProvider — GET requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses getQueryString to build a GET request URL, sending no body', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ texts: ['hola'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'get-provider',
      baseUrl: 'https://example.com/translate',
      method: 'GET',
      callbacks: {
        ...plainCallbacks(),
        getQueryString: (source, target, texts) => `?q=${texts.join(',')}&from=${source}&to=${target}`,
      },
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/translate?q=hello&from=en&to=es');
    expect(init.body).toBeUndefined();
  });
});

describe('createBatchedHttpProvider — batching budget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('splits pieces into multiple HTTP requests once maxBatchChars is exceeded', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ texts: ['AAAAAAAAAA'] }))
      .mockResolvedValueOnce(jsonResponse({ texts: ['BBBBBBBBBB'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'small-budget',
      baseUrl: 'https://example.com',
      method: 'POST',
      maxBatchChars: 5,
      callbacks: {
        ...plainCallbacks(),
        getRequestBody: (_s, _t, texts) => JSON.stringify(texts),
      },
    });

    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['aaaaaaaaaa'], ['bbbbbbbbbb']],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { ok: true, value: ['AAAAAAAAAA'] },
      { ok: true, value: ['BBBBBBBBBB'] },
    ]);
  });

  it("defaults the batch budget to 2000 chars, raised from TWP's original 800 (speed audit, verified end-to-end against a real live page — see the option's doc comment for the measurements)", async () => {
    // Echoes back one text per piece actually sent in each call's body —
    // avoids a false pass via the missing-piece repair retry (a single
    // under-budget batch that got a too-short mock response would also
    // trigger a second fetch call, for the wrong reason).
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as string[];
      return jsonResponse({ texts: sent.map(() => 'x') });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'default-budget',
      baseUrl: 'https://example.com',
      method: 'POST',
      // No maxBatchChars override — exercising the real default.
      callbacks: {
        ...plainCallbacks(),
        getRequestBody: (_s, _t, texts) => JSON.stringify(texts),
      },
    });

    // Each 2050-char piece alone exceeds the 2000-char budget (forcing a
    // batch flush right after it) — splits into two single-piece requests.
    await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a'.repeat(2050)], ['b'.repeat(2050)]],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const piecesPerCall = fetchMock.mock.calls.map(
      ([, init]) => (JSON.parse((init as RequestInit).body as string) as string[]).length,
    );
    expect(piecesPerCall).toEqual([1, 1]);
  });

  it('bundles pieces well under the old 800-char budget into a single request now that the default is 2000, real regression this guards: raising the constant without this test would leave the old, now-wrong 800 boundary unverified', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as string[];
      return jsonResponse({ texts: sent.map(() => 'x') });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'default-budget-bundling',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: {
        ...plainCallbacks(),
        getRequestBody: (_s, _t, texts) => JSON.stringify(texts),
      },
    });

    // Two 850-char pieces (1700 total) both fit under the new 2000-char
    // budget — this would have split into 2 requests under the old 800
    // default (see the test above, pre-raise).
    await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a'.repeat(850)], ['b'.repeat(850)]],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('createBatchedHttpProvider — onPieceComplete (incremental delivery)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("real gap this closed: a fast sub-batch's pieces used to be withheld from the caller until the SLOWEST sub-batch in the same translateBatch() call finished — onPieceComplete now fires for a fast piece well before a concurrently-running slow one settles", async () => {
    // Two single-piece requests (maxBatchChars: 0 forces each into its
    // own sub-batch — maxBatchChars: 1 would NOT: a 1-char piece alone
    // only reaches currentChars=1, which is not '>1', so it stays
    // pending and merges with the next piece instead of flushing)
    // running concurrently (maxConcurrent: 2) — 'a' comes back fast,
    // 'b' comes back slow.
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as string[];
      const isSlow = sent[0] === 'b';
      await new Promise((resolve) => setTimeout(resolve, isSlow ? 250 : 10));
      return jsonResponse({ texts: sent.map((s) => `${s}-translated`) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const completedInOrder: number[] = [];
    let overallSettled = false;

    const provider = createBatchedHttpProvider({
      name: 'incremental',
      baseUrl: 'https://example.com',
      method: 'POST',
      maxConcurrent: 2,
      maxBatchChars: 0,
      callbacks: { ...plainCallbacks(), getRequestBody: (_s, _t, texts) => JSON.stringify(texts) },
    });

    const resultPromise = provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a'], ['b']],
      onPieceComplete: (index) => {
        completedInOrder.push(index);
      },
    });
    resultPromise.then(() => {
      overallSettled = true;
    });

    // The fast piece ('a', index 0) has had time to resolve (10ms) but
    // the slow one ('b', index 1, 250ms) has not — real regression this
    // guards: onPieceComplete for 'a' arriving only once BOTH settle
    // (i.e. after ~250ms) is exactly the withheld-until-slowest bug.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(completedInOrder).toEqual([0]);
    expect(overallSettled).toBe(false);

    const results = await resultPromise;
    expect(completedInOrder).toEqual([0, 1]);
    expect(results).toEqual([
      { ok: true, value: ['a-translated'] },
      { ok: true, value: ['b-translated'] },
    ]);
  });

  it('passes the same outcome to onPieceComplete that the final resolved array contains, including a failed piece', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ texts: [] })); // empty texts -> every piece comes back missing
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'incremental-failure',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const completed: Array<{ index: number; ok: boolean }> = [];
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
      onPieceComplete: (index, outcome) => {
        completed.push({ index, ok: outcome.ok });
      },
    });

    expect(results).toEqual([
      { ok: false, error: { kind: 'network', message: '[incremental-failure] no result for this piece' } },
    ]);
    expect(completed).toEqual([{ index: 0, ok: false }]);
  });

  it('does not throw or change behavior when onPieceComplete is omitted (existing callers)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ texts: ['hola'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'no-callback',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });
    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
  });
});

describe('createBatchedHttpProvider — lifecycle hooks and concurrency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls onBatchStart before and onBatchEnd after the batch, even on failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const onBatchStart = vi.fn();
    const onBatchEnd = vi.fn();
    const provider = createBatchedHttpProvider({
      name: 'hooks',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
      onBatchStart,
      onBatchEnd,
    });

    await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(onBatchStart).toHaveBeenCalledTimes(1);
    expect(onBatchEnd).toHaveBeenCalledTimes(1);
  });

  it('caps concurrent in-flight HTTP requests at maxConcurrent', async () => {
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const fetchMock = vi.fn(async () => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return jsonResponse({ texts: ['x'] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'concurrency',
      baseUrl: 'https://example.com',
      method: 'POST',
      maxConcurrent: 2,
      maxBatchChars: 1, // force every piece into its own request
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a'], ['b'], ['c'], ['d'], ['e'], ['f']],
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(maxObservedInFlight).toBeLessThanOrEqual(2);
  });

  it('individual-piece repair retries respect the SAME concurrency limit as top-level batches, real bug this closed: the repair fan-out used to fire one HTTP request per missing/suspicious piece via a bare Promise.all, completely invisible to the concurrency limiter — a batch-wide echo/truncation failure could put dozens of simultaneous requests on the wire despite maxConcurrent', async () => {
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      const sent = JSON.parse(init.body as string) as string[];
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      // The one top-level batch (all 8 pieces together) comes back with
      // only 1 result — the other 7 are "missing" and each becomes its
      // own individual repair request.
      if (sent.length > 1) return jsonResponse({ texts: ['only-one-translated'] });
      return jsonResponse({ texts: [`${sent[0]}-translated`] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'repair-concurrency',
      baseUrl: 'https://example.com',
      method: 'POST',
      maxConcurrent: 3,
      callbacks: { ...plainCallbacks(), getRequestBody: (_s, _t, texts) => JSON.stringify(texts) },
    });

    await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h']],
    });

    // 1 top-level request + 7 individual repair requests (one per
    // missing piece).
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(maxObservedInFlight).toBeLessThanOrEqual(3);
  });

  it("an individual-piece repair retry inherits the PARENT's deadline instead of starting a fresh OVERALL_DEADLINE_MS budget, real bug this closed: a handleBatch() that had already spent most of its ~30s budget on the initial request used to hand a missing-piece repair retry a FRESH ~30s budget, so one handleBatch() could run ~60s total — double what the constant's own doc comment says it bounds", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
        const sent = JSON.parse(init.body as string) as string[];
        if (sent.length > 1) {
          // The top-level batch: comes back one entry short (missing
          // piece 'b'), and simulates having already burned 29 of the
          // 30s OVERALL_DEADLINE_MS budget by directly advancing the
          // fake clock — deterministic, and avoids an unrelated 20s
          // per-request timeout complicating this test.
          vi.setSystemTime(Date.now() + 29000);
          return jsonResponse({ texts: ['a-translated'] });
        }
        // The repair retry for 'b': always rate-limited, with an EXACT
        // (non-jittered) Retry-After, so the retry delay is fully
        // deterministic.
        return new Response('{}', { status: 429, headers: { 'retry-after': '5' } });
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = createBatchedHttpProvider({
        name: 'deadline-sharing',
        baseUrl: 'https://example.com',
        method: 'POST',
        callbacks: { ...plainCallbacks(), getRequestBody: (_s, _t, texts) => JSON.stringify(texts) },
      });

      let settled = false;
      const resultPromise = provider
        .translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['a'], ['b']] })
        .then((r) => {
          settled = true;
          return r;
        });

      // Only ~1s of the shared 30s budget is left once the repair retry
      // starts (29s already spent). With the fix, the repair's retry
      // delay is clamped to that ~1s remainder and it gives up shortly
      // after — settled well within 2s of the repair starting. Without
      // the fix, a repair with a FRESH 30s budget would honor the full
      // 5s Retry-After for up to MAX_ATTEMPTS-1 retries (~10s), not
      // settled yet at this point.
      await vi.advanceTimersByTimeAsync(2000);
      expect(settled).toBe(true);

      await resultPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('adapts maxConcurrent down when the Network Information API reports a slow connection', async () => {
    vi.spyOn(networkQuality, 'getAdaptiveConcurrency').mockReturnValue(1);
    let inFlight = 0;
    let maxObservedInFlight = 0;
    const fetchMock = vi.fn(async () => {
      inFlight++;
      maxObservedInFlight = Math.max(maxObservedInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return jsonResponse({ texts: ['x'] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'adaptive-concurrency',
      baseUrl: 'https://example.com',
      method: 'POST',
      maxConcurrent: 6, // would normally allow 6 in flight
      maxBatchChars: 1,
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a'], ['b'], ['c'], ['d']],
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    // getAdaptiveConcurrency mocked to 1 overrides the configured 6.
    expect(maxObservedInFlight).toBe(1);
    vi.restoreAllMocks();
  });

  it('honors a numeric Retry-After header by waiting at least that long before retrying', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ texts: ['ok'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'retry-after',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const resultPromise = provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });
    await vi.advanceTimersByTimeAsync(2000);
    const results = await resultPromise;

    expect(results).toEqual([{ ok: true, value: ['ok'] }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('createBatchedHttpProvider — suspicious vs. network failure kind', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a piece confirmed-suspicious after repair as kind:'suspicious', NOT kind:'network', real bug this closed: a caller (translateLoop.ts) that sees kind:'network' retries a batch unconditionally forever, correct for a genuinely broken provider — but a repeatedly-suspicious-yet-successful response (a real 200 OK that just looks like a silent echo, e.g. a language's own name in its own script staying unchanged) is NOT evidence the provider is down, and retrying it forever burns real requests against a live endpoint indefinitely with no error ever surfacing", async () => {
    // Empty text for real non-empty input is isSuspiciousOutcome's own
    // unconditional signature (see outputSanityCheck.ts) — reliably
    // triggers the sanity check on every attempt (original + repair),
    // matching a persistent real-world case, not a one-off blip.
    const fetchMock = vi.fn(async () => jsonResponse({ texts: [''] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'suspicious-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([
      {
        ok: false,
        error: {
          kind: 'suspicious',
          message: '[suspicious-test] result kept looking like a silent-echo failure after a repair retry',
        },
      },
    ]);
  });

  it("still classifies a genuinely missing result (no data at all for this piece) as kind:'network', unaffected by the suspicious-kind fix", async () => {
    // Echoes back one FEWER text than pieces actually sent in each call's
    // body — results[idx] is undefined for the last piece, the real "no
    // result" case (not the "got a result but it looked suspicious" one).
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const sent = JSON.parse(init.body as string) as string[];
      return jsonResponse({ texts: sent.slice(0, -1).map(() => 'hola') });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'missing-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: (_s, _t, texts) => JSON.stringify(texts) },
    });

    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello'], ['world']],
    });

    expect(results[0]).toEqual({ ok: true, value: ['hola'] });
    expect(results[1]).toEqual({
      ok: false,
      error: { kind: 'network', message: '[missing-test] no result for this piece' },
    });
  });

  it('two concurrent requests for the IDENTICAL piece both correctly inherit the suspicious classification from the shared in-flight request, not the network-failure default', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ texts: [''] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'dedupe-suspicious-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    // Two SEPARATE translateBatch() calls for the exact same piece,
    // concurrently — the second shares the first's in-flight request via
    // inFlightByKey's dedupe rather than getting its own PendingRequest.
    const [resultsA, resultsB] = await Promise.all([
      provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] }),
      provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] }),
    ]);

    expect(resultsA[0]).toEqual({ ok: false, error: { kind: 'suspicious', message: expect.any(String) } });
    expect(resultsB[0]).toEqual({ ok: false, error: { kind: 'suspicious', message: expect.any(String) } });
  });

  it("retries a suspicious piece's repair with sourceLanguage 'auto' instead of the original declared source, real bug this closed, found via a live-page audit and reproduced directly against a real X.com/Twitter account: the caller's declared source language is a single page-level guess (translateLoop.ts's `getSourceLanguage()`), which is routinely wrong for one piece on a genuinely multi-language page (a social feed, a forum) even when it's right for most of the page. Retrying with that same wrong source just reproduces the identical silent-echo failure forever, leaving the piece permanently untranslated with no error ever surfacing. Retrying with 'auto' for just this one piece lets the provider actually detect its real language", async () => {
    const sourcesSent: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { source: string };
      sourcesSent.push(body.source);
      // First call (declared source 'en', wrong for this piece): echo
      // back empty — isSuspiciousOutcome's own unconditional "empty result
      // for real input" trigger, same technique the test above this one
      // uses, so this doesn't depend on constructing real script-mismatched
      // text to exercise the repair path.
      if (sourcesSent.length === 1) return jsonResponse({ texts: [''] });
      // Repair call (should now be 'auto'): a real, successful translation.
      return jsonResponse({ texts: ['hola'] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'auto-repair-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: (source) => JSON.stringify({ source }) },
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(sourcesSent).toEqual(['en', 'auto']);
    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
  });

  it("does not force 'auto' for a plain missing piece (no data at all, not the suspicious/echo case) — keeps retrying with the ORIGINAL declared source, since a truncated/parse-short response is no evidence the source language guess was wrong", async () => {
    const sourcesSent: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { source: string; texts: string[] };
      sourcesSent.push(body.source);
      // Always one fewer entry than pieces sent — the genuine "no result
      // for this piece" case (see the "still classifies a genuinely
      // missing result" test above), never suspicious.
      return jsonResponse({ texts: body.texts.slice(0, -1).map(() => 'hola') });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'missing-not-auto-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: (source, _t, texts) => JSON.stringify({ source, texts }) },
    });

    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello'], ['world']],
    });

    expect(sourcesSent).toEqual(['en', 'en']);
    expect(results[1]).toEqual({
      ok: false,
      error: { kind: 'network', message: '[missing-not-auto-test] no result for this piece' },
    });
  });
});

describe('createBatchedHttpProvider — onNonRetryableStatus hook (auth-key reliability fix)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires onNonRetryableStatus with the HTTP status the moment a non-retryable response is seen — real bug this closed: a genuine 401/403 (a bad/rejected auth key) used to be swallowed entirely inside handleBatch's catch block with no way for the provider that supplied the credential to react", async () => {
    const fetchMock = vi.fn(async () => new Response('unauthorized', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const onNonRetryableStatus = vi.fn();

    const provider = createBatchedHttpProvider({
      name: 'auth-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
      onNonRetryableStatus,
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(onNonRetryableStatus).toHaveBeenCalledExactlyOnceWith(401);
    expect(results[0]).toEqual({ ok: false, error: { kind: 'network', message: expect.any(String) } });
  });

  it('does NOT fire onNonRetryableStatus for a retryable status (429/5xx) — that path already gets its own retry/backoff handling and is not evidence of a bad credential', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);
      const onNonRetryableStatus = vi.fn();

      const provider = createBatchedHttpProvider({
        name: 'retryable-test',
        baseUrl: 'https://example.com',
        method: 'POST',
        callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
        onNonRetryableStatus,
      });

      const resultPromise = provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [['hello']],
      });
      await vi.advanceTimersByTimeAsync(35000);
      await resultPromise;

      expect(onNonRetryableStatus).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createBatchedHttpProvider — suspicious-ratio window (auth-key reliability fix, found via a real live incident: a page that showed "translated" while every paragraph stayed untranslated, root-caused to a rejected/exhausted scraped auth key producing a silent-echo response the sanity check correctly, but insufficiently, classified as kind:\'suspicious\' on every single piece)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reclassifies a sustained run of suspicious results as kind:'network' once the rolling window is full and overwhelmingly suspicious, and fires onSuspiciousStreak exactly once at the crossing — lets translateLoop.ts's existing failure-surfacing logic correctly treat a broken provider as broken instead of silently doing nothing forever", async () => {
    // Every request comes back with an empty string for a non-empty
    // input — isSuspiciousOutcome's own unconditional signature (see the
    // "suspicious vs. network failure kind" tests above), matching the
    // real live shape: a bad key doesn't reject cleanly, it echoes an
    // empty/unchanged result for every single piece.
    const fetchMock = vi.fn(async () => jsonResponse({ texts: [''] }));
    vi.stubGlobal('fetch', fetchMock);
    const onSuspiciousStreak = vi.fn();

    const provider = createBatchedHttpProvider({
      name: 'streak-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
      onSuspiciousStreak,
    });

    const outcomes = [];
    for (let i = 0; i < 30; i++) {
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [['hello']],
      });
      outcomes.push(results[0]);
    }

    // Window isn't full until the 30th sample, so calls 1-29 are reported
    // exactly as before this fix: genuinely suspicious, not yet evidence
    // of a broken provider.
    for (const outcome of outcomes.slice(0, 29)) {
      expect(outcome).toMatchObject({ ok: false, error: { kind: 'suspicious' } });
    }
    // The 30th sample fills the window at a 100% suspicious ratio, well
    // over the threshold — reclassified, and the streak hook fires.
    expect(outcomes[29]).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(onSuspiciousStreak).toHaveBeenCalledTimes(1);
  });

  it('does NOT reclassify or fire onSuspiciousStreak for a page with a legitimately mixed suspicious ratio well under the threshold — no false positive on real, healthy content (a same-language endonym clustered among otherwise-normal translated pieces)', async () => {
    // Tied to the outer loop's iteration index, not a raw fetch-call
    // counter: a suspicious iteration costs TWO fetch calls (the initial
    // batch, then handleBatch's own individual-piece repair retry) while
    // a legitimate-success iteration costs only one, so counting raw
    // fetch invocations would desync which iteration is "supposed" to be
    // which almost immediately — the same class of mistake as the
    // per-node-cooldown confound noted elsewhere in this codebase's own
    // test-writing history.
    let currentIteration = 0;
    const fetchMock = vi.fn(async () => {
      // 5 of every 30 iterations (0, 6, 12, 18, 24) are a real,
      // successful, non-suspicious translation; the rest are suspicious —
      // 25/30 ≈ 83%, comfortably under the 90% threshold.
      const isLegitimateSuccess = currentIteration % 6 === 0;
      return jsonResponse({ texts: [isLegitimateSuccess ? 'hola' : ''] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const onSuspiciousStreak = vi.fn();

    const provider = createBatchedHttpProvider({
      name: 'mixed-page-test',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
      onSuspiciousStreak,
    });

    const outcomes = [];
    for (let i = 0; i < 30; i++) {
      currentIteration = i;
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'es',
        pieces: [['hello']],
      });
      outcomes.push(results[0]);
    }

    const suspiciousOutcomes = outcomes.filter((o) => o && !o.ok && o.error.kind === 'suspicious');
    expect(suspiciousOutcomes).toHaveLength(25);
    expect(onSuspiciousStreak).not.toHaveBeenCalled();
  });
});

describe('createBatchedHttpProvider — connectivity awareness', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not retry while offline — one attempt, no sleeping through the rest of the budget', async () => {
    vi.spyOn(connectivity, 'isOnline').mockReturnValue(false);
    const fetchMock = vi.fn(async () => {
      throw new Error('network down');
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'offline',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ ok: false, error: { kind: 'network', message: '[offline] no result for this piece' } }]);
  });

  it('retries normally (up to MAX_ATTEMPTS) while online', async () => {
    vi.spyOn(connectivity, 'isOnline').mockReturnValue(true);
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => {
      throw new Error('transient failure');
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'online-retry',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const resultPromise = provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });
    await vi.advanceTimersByTimeAsync(5000);
    await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('does not retry a non-retryable HTTP status (e.g. 401 bad API key) — one attempt, fails immediately', async () => {
    // Real gap: sendWithRetry's catch didn't distinguish a permanent client
    // error from a transient one, so a wrong/expired API key burned the
    // full retry budget (up to ~30s) confirming the same failure 3 times
    // before surfacing it.
    vi.spyOn(connectivity, 'isOnline').mockReturnValue(true);
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'bad key' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'bad-key',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([{ ok: false, error: { kind: 'network', message: '[bad-key] no result for this piece' } }]);
  });

  it('bounds the whole retry sequence to an overall deadline instead of letting 3 full-length slow attempts add up past a minute', async () => {
    // Regression: with no overall cap, REQUEST_TIMEOUT_MS(20s) x
    // MAX_ATTEMPTS(3) plus inter-attempt delays could leave a page visibly
    // untranslated for ~62s against a provider that's merely slow, not down.
    vi.spyOn(connectivity, 'isOnline').mockReturnValue(true);
    vi.useFakeTimers();
    // Simulates a provider that never responds — only settles when THIS
    // request's own AbortController fires, exactly like a real fetch() does.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'slow-provider',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const resultPromise = provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });
    await vi.advanceTimersByTimeAsync(35000); // comfortably past the intended ~30s deadline
    const results = await resultPromise;

    expect(results[0]?.ok).toBe(false);
    // Attempt 1 consumes the first 20s of the 30s budget; attempt 2 gets
    // whatever's left (~10s) and exhausts it exactly — leaving none for a
    // 3rd attempt. Without the deadline, all 3 would each get a fresh 20s.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('jitters the fixed retry delays within the documented +/-25% bounds', async () => {
    vi.spyOn(connectivity, 'isOnline').mockReturnValue(true);
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    vi.stubGlobal('setTimeout', (cb: () => void, delay: number) => {
      delays.push(delay);
      return realSetTimeout(cb, 0);
    });
    const fetchMock = vi.fn(async () => {
      throw new Error('transient failure');
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'jitter',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    // Two retry sleeps for MAX_ATTEMPTS=3 (attempt 1 and attempt 2), the
    // AbortController's 20s timeout also uses setTimeout but with a fixed
    // 20000ms delay that's easy to filter out.
    const retryDelays = delays.filter((d) => d !== 20000);
    expect(retryDelays).toHaveLength(2);
    expect(retryDelays[0]).toBeGreaterThanOrEqual(300);
    expect(retryDelays[0]).toBeLessThanOrEqual(500);
    expect(retryDelays[1]).toBeGreaterThanOrEqual(900);
    expect(retryDelays[1]).toBeLessThanOrEqual(1500);
  });

  it('does not jitter a real Retry-After-derived delay', async () => {
    vi.spyOn(connectivity, 'isOnline').mockReturnValue(true);
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(jsonResponse({ texts: ['ok'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createBatchedHttpProvider({
      name: 'retry-after-no-jitter',
      baseUrl: 'https://example.com',
      method: 'POST',
      callbacks: { ...plainCallbacks(), getRequestBody: () => '{}' },
    });

    const resultPromise = provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });
    // Advancing by exactly 1999ms (just under the exact 2000ms Retry-After)
    // must NOT be enough if the delay were jittered down below 2000ms.
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const results = await resultPromise;

    expect(results).toEqual([{ ok: true, value: ['ok'] }]);
    vi.useRealTimers();
  });
});
