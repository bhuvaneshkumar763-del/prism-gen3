import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PieceOutcome } from '../translator';

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

  it('reconstructs the raw reflowed text when an index appears more than once (a real reflow case), for the case nothing else repairs it', async () => {
    // splitPieceResponse's own reconstruction (append rather than
    // overwrite when an index recurs) is still exercised directly here —
    // this is the raw decode, before the grouping-repair mechanism (see
    // the describe block below) decides whether to accept or repair it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(authScrapeResponse())
      .mockResolvedValueOnce(jsonResponse([['<a i=0>Foo</a><a i=0>Bar</a>'], ['en']]))
      // The piece is genuinely grouped (2 strings) and this reflowed
      // response only decodes to 1 entry — the grouping-repair mechanism
      // (see below) detects the shape mismatch and repairs it via 2
      // individual re-requests, bundled into one HTTP call.
      .mockResolvedValueOnce(
        jsonResponse([
          ['<a i=0>Foo2</a><a i=1> </a>', '<a i=0>Bar2</a><a i=1> </a>'],
          ['en', 'en'],
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const provider = await freshCreateGoogleProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      pieces: [['hello', 'world']],
    });

    // Repaired, not the raw (wrong-shape, 1-entry) reflowed reconstruction.
    expect(results).toEqual([{ ok: true, value: ['Foo2', 'Bar2'] }]);
  });

  describe('grouped-piece reflow repair (sentence-context grouping reopened this risk)', () => {
    // Real risk this closes: re-enabling batchingHint for Google (below)
    // means request.pieces can genuinely hold a multi-node group — several
    // sibling DOM text nodes sent together for sentence context. This
    // file's header comment already documents that Google can reflow
    // translated content across a piece's own <a i=N> boundaries for some
    // language pairs — content from one node merging into a neighboring
    // node's index. A reflowed response decodes to FEWER entries than
    // nodes were sent (byIndex collapses two node-indices into one Map
    // key) — that shape mismatch is the trigger for an immediate, contained
    // per-node repair, never the generic missing/suspicious retry (which
    // would just resend the same multi-item wire text and could reflow
    // again indefinitely).
    it('repairs a grouped piece via individual per-node re-requests when Google reflows content across node boundaries, instead of silently losing a node', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        .mockResolvedValueOnce(jsonResponse([['<a i=0>Foo</a><a i=0>Bar</a>'], ['en']]))
        .mockResolvedValueOnce(
          jsonResponse([
            ['<a i=0>Konnichiwa</a><a i=1> </a>', '<a i=0>Sekai</a><a i=1> </a>'],
            ['en', 'en'],
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        pieces: [['hello', 'world']],
      });

      expect(results).toEqual([{ ok: true, value: ['Konnichiwa', 'Sekai'] }]);
      expect(fetchMock).toHaveBeenCalledTimes(3); // auth scrape + grouped attempt + one bundled repair request
    });

    it('repairs a grouped piece when the entry COUNT is intact but content moved across node boundaries — real user report (sangtacviet.vip facet chips): the response decoded to exactly the right number of entries with no leaked markers, so both older signals passed it, while one chip held "System (192673) Fantasy (" and the next held only "189348)"', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        // Two entries for two nodes — count matches, markers parsed
        // cleanly — but the first absorbed the head of the second.
        .mockResolvedValueOnce(jsonResponse([['<a i=0>System (192673) Fantasy (</a><a i=1>189348)</a>'], ['vi']]))
        .mockResolvedValueOnce(
          jsonResponse([
            ['<a i=0>System (192673)</a><a i=1> </a>', '<a i=0>Fantasy (189348)</a><a i=1> </a>'],
            ['vi', 'vi'],
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        pieces: [['Hệ Thống(192673)', 'Huyền Huyễn(189348)']],
      });

      expect(results).toEqual([{ ok: true, value: ['System (192673)', 'Fantasy (189348)'] }]);
      expect(fetchMock).toHaveBeenCalledTimes(3); // auth scrape + grouped attempt + one bundled repair request
    });

    it("leaves a clean grouped response alone — the same page's known-good translation must not trigger a needless repair", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        .mockResolvedValueOnce(jsonResponse([['<a i=0>System (192673)</a><a i=1>Fantasy (189348)</a>'], ['vi']]));
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'vi',
        targetLanguage: 'en',
        pieces: [['Hệ Thống(192673)', 'Huyền Huyễn(189348)']],
      });

      expect(results).toEqual([{ ok: true, value: ['System (192673)', 'Fantasy (189348)'] }]);
      expect(fetchMock).toHaveBeenCalledTimes(2); // auth scrape + the one grouped attempt, no repair
    });

    it("repairs a grouped piece when Google reflows a MIDDLE index away, not just the last one — real bug, found via a round-6 audit: splitPieceResponse's index-assigned array is sparse, so .length is maxIndex+1, not the entry count; needsRepair used to compare that against the original piece length, which only catches the LAST index disappearing. A dropped middle index left a hole .length doesn't see, so no repair fired, the neighboring index silently absorbed the merged content, and the holed index came back undefined — treated as missing and retranslated on its own, so the page showed the merged clause AND a duplicate of it", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        // Index 1's translation merges into index 0 (Google reflow), but
        // index 2 still appears distinctly — <a i=0>...</a><a i=2>...</a>,
        // no <a i=1> at all. byIndex = {0: 'MergedAB', 2: 'C'}; the
        // sparse-assigned result array has length 3 (from the highest
        // index, 2) but only 2 real entries — exactly the shape `.length`
        // alone can't distinguish from "all 3 indices present".
        .mockResolvedValueOnce(jsonResponse([['<a i=0>MergedAB</a><a i=2>C</a>'], ['en']]))
        .mockResolvedValueOnce(
          jsonResponse([
            ['<a i=0>RepA</a><a i=1> </a>', '<a i=0>RepB</a><a i=1> </a>', '<a i=0>RepC</a><a i=1> </a>'],
            ['en', 'en', 'en'],
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        pieces: [['a1', 'a2', 'a3']],
      });

      expect(results).toEqual([{ ok: true, value: ['RepA', 'RepB', 'RepC'] }]);
      expect(fetchMock).toHaveBeenCalledTimes(3); // auth scrape + grouped attempt + one bundled repair request
    });

    it('does NOT repair a safe grouped response (indices appear once each, in order) — no extra request', async () => {
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

      expect(results).toEqual([{ ok: true, value: ['Bonjour ', 'Monde'] }]);
      expect(fetchMock).toHaveBeenCalledTimes(2); // no repair request
    });

    it('propagates a genuine failure from the repair itself, rather than silently returning the reflowed original', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        .mockResolvedValueOnce(jsonResponse([['<a i=0>Foo</a><a i=0>Bar</a>'], ['en']]))
        .mockResolvedValue(new Response('server error', { status: 500 })); // repair keeps failing
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        pieces: [['hello', 'world']],
      });

      expect(results[0]?.ok).toBe(false);
    });

    it('delivers the repaired value via onPieceComplete, never the raw reflowed intermediate one (no garbled-text flash)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        .mockResolvedValueOnce(jsonResponse([['<a i=0>Foo</a><a i=0>Bar</a>'], ['en']]))
        .mockResolvedValueOnce(
          jsonResponse([
            ['<a i=0>Konnichiwa</a><a i=1> </a>', '<a i=0>Sekai</a><a i=1> </a>'],
            ['en', 'en'],
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const seen: PieceOutcome[] = [];
      await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        pieces: [['hello', 'world']],
        onPieceComplete: (_index, outcome) => {
          seen.push(outcome);
        },
      });

      // Exactly one call — the raw reflowed shape must never reach the
      // incremental-write-back callback, only the final repaired result.
      expect(seen).toHaveLength(1);
      expect(seen[0]).toEqual({ ok: true, value: ['Konnichiwa', 'Sekai'] });
    });

    // Real corruption found via live verification against Wikipedia, not
    // theorized: a large, citation-heavy group's response had its tag
    // structure break partway through (the tokenizer's regex requires a
    // tag's own content to contain no further `<`, so a malformed/nested
    // occurrence stops it matching) — everything from that point folded in
    // as untagged "orphan" text, literal `<a i=N>` markup and all, onto
    // the nearest preceding index. The reconstructed array's LENGTH still
    // matched what was sent in this exact case (a later index still got
    // assigned, padding `.length` back up even though an earlier slot
    // absorbed the leak as a hole) — so the length-mismatch check alone
    // missed it; only a direct scan for leaked marker syntax in the
    // decoded text catches this shape.
    it('repairs a grouped piece whose response leaked literal <a i=N> marker text into a slot, even when the array LENGTH still happens to match what was sent', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        // Constructed to reproduce the exact live failure shape: tag 0
        // matches cleanly, then "<a i=1>Bar" never closes properly (a
        // nested "<a i=2>" appears before its own "</a>"), so the
        // tokenizer's regex skips ahead and matches "<a i=2>Baz</a>"
        // instead — leaving "<a i=1>Bar" as raw orphan text folded onto
        // index 0, while index 2 is real. Decodes to a 3-length array
        // (index 2 pads .length up) with index 1 an empty hole and index
        // 0 carrying the literal leaked markup — length 3 matches the
        // 3-node piece sent below despite the corruption.
        .mockResolvedValueOnce(jsonResponse([['<a i=0>Foo</a><a i=1>Bar<a i=2>Baz</a>'], ['en']]))
        .mockResolvedValueOnce(
          jsonResponse([
            ['<a i=0>Un</a><a i=1> </a>', '<a i=0>Deux</a><a i=1> </a>', '<a i=0>Trois</a><a i=1> </a>'],
            ['en', 'en', 'en'],
          ]),
        );
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'fr',
        pieces: [['one', 'two', 'three']],
      });

      expect(results).toEqual([{ ok: true, value: ['Un', 'Deux', 'Trois'] }]);
      // No literal marker syntax anywhere in the final result.
      const flat = results[0]?.ok ? results[0].value.join('') : '';
      expect(flat).not.toMatch(/<a i=\d+>|<\/a>/);
    });

    it('leaves a padded single-string piece alone — the repair mechanism must not double-handle the existing padding-reflow case', async () => {
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
      expect(fetchMock).toHaveBeenCalledTimes(2); // no repair request — handled by the existing padding-unwrap path
    });

    it("resolves several simultaneous repairs correctly, all routed through one shared Promise.all instead of one-at-a-time — real finding while testing this: onPieceComplete already dispatches every repair concurrently the instant its raw outcome is known (before the final reconciliation loop even runs), so a sequential vs. parallel await here makes NO measurable timing difference in this exact scenario — a delayed-response variant of this same setup passed identically before AND after switching the loop to Promise.all. This test therefore checks correctness (every simultaneously-needed repair still resolves to the right value, not just the first/last one), not a timing claim this codebase's own dispatch order doesn't actually let it prove", async () => {
      let translateCalls = 0;
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes('translate_http')) return authScrapeResponse();
        translateCalls++;
        if (translateCalls === 1) {
          // The main grouped attempt: 3 two-node pieces, each reflowed
          // down to a single decoded entry — all 3 need repair.
          return jsonResponse([
            ['<a i=0>ReflowedA</a>', '<a i=0>ReflowedB</a>', '<a i=0>ReflowedC</a>'],
            ['en', 'en', 'en'],
          ]);
        }
        // A repair() call for a 2-string original piece re-sends it as TWO
        // single-item pieces (see repair()'s own doc comment), each of
        // which this file's own single-item padding then wraps again — so
        // the wire request has 2 padded pieces, needing 2 response entries
        // here, not 1. Each repair gets a DIFFERENT result so a mixed-up
        // index assignment (e.g. Promise.all results applied to the wrong
        // original index) would be caught.
        const label = ['A', 'B', 'C'][translateCalls - 2] ?? '?';
        return jsonResponse([
          [`<a i=0>Repaired${label}1</a><a i=1> </a>`, `<a i=0>Repaired${label}2</a><a i=1> </a>`],
          ['en', 'en'],
        ]);
      });
      vi.stubGlobal('fetch', fetchMock);

      const provider = await freshCreateGoogleProvider();
      const results = await provider.translateBatch({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        pieces: [
          ['a1', 'a2'],
          ['b1', 'b2'],
          ['c1', 'c2'],
        ],
      });

      expect(results).toEqual([
        { ok: true, value: ['RepairedA1', 'RepairedA2'] },
        { ok: true, value: ['RepairedB1', 'RepairedB2'] },
        { ok: true, value: ['RepairedC1', 'RepairedC2'] },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(5); // auth scrape + main attempt + 3 repairs
    });
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

  describe("auth-key reliability fixes — a stale/rejected key used to silently degrade translation into a no-op for up to 20 minutes at a time, found live during this exact repo's own testing", () => {
    it('invalidates the cached auth key immediately on a genuine 401, instead of resending it for the rest of the normal cache window — real bug this closed: a rejected key used to keep being resent until the 20-minute wall-clock cache expired, with no way for the provider to react to the rejection itself', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(authScrapeResponse())
        .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
        .mockResolvedValueOnce(authScrapeResponse())
        .mockResolvedValueOnce(jsonResponse([['<a i=0>hola</a><a i=1> </a>'], ['en']]));
      vi.stubGlobal('fetch', fetchMock);

      const { createGoogleProvider, getAuthKeySnapshot } = await import('./google');
      const provider = createGoogleProvider();
      const req = { sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] };

      await provider.translateBatch(req);
      // Cleared immediately by the 401 — not left holding the now-rejected
      // key for the rest of its normal 20-minute cache window.
      expect(getAuthKeySnapshot()).toBeUndefined();

      await provider.translateBatch(req);
      const scrapeCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('translate_http'));
      expect(scrapeCalls).toHaveLength(2); // re-scraped instead of resending the rejected key
    });

    it("forces an immediate auth-key re-scrape once a sustained run of suspicious results crosses the reclassification threshold — the real live shape a broken/exhausted key actually takes (silently echoing everything back) rather than a clean 401, which the fix above alone wouldn't catch", async () => {
      // Long enough to clear MIN_SUSPICIOUS_IDENTICAL_LENGTH and identical
      // to the source — the same echoed-back-untranslated shape as the
      // existing "flags a response that echoes the original back
      // untranslated" test above, repeated enough times to fill the
      // shared rolling window.
      const echoed = 'This sentence is definitely long enough to cross the forty character mark.';
      const fetchMock = vi.fn(async (url: string) =>
        String(url).includes('translate_http') ? authScrapeResponse() : jsonResponse([[echoed], ['en']]),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { createGoogleProvider, getAuthKeySnapshot } = await import('./google');
      const provider = createGoogleProvider();

      for (let i = 0; i < 30; i++) {
        await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [[echoed]] });
      }

      // The 30th sample fills the shared window at a 100% suspicious
      // ratio — well over threshold — which invalidates the cached key
      // immediately instead of only reporting the problem after the fact.
      expect(getAuthKeySnapshot()).toBeUndefined();
    });
  });

  describe("auth-scrape backstop — real bug this closed: findAuth()'s fetch() had no timeout at all, and memoized its in-flight promise into module scope, only clearing it in a finally that runs after that promise SETTLES — so a fetch that never settles (the same real WebKit gap batchedHttpProvider.ts's sendOnce() backstop was built for) permanently blocked every future translateBatch() call, for the rest of this background context's life, not just the first one", () => {
    it("doesn't permanently hang translateBatch() when the auth-scrape fetch never settles — and a later, unrelated translateBatch() call still completes, proving authPromise wasn't left poisoned", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (String(url).includes('translate_http')) {
          // Simulates the real gap this closed: the scrape request never
          // resolves or rejects at all, regardless of any abort signal —
          // exactly like sendOnce()'s own regression test simulates for
          // the translate request itself.
          return new Promise<Response>(() => {});
        }
        return jsonResponse([['hola'], ['en']]);
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.useFakeTimers();
      try {
        const { createGoogleProvider } = await import('./google');
        const provider = createGoogleProvider();

        const firstResultPromise = provider.translateBatch({
          sourceLanguage: 'en',
          targetLanguage: 'es',
          pieces: [['hello']],
        });
        // Comfortably past AUTH_SCRAPE_TIMEOUT_MS(10s) + the backstop's own
        // 500ms margin — this call must settle on its own.
        await vi.advanceTimersByTimeAsync(15000);
        const firstResults = await firstResultPromise;
        // The scrape timing out falls back to the hardcoded key (the same
        // existing fallback path a real scrape failure already takes), so
        // the actual translate request still goes out and succeeds.
        expect(firstResults[0]?.ok).toBe(true);

        // The real assertion: a second, later call doesn't inherit a
        // permanently-hung authPromise — it completes too, instead of
        // awaiting the same dead scrape forever.
        const secondResultPromise = provider.translateBatch({
          sourceLanguage: 'en',
          targetLanguage: 'es',
          pieces: [['hi']],
        });
        await vi.advanceTimersByTimeAsync(1000);
        const secondResults = await secondResultPromise;
        expect(secondResults[0]?.ok).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("clears BOTH of findAuth()'s timers (the AbortController one and its own backstop) once a normal scrape settles — hygiene fix, found via a round-6 audit: the backstop's own setTimeout was never cleared, leaving one armed for AUTH_SCRAPE_TIMEOUT_MS+500ms past every ordinary successful scrape. No functional effect (its reject() lands on an already-settled Promise.race, a silent no-op) — asserted directly via the fake-timer queue, since there's no other observable difference to check", async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(authScrapeResponse())
          .mockResolvedValueOnce(jsonResponse([['hola'], ['en']]));
        vi.stubGlobal('fetch', fetchMock);

        const provider = await freshCreateGoogleProvider();
        await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
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
