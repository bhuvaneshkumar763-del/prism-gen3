import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function authScrapeResponse(): Response {
  return new Response('...  "x-goog-api-key": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"  ...', { status: 200 });
}

/**
 * google.ts caches its auth key at module scope (lastRequestAuthTime/
 * translateAuth), so every test re-imports the module fresh via
 * vi.resetModules() to avoid one test's scraped/fallback key leaking into
 * the next.
 */
async function freshCreateGoogleProvider() {
  vi.resetModules();
  const { createGoogleProvider } = await import('./google');
  return createGoogleProvider();
}

describe('createGoogleProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scrapes the live auth key, then sends a single-item batch WITHOUT <a i=N> wrapping', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['hola'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
    const translateCall = fetchMock.mock.calls[1];
    if (!translateCall) throw new Error('translate request was not made');
    const [, init] = translateCall as unknown as [string, RequestInit];
    const [payload] = JSON.parse(init.body as string) as [[string[], string, string], string];
    expect(payload[0]).toEqual(['<pre>hello</pre>']); // no <a i=N> wrapping for a single-item batch
  });

  it('wraps a multi-string piece (grouped context) in <a i=N> and reassembles by index', async () => {
    // One piece holding 2 related strings (e.g. grouped sibling DOM
    // nodes) — this is the ">1 item" case that triggers <a i=N> wrapping,
    // NOT ">1 piece in the batch" (see transformPiece/splitPieceResponse
    // doc comments in google.ts: the tags scope to one piece's own
    // strings, not across separate top-level pieces).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>Bonjour</a> <a i=1>Monde</a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      pieces: [['hello', 'world']],
    });

    // The space between the two tags is untagged "orphan" text, which
    // folds into the nearest PRECEDING tagged index (see google.ts's
    // header comment on the real en->fr request this was derived from).
    expect(results).toEqual([{ ok: true, value: ['Bonjour ', 'Monde'] }]);

    const translateCall = fetchMock.mock.calls[1];
    if (!translateCall) throw new Error('translate request was not made');
    const [, init] = translateCall as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as [[string[], string, string], string];
    expect(payload[0][0]).toEqual(['<pre><a i=0>hello</a><a i=1>world</a></pre>']);
  });

  it('falls back to the hardcoded key when the live auth scrape fails, and still translates', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(jsonResponse([['hola'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
  });

  it('honors dontSortResults, folding orphan text into the FOLLOWING tag in appearance order', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>Bonjour</a> <a i=1>Monde</a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      pieces: [['hello', 'world']],
      dontSortResults: true,
    });

    expect(results).toEqual([{ ok: true, value: ['Bonjour', ' Monde'] }]);
  });

  it('appends (rather than overwrites) when an index appears more than once — a real reflow case', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>Foo</a><a i=0>Bar</a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      pieces: [['hello', 'world']],
    });

    expect(results).toEqual([{ ok: true, value: ['Foo Bar'] }]);
  });

  it('falls back to returning the raw (unescaped) text when the response has no <a i=N> tags at all', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<pre>Hola</pre>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['Hola'] }]);
  });

  it('maps the "prs" source/target language quirk to fa-AF before sending', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['hola'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    await provider.translateBatch({ sourceLanguage: 'prs', targetLanguage: 'es', pieces: [['hello']] });

    const translateCall = fetchMock.mock.calls[1];
    if (!translateCall) throw new Error('translate request was not made');
    const [, init] = translateCall as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as [[string[], string, string], string];
    expect(payload[0][1]).toBe('fa-AF');
  });
});
