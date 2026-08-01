import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLibreTranslateProvider } from './libretranslate';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('createLibreTranslateProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a well-formed request and returns the translated text', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: 'hola' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const result = await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    expect(result).toEqual({ ok: true, value: 'hola' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://example.com/translate');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ q: 'hello', source: 'en', target: 'es', format: 'text' });
  });

  it('includes api_key in the request body when configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translatedText: 'hola' }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com', apiKey: 'secret-key' });
    await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.api_key).toBe('secret-key');
  });

  it('returns a network error result when fetch itself rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('DNS lookup failed');
      }),
    );

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const result = await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      expect(result.error.message).toContain('DNS lookup failed');
    }
  });

  it('returns an http error result on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 503)));

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const result = await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('http');
  });

  it('returns an http error result when the API responds 200 with an error field', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Slow down' })));

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const result = await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('http');
      expect(result.error.message).toBe('Slow down');
    }
  });

  it('returns a parse error result when the response body is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not json', { status: 200 })),
    );

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const result = await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
  });

  it('returns a parse error result when translatedText is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ someOtherField: true })));

    const provider = createLibreTranslateProvider({ baseUrl: 'https://example.com' });
    const result = await provider.translate({ text: 'hello', sourceLanguage: 'en', targetLanguage: 'es' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
  });
});
