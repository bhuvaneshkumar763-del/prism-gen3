import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibreTranslateProvider } from './libretranslate';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createLibreTranslateProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a well-formed batch request and returns the translated text', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: ['hola'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/translate');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ q: ['hello'], source: 'en', target: 'es', format: 'text' });
  });

  it('bundles multiple pieces into one HTTP request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: ['hola', 'mundo'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello'], ['world']],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      { ok: true, value: ['hola'] },
      { ok: true, value: ['mundo'] },
    ]);
  });

  it('round-trips a multi-string piece (grouped context) through the separator', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: ['hola␟mundo'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello', 'world']],
    });

    expect(results).toEqual([{ ok: true, value: ['hola', 'mundo'] }]);
  });

  it('includes api_key in the request body when configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: ['hola'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com', apiKey: 'secret-key' });
    await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.api_key).toBe('secret-key');
  });

  it('returns a network-error outcome for every piece when fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('DNS lookup failed');
      }),
    );

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
  });

  it('returns an error outcome on a non-2xx response after retries are exhausted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 503)),
    );

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(results[0]?.ok).toBe(false);
    // 3 attempts total (1 initial + 2 retries) — matches the shared base's MAX_ATTEMPTS.
    expect(vi.mocked(fetch).mock.calls.length).toBe(3);
  });

  it('returns an error outcome when the API responds 200 with an error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'Slow down' })),
    );

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
    });

    expect(results[0]?.ok).toBe(false);
  });

  it('retries a piece missing from the batch response individually before giving up', async () => {
    // First call returns results for only 1 of 2 pieces sent; the repair
    // pass retries the missing one alone.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ translatedText: ['hola'] }))
      .mockResolvedValueOnce(jsonResponse({ translatedText: ['mundo'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello'], ['world']],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results).toEqual([
      { ok: true, value: ['hola'] },
      { ok: true, value: ['mundo'] },
    ]);
  });

  it('shares one HTTP request across identical concurrent pieces (dedupe)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: ['hola'] }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const [batchA, batchB] = await Promise.all([
      provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] }),
      provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(batchA).toEqual([{ ok: true, value: ['hola'] }]);
    expect(batchB).toEqual([{ ok: true, value: ['hola'] }]);
  });
});
