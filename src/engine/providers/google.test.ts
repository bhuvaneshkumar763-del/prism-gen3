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

  it('pads a single-item piece with a throwaway string so it is sent WITH <a i=N> wrapping, then trims the throwaway back off', async () => {
    // transformPiece only wraps a piece in <a i=N> when it has >1 string,
    // and Google's endpoint doesn't reliably translate a piece sent bare —
    // see transformPiece's doc comment. createGoogleProvider's
    // translateBatch pads any single-string piece with a throwaway ' '
    // before handing it to the shared HTTP machinery, so it always lands on
    // the reliably-wrapped path, then trims the throwaway result back off.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>hola</a><a i=1> </a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toEqual([{ ok: true, value: ['hola'] }]);
    const translateCall = fetchMock.mock.calls[1];
    if (!translateCall) throw new Error('translate request was not made');
    const [, init] = translateCall as unknown as [string, RequestInit];
    const [payload] = JSON.parse(init.body as string) as [[string[], string, string], string];
    expect(payload[0]).toEqual(['<pre><a i=0>hello</a><a i=1> </a></pre>']); // padded to 2 items, so <a i=N> wrapping kicks in
  });

  it('reconstructs the full translation when Google reflows content into the padding slot, instead of silently dropping it (real bug, confirmed against the live endpoint)', async () => {
    // Real, confirmed behavior: Google can reflow translated content across
    // piece/tag boundaries (this file's own header comment documents it for
    // genuine multi-string pieces) — it also happens to the throwaway
    // padding above. Live repro: "Apple iPhone 15 Pro Max" (source forced
    // to a different language, as a real mixed-language page would have)
    // came back with "Max" split into the padding's own <a i=1> slot, with
    // an untagged orphan space folded into index 0 by splitPieceResponse's
    // own existing rule — exactly reproduced here.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>Apple iPhone 15 Pro </a><a i=1>Max</a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'zh',
      targetLanguage: 'en',
      pieces: [['Apple iPhone 15 Pro Max']],
    });

    expect(results).toEqual([{ ok: true, value: ['Apple iPhone 15 Pro Max'] }]);
  });

  it('preserves a real trailing space on the translated text, instead of stripping it along with the padding filler (real regression, found via a later audit of the reflow fix above)', async () => {
    // "Hello " (a real trailing space — e.g. the text node right before
    // <b>world</b> in "Hello <b>world</b>.") is exactly the shape that
    // gets padded (piece.length === 1). The earlier fix for the reflow bug
    // above used `.join('').trimEnd()`, which correctly discarded the
    // padding's own echoed space in the ordinary (nothing-reflowed) case —
    // but also silently ate the REAL trailing space that belonged to
    // "Hello " itself, since trimEnd() can't tell the two apart. Spliced
    // into the DOM, that jammed adjacent inline content together
    // ("HelloWorld" instead of "Hello World"). splitPieceResponse's own
    // orphan-folding rule already gives index 0 its own correct trailing
    // space here — the fix must leave it untouched when nothing reflowed,
    // not trim it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>Bonjour </a><a i=1> </a>'], ['fr']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      pieces: [['Hello ']],
    });

    expect(results).toEqual([{ ok: true, value: ['Bonjour '] }]);
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

  it('flags a response that echoes the original back untranslated, instead of accepting it', async () => {
    // Regression: isSuspiciousOutcome used to be handed the WIRE text
    // (`<pre>…</pre>`-wrapped by transformPiece) and compared against the
    // unwrapped response, so the two could never be equal and the
    // echoed-back-untranslated check was silently inert for Google
    // specifically. Long enough to clear MIN_SUSPICIOUS_IDENTICAL_LENGTH (40).
    const echoed = 'This sentence is definitely long enough to cross the forty character mark.';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([[echoed], ['en']]))
      // The suspicious result triggers a one-shot individual retry; echo again.
      .mockResolvedValueOnce(jsonResponse([[echoed], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [[echoed]],
    });

    expect(results[0]?.ok).toBe(false);
  });

  it('keeps orphan text that arrives before the first <a i=N> tag', async () => {
    // Google prepends punctuation for some target languages (Spanish '¿').
    // That leading untagged text has no preceding index to fold into and
    // used to be dropped outright.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['¿<a i=0>Como estas</a> <a i=1>hoy</a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['How are you', 'today']],
    });

    expect(results[0]).toEqual({ ok: true, value: ['¿Como estas ', 'hoy'] });
  });

  it('returns the translation for a single-string piece under dontSortResults (now always tagged, since it gets padded to 2 items)', async () => {
    // A single-string piece is padded to 2 items before being sent (see the
    // padding test above), so the response comes back tagged even under
    // dontSortResults. The dontSortResults branch pushed only on tagged
    // tokens, so an untagged response used to return [] here — a
    // successful-looking outcome with the translation silently gone; that
    // shape can no longer happen for a piece this provider originated.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>hola</a><a i=1> </a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello']],
      dontSortResults: true,
    });

    expect(results[0]).toEqual({ ok: true, value: ['hola'] });
  });

  it('does not splice raw <a i=…> markup into the page when the response cannot be tokenized', async () => {
    // If Google ever emits inline tags inside a segment, the tokenizer
    // matches nothing; returning the raw HTML verbatim would render literal
    // markup as visible page text. Treat it as a failed parse instead.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValue(jsonResponse([['<a i=0>Hola <b>mundo</b></a>'], ['en']]));
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello', 'world']],
    });

    const value = results[0]?.ok ? results[0].value : [];
    expect(value.join('')).not.toContain('<a i=');
  });

  it('re-scrapes the auth key after 5 minutes when the last scrape fell back to the spare key', async () => {
    // The fallback path sets translateAuth (to the spare key) AND
    // authNotFound together. Checking translateAuth first made the
    // retry-sooner window unreachable, so a failed scrape stayed on the
    // spare key for the full 20 minutes instead of 5.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const noKeyScrape = () => new Response('nothing useful here', { status: 200 });
      const fetchMock = vi.fn(async (url: string) =>
        String(url).includes('translate_http') ? noKeyScrape() : jsonResponse([['hola'], ['en']]),
      );
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const req = { sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] };

      await provider.translateBatch(req);
      const scrapesAfterFirst = fetchMock.mock.calls.filter((c) => String(c[0]).includes('translate_http')).length;

      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await provider.translateBatch(req);
      const scrapesAfterSecond = fetchMock.mock.calls.filter((c) => String(c[0]).includes('translate_http')).length;

      expect(scrapesAfterFirst).toBe(1);
      expect(scrapesAfterSecond).toBe(2);
    } finally {
      vi.useRealTimers();
    }
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

  describe('auth-key persistence seam (hydrateAuthKey/getAuthKeySnapshot/ensureAuthReady)', () => {
    // Real gap this closes, found via a speed audit: the scraped auth key
    // used to live in module memory only, lost on every MV3 service-worker
    // restart — these three plain-data functions are the seam
    // entrypoints/background.ts persists through (src/engine/ can't touch
    // browser.storage itself, see guard:engine-purity).
    it('getAuthKeySnapshot() is undefined before anything has been scraped or hydrated', async () => {
      vi.resetModules();
      const { getAuthKeySnapshot } = await import('./google');
      expect(getAuthKeySnapshot()).toBeUndefined();
    });

    it('hydrateAuthKey() seeds state that ensureAuthReady() then reuses instead of re-scraping', async () => {
      vi.resetModules();
      const { hydrateAuthKey, getAuthKeySnapshot, ensureAuthReady } = await import('./google');
      const fetchMock = vi.fn(); // must NOT be called — a fresh hydration should be used as-is
      vi.stubGlobal('fetch', fetchMock);

      hydrateAuthKey({ key: 'hydrated-key', notFound: false, time: Date.now() });
      await ensureAuthReady();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(getAuthKeySnapshot()).toEqual({ key: 'hydrated-key', notFound: false, time: expect.any(Number) });
    });

    it('ensureAuthReady() scrapes and getAuthKeySnapshot() reflects the result when nothing was hydrated', async () => {
      vi.resetModules();
      const { getAuthKeySnapshot, ensureAuthReady } = await import('./google');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(authScrapeResponse()));

      await ensureAuthReady();

      expect(getAuthKeySnapshot()).toEqual({
        key: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        notFound: false,
        time: expect.any(Number),
      });
    });

    it('a stale hydrated snapshot (older than the 20-minute cache window) still triggers a fresh scrape', async () => {
      vi.resetModules();
      const { hydrateAuthKey, ensureAuthReady } = await import('./google');
      const fetchMock = vi.fn().mockResolvedValueOnce(authScrapeResponse());
      vi.stubGlobal('fetch', fetchMock);

      hydrateAuthKey({ key: 'stale-key', notFound: false, time: Date.now() - 25 * 60 * 1000 });
      await ensureAuthReady();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
