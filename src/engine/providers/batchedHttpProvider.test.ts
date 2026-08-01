import { afterEach, describe, expect, it, vi } from 'vitest';
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
