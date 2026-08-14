import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlmProvider } from './llm';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function chatResponse(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('createLlmProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends a numbered-segment prompt and parses the JSON array response', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(chatResponse(JSON.stringify(['hola', 'mundo']))));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLlmProvider({
      baseUrl: 'https://api.openai.com/v1/chat/completions',
      apiKey: 'k',
      model: 'gpt-4o-mini',
    });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello'], ['world']],
    });

    expect(results).toEqual([
      { ok: true, value: ['hola'] },
      { ok: true, value: ['mundo'] },
    ]);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages[0].content).toContain('[0]: hello');
    expect(body.messages[0].content).toContain('[1]: world');
  });

  it('strips markdown code-fence wrapping before parsing JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(chatResponse('```json\n["hola"]\n```'))),
    );

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
  });

  it('round-trips a multi-string piece through the separator', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(chatResponse(JSON.stringify(['hola␟mundo'])))),
    );

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello', 'world']],
    });

    expect(results).toEqual([{ ok: true, value: ['hola', 'mundo'] }]);
  });

  it('treats a non-string array entry as empty, which the sanity-check repair pass then retries once', async () => {
    // A non-string entry (malformed model output) maps to '' per
    // parseResponse — for real (non-empty) input, an empty result is
    // exactly the failure signature Phase 5's isSuspiciousOutcome() exists
    // to catch, so this now retries once (batchedHttpProvider.ts's
    // existing repair path) rather than silently accepting the empty
    // string as a successful translation.
    const fetchMock = vi.fn(async () => jsonResponse(chatResponse(JSON.stringify([42]))));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    // The retry hits the same mock and gets the same malformed response
    // again, so it ultimately resolves as a failure rather than a false
    // "successfully translated to an empty string."
    expect(results[0]).toEqual({ ok: false, error: { kind: 'network', message: '[llm] no result for this piece' } });
    expect(fetchMock).toHaveBeenCalledTimes(2); // original attempt + one individual retry
  });

  it('returns an error outcome when the model response is not valid JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(chatResponse('not json at all'))),
    );

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results[0]?.ok).toBe(false);
  });

  it('omits the "from <lang>" clause in the prompt when sourceLanguage is auto', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(chatResponse(JSON.stringify(['hola']))));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    await provider.translateBatch({ sourceLanguage: 'auto', targetLanguage: 'es', pieces: [['hello']] });

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch was not called');
    const [, init] = call as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).not.toContain('from auto');
  });

  it('returns an error outcome when the model returns valid JSON that is not an array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(chatResponse(JSON.stringify({ not: 'an array' })))),
    );

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results[0]?.ok).toBe(false);
  });

  it('returns an error outcome when the response has no choices/content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ choices: [] })),
    );

    const provider = createLlmProvider({ baseUrl: 'https://example.com', apiKey: 'k', model: 'm' });
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results[0]?.ok).toBe(false);
  });
});
