import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGoogleCloudTranslateProvider } from './googleCloudTranslate';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createGoogleCloudTranslateProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the API key in the query string and returns translated text', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { translations: [{ translatedText: 'hola', detectedSourceLanguage: 'en' }] } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGoogleCloudTranslateProvider({ apiKey: 'my-key' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toContain('key=my-key');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ q: ['hello'], source: 'en', target: 'es', format: 'text' });
  });

  it('omits the source field for auto-detected source language', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: { translations: [{ translatedText: 'hola' }] } }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGoogleCloudTranslateProvider({ apiKey: 'my-key' });
    await provider.translateBatch({ sourceLanguage: 'auto', targetLanguage: 'es', pieces: [['hello']] });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.source).toBeUndefined();
  });

  it('round-trips a multi-string piece through the separator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: { translations: [{ translatedText: 'hola␟mundo' }] } })),
    );

    const provider = createGoogleCloudTranslateProvider({ apiKey: 'k' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello', 'world']],
    });

    expect(results).toEqual([{ ok: true, value: ['hola', 'mundo'] }]);
  });

  it("escapes a literal separator character INSIDE a node's own text before joining — see llm.ts's identical test for the full reasoning: an unescaped literal separator in page text produced more wire parts than nodes, silently misaligning every subsequent node's translation", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const wireText: string = body.q[0];
      const realSeparatorCount = (wireText.match(/␟/gu) ?? []).length;
      expect(realSeparatorCount).toBe(1);
      return jsonResponse({ data: { translations: [{ translatedText: 'TRANS_A␟TRANS_B' }] } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGoogleCloudTranslateProvider({ apiKey: 'k' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['a␟b', 'c']],
    });

    expect(results).toEqual([{ ok: true, value: ['TRANS_A', 'TRANS_B'] }]);
  });

  it('returns an error outcome when the API responds with an error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: { message: 'Invalid key' } })),
    );

    const provider = createGoogleCloudTranslateProvider({ apiKey: 'bad-key' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results[0]?.ok).toBe(false);
  });
});
