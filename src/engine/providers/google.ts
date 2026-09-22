import { err, ok } from '../../shared/result';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';
import { escapeHTML, unescapeHTML } from './htmlEscape';
import { hasBoundaryReflow } from './reflowIntegrity';

/**
 * Google provider — an undocumented, reverse-engineered endpoint
 * (`translate-pa.googleapis.com`). Behavior (the `<pre><a i=N>` marker
 * scheme, the auth-key scrape, the hardcoded fallback key) is preserved
 * exactly rather than "cleaned up" — this is what actually works against a
 * real third-party endpoint we don't control, not a design choice to
 * relitigate. Rebuilt fresh against `fetch` instead of an XHR shim (MV3
 * service workers lack real XHR; `fetch` doesn't have that problem, so no
 * shim is needed here at all).
 *
 * The `<a i=N>`-only-when->1-item quirk (see `transformPiece` below) is
 * the exact reason `titleTranslator.ts`-equivalent code will need a
 * throwaway-second-string workaround once Session 5 builds tab-title
 * translation — noted here so that lesson isn't lost before it's needed.
 */

let lastRequestAuthTime: number | null = null;
let translateAuth: string | null = null;
let authNotFound = false;
let authPromise: Promise<void> | null = null;

// Reliability fix, found via a live user report (Orion/iOS,
// sangtacviet.vip chapters) and confirmed by direct code reading — the
// most severe hang in this codebase, worse than the concurrency-gate leak
// `batchedHttpProvider.ts` was fixed for: `findAuth`'s `fetch()` below used
// to have NO timeout at all (not even a flawed AbortController-based one).
// `translateBatch` calls `await findAuth()` at the top of EVERY request,
// and `findAuth` memoizes its in-flight work into the module-scope
// `authPromise`, cleared only in a `finally` after that promise SETTLES —
// so if the fetch never settles (the same real WebKit gap `sendOnce`'s own
// backstop was built for; here plausibly worse, since this endpoint
// (`translate.googleapis.com`) is the EXACT SAME HOST this site's own
// heavy client-side translate calls hit repeatedly, per its own shipped
// JS, making connection contention specifically likely there),
// `authPromise` never gets cleared and every future `translateBatch()`
// call — on ANY site, for the rest of this background context's life —
// awaits that same permanently-pending promise. This can trigger on the
// very FIRST translate of a session (no prior success needed to "leak"
// anything), matching a live re-test that hung for minutes on a fresh app
// launch's first attempt. 10s is generous for what's just a small HTML
// page fetch, not a translation request.
const AUTH_SCRAPE_TIMEOUT_MS = 10000;

/** Plain data shape for persisting/restoring the scraped auth key — see `hydrateAuthKey`'s doc comment for why this exists. */
export interface AuthKeySnapshot {
  key: string;
  notFound: boolean;
  time: number;
}

/**
 * Real gap, found via a speed audit: `lastRequestAuthTime`/`translateAuth`/
 * `authNotFound` above are module-scope variables only, never persisted —
 * MV3 service workers suspend after ~30s idle and are fully re-executed on
 * wake, so this module's entire 20-minute in-memory cache rarely survives
 * between one translate action and the next (a user browsing normally goes
 * well past 30s idle in between), paying a full extra scrape fetch to
 * `translate.googleapis.com` before almost every real translation.
 *
 * This file can't touch `browser.storage` itself (`src/engine/` has a
 * CI-enforced zero-browser-API-import rule, `guard:engine-purity`) — these
 * two plain-data functions are the seam: `entrypoints/background.ts` reads/
 * writes `browser.storage.session` (cleared on browser close, appropriate
 * for a key meant to refresh every 20 minutes anyway) and calls
 * `hydrateAuthKey` to seed this module's state before the first real
 * `translateBatch` call, so a real service-worker restart doesn't have to
 * pay the scrape again if a still-fresh key was already found last time.
 */
export function hydrateAuthKey(snapshot: AuthKeySnapshot): void {
  translateAuth = snapshot.key;
  authNotFound = snapshot.notFound;
  lastRequestAuthTime = snapshot.time;
}

/** The current in-memory auth state, for `background.ts` to persist after a (re)scrape — `undefined` if nothing has ever been scraped or hydrated yet in this module instance. */
export function getAuthKeySnapshot(): AuthKeySnapshot | undefined {
  if (translateAuth === null || lastRequestAuthTime === null) return undefined;
  return { key: translateAuth, notFound: authNotFound, time: lastRequestAuthTime };
}

/**
 * Reliability fix, found via a live incident: `findAuth`'s cache normally
 * only re-scrapes on a wall-clock cutoff (20 minutes once a key was found,
 * 5 once a scrape came back empty) — fine for an ordinary refresh, but a
 * key that gets outright REJECTED (a real 401/403) or that's producing a
 * sustained run of suspicious-looking results (the endpoint's more likely
 * real failure mode: silently echoing everything back rather than a clean
 * rejection) needs the very next `translateBatch()` call to re-scrape
 * immediately, not wait out that window. Resetting `lastRequestAuthTime`
 * to `null` routes through `findAuth`'s own "never scraped before" branch
 * rather than adding a second cache-invalidation path; clearing
 * `translateAuth` too means a request that races ahead of the re-scrape
 * fails fast on an empty key instead of uselessly resending the one
 * that's already known bad.
 */
function invalidateAuth(): void {
  translateAuth = null;
  lastRequestAuthTime = null;
}

/**
 * Public wrapper around `findAuth` — lets `background.ts` kick the scrape
 * off speculatively at service-worker startup (in parallel with the
 * content script's own startup chain) instead of only lazily on the first
 * real `translateBatch` call, so the fetch's cost is hidden behind other
 * startup work rather than sitting serially on the critical path of the
 * first translation.
 */
export async function ensureAuthReady(): Promise<void> {
  await findAuth();
}

// Hardcoded fallback API key, used if the live scrape below fails. Encoded
// as bytes (matching the old repo) purely so it doesn't read as a
// plaintext secret to a casual grep of this file — it's Google's own
// public web-client key, not something sensitive to this project.
const FALLBACK_KEY_BYTES = [
  65, 73, 122, 97, 83, 121, 65, 84, 66, 88, 97, 106, 118, 122, 81, 76, 84, 68, 72, 69, 81, 98, 99, 112, 113, 48, 73,
  104, 101, 48, 118, 87, 68, 72, 109, 79, 53, 50, 48,
];

async function findAuth(): Promise<void> {
  if (authPromise) return authPromise;

  authPromise = (async () => {
    let shouldRefresh = false;
    if (lastRequestAuthTime) {
      const cutoff = new Date();
      // `authNotFound` must be checked BEFORE `translateAuth`: the fallback
      // path sets both (translateAuth = the hardcoded spare key, authNotFound
      // = true), so testing translateAuth first made the shorter
      // retry-sooner windows unreachable and left a failed scrape stuck on
      // the spare key for the full 20 minutes.
      if (authNotFound) cutoff.setMinutes(cutoff.getMinutes() - 5);
      else if (translateAuth) cutoff.setMinutes(cutoff.getMinutes() - 20);
      else cutoff.setMinutes(cutoff.getMinutes() - 1);
      if (cutoff.getTime() > lastRequestAuthTime) shouldRefresh = true;
    } else {
      shouldRefresh = true;
    }
    if (!shouldRefresh) return;

    lastRequestAuthTime = Date.now();
    const fallbackKey = new TextDecoder().decode(new Uint8Array(FALLBACK_KEY_BYTES));

    try {
      // See `AUTH_SCRAPE_TIMEOUT_MS`'s own doc comment above for why this
      // is raced against a plain `setTimeout`-based rejection rather than
      // just awaited directly — this fetch has no other caller-side bound,
      // unlike `batchedHttpProvider.ts`'s requests. Covers `response.text()`
      // too, not just `fetch()` itself — a stalled body read is the same
      // class of never-settles risk as a stalled `fetch()` call.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AUTH_SCRAPE_TIMEOUT_MS);
      // Hygiene fix, found via a round-6 audit: the backstop's own timer
      // (below) was never cleared, leaving one armed for
      // AUTH_SCRAPE_TIMEOUT_MS + 500ms past every scrape that settled
      // normally — harmless (its reject() lands on an already-settled
      // Promise.race), but untidy and unnecessary now that its handle is
      // captured here. Same fix as batchedHttpProvider.ts's sendOnce().
      let backstopTimeout: ReturnType<typeof setTimeout> | undefined;
      let text: string;
      try {
        text = await Promise.race([
          (async () => {
            const response = await fetch(
              'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main',
              { signal: controller.signal },
            );
            return await response.text();
          })(),
          new Promise<never>((_, reject) => {
            backstopTimeout = setTimeout(
              () => reject(new Error('Auth scrape timed out (backstop)')),
              AUTH_SCRAPE_TIMEOUT_MS + 500,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
        clearTimeout(backstopTimeout);
      }
      const match = text.length > 1 ? text.match(/['"]x-goog-api-key['"]\s*:\s*['"](\w{39})['"]/i) : null;
      if (match?.[1]) {
        translateAuth = match[1];
        authNotFound = false;
      } else {
        translateAuth = fallbackKey;
        authNotFound = true;
      }
    } catch (e) {
      console.error('[google] auth scrape failed', e);
      translateAuth = fallbackKey;
      authNotFound = true;
    }
  })();

  try {
    await authPromise;
  } finally {
    authPromise = null;
  }
}

// "prs" (Google's Dari/Afghan Persian code) maps to the standard fa-AF tag.
function fixLanguageCode(code: string): string {
  return code === 'prs' ? 'fa-AF' : code;
}

function transformPiece(strings: string[]): string {
  let arr = strings.map(escapeHTML);
  // Google's endpoint only reliably translates a batch wrapped in <a i=N>
  // markers when there's more than one item — a lone string sent bare
  // doesn't translate reliably. See the module header comment.
  if (arr.length > 1) {
    arr = arr.map((text, index) => `<a i=${index}>${text}</a>`);
  }
  return `<pre>${arr.join('')}</pre>`;
}

/**
 * Response parsing, derived from real requests made directly against this
 * endpoint (not templated from a reference implementation — see
 * docs/decisions/0004-provider-scope.md for why that mattered here).
 * Confirmed empirically:
 *
 * - A 2-piece request `en->fr` came back as
 *   `<a i=0>Il fait beau aujourd'hui.</a> <a i=1>J'aime programmer.</a>`
 *   — note the SPACE between the two tags is untagged, "orphan" text. It
 *   has to attach to one side; testing showed Google emits it as a
 *   separator trailing the tag that precedes it, so folding orphan text
 *   into the nearest PRECEDING tag is the correct rule (confirmed, not
 *   assumed).
 * - A 2-piece request `en->ja` (a date + a phone number split across
 *   pieces) came back with BOTH pieces' content folded under `<a i=0>`,
 *   with `<a i=1>` left holding only a trailing verb phrase — i.e.
 *   Google's translation genuinely reflows text across piece boundaries
 *   for some language pairs, so a naive "each index appears exactly once,
 *   in order" assumption breaks on real traffic. An index can legitimately
 *   receive text from more than one tag occurrence.
 * - No `<b>`/`<i>` sentence-confidence tags ever appeared in any of the
 *   test requests (short phrases, dates, multi-sentence paragraphs) — that
 *   handling isn't reproduced here since it can't be verified against
 *   current live behavior; if a future response is found to need it, add
 *   it back with a fresh comment recording the request that triggered it.
 */
interface Token {
  /** null = untagged ("orphan") text between/around tags. */
  index: number | null;
  text: string;
}

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  const tagPattern = /<a i=(\d+)>([^<]*)<\/a>/g;
  let cursor = 0;
  let match: RegExpExecArray | null = tagPattern.exec(html);
  while (match) {
    if (match.index > cursor) tokens.push({ index: null, text: html.slice(cursor, match.index) });
    tokens.push({ index: Number.parseInt(match[1] ?? '', 10), text: match[2] ?? '' });
    cursor = tagPattern.lastIndex;
    match = tagPattern.exec(html);
  }
  if (cursor < html.length) tokens.push({ index: null, text: html.slice(cursor) });
  return tokens;
}

function splitPieceResponse(raw: string, dontSortResults: boolean): string[] {
  const preMatch = raw.match(/^<pre[^>]*>([\s\S]*)<\/pre>$/);
  const html = preMatch ? (preMatch[1] ?? raw) : raw;
  const tokens = tokenize(html);

  if (dontSortResults) {
    // Just return segments in the order the response gave them, folding
    // orphan text into the tag that follows it (there's no "index" to
    // sort by in this mode, so "preceding vs following" is an arbitrary
    // but consistent choice).
    const out: string[] = [];
    let pending = '';
    for (const token of tokens) {
      if (token.index === null) {
        pending += token.text;
      } else {
        out.push(unescapeHTML(pending + token.text));
        pending = '';
      }
    }
    // No tagged segments at all — the normal shape for a single-string piece,
    // since transformPiece only adds <a i=N> markers when there's more than
    // one string. Without this, `out` stays empty and the whole translation is
    // silently returned as a successful-but-empty result. Mirrors the
    // index-based branch's own no-tags fallback below.
    if (out.length === 0) return pending ? [unescapeHTML(pending)] : [];
    if (pending) out[out.length - 1] += unescapeHTML(pending);
    return out;
  }

  // Reassemble by index. An index can appear more than once — confirmed
  // above — so later occurrences append rather than overwrite. Orphan text
  // folds into the nearest PRECEDING tagged index — also confirmed above.
  const byIndex = new Map<number, string>();
  let lastIndex: number | null = null;
  // Orphan text that arrives BEFORE the first tagged segment has no
  // preceding index to fold into. Buffer it and prepend it to the first
  // tagged segment instead of dropping it — Google prepends punctuation for
  // some target languages (Spanish '¿'/'¡'), and silently losing it is a
  // visible corruption. The dontSortResults branch above already handles
  // this case via its own `pending` accumulator.
  let leading = '';
  for (const token of tokens) {
    if (token.index === null) {
      if (lastIndex === null) leading += token.text;
      else byIndex.set(lastIndex, (byIndex.get(lastIndex) ?? '') + token.text);
      continue;
    }
    const existing = byIndex.get(token.index);
    let text = token.text;
    if (leading) {
      text = leading + text;
      leading = '';
    }
    byIndex.set(token.index, existing ? `${existing} ${text}` : text);
    lastIndex = token.index;
  }

  if (byIndex.size === 0) {
    // No tagged segments matched. For a single-string piece that's the
    // normal shape and `html` is just the translation. But if the response
    // clearly DID contain markers we failed to tokenize (e.g. Google added
    // inline <b>/<i> tags inside a segment, which this file's header notes
    // was never observed and isn't handled), returning it verbatim would
    // splice raw markup into the page as visible text — treat that as a
    // failed parse instead so the caller retries rather than corrupting.
    if (html.includes('<a i=')) return [];
    return [unescapeHTML(html)];
  }

  const result: string[] = [];
  for (const [index, text] of byIndex) result[index] = unescapeHTML(text);
  return result;
}

export function createGoogleProvider(): Translator {
  const inner = createBatchedHttpProvider({
    name: 'google',
    baseUrl: 'https://translate-pa.googleapis.com/v1/translateHtml',
    method: 'POST',
    callbacks: {
      transformPiece,
      splitPieceResponse,
      getRequestBody: (sourceLanguage, targetLanguage, pieceWireTexts) =>
        JSON.stringify([[pieceWireTexts, sourceLanguage, targetLanguage], 'te']),
      getExtraHeaders: () => [
        { name: 'Content-Type', value: 'application/application/json+protobuf' },
        { name: 'X-goog-api-key', value: translateAuth ?? '' },
      ],
      parseResponse: (response) => {
        const [texts, detectedLanguages] = response as [string[], (string | null)[] | undefined];
        return texts.map((text, index) => ({ text, detectedLanguage: detectedLanguages?.[index] ?? null }));
      },
    },
    // Reliability fix, found via a live incident (see `invalidateAuth`'s
    // doc comment above): a genuine 401/403 means the CURRENTLY CACHED key
    // is already dead, not merely due for its normal refresh — invalidate
    // immediately rather than resending it for the rest of the cache
    // window. Every other non-retryable status (a malformed request, etc.)
    // is unrelated to the auth key and left alone.
    onNonRetryableStatus: (status) => {
      if (status === 401 || status === 403) invalidateAuth();
    },
    // Reliability fix, found via a live incident: a sustained run of
    // suspicious-looking results is the endpoint's real-world failure mode
    // for a bad/exhausted key (far more likely than a clean 401), so this
    // also forces an immediate re-scrape rather than only reporting the
    // problem.
    onSuspiciousStreak: () => invalidateAuth(),
  });

  const translator: Translator = {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      await findAuth();
      if (!translateAuth) {
        return request.pieces.map(() => err({ kind: 'network', message: '[google] no auth key available' }));
      }
      // Same quirk `titleTranslator.ts` works around for the tab title: a
      // piece with only one string is sent bare (no <a i=N> wrapper, see
      // transformPiece above) and Google's endpoint doesn't reliably
      // translate that shape. Most page-translation pieces end up exactly
      // this size — grouping draws a boundary at every block-ancestor
      // change, and a lot of real markup (one <li> per nav/filter item, one
      // <p> per paragraph) puts each piece of text alone in its own block —
      // so pad every single-string piece with a throwaway second string to
      // force the reliably-wrapped path, then trim that throwaway back off
      // the result. Applied here (not inside transformPiece/
      // splitPieceResponse) so it covers every caller of this provider, not
      // just one hand-rolled call site.
      const paddedIndices = new Set<number>();
      const pieces = request.pieces.map((piece, index) => {
        if (piece.length === 1) {
          paddedIndices.add(index);
          return [...piece, ' '];
        }
        return piece;
      });

      /**
       * Sentence-context grouping (`descriptors.ts`'s `batchingHint`, now
       * re-enabled for Google below) means `request.pieces` can genuinely
       * hold a real, multi-node group — several sibling DOM text nodes
       * sent together so Google sees full sentence context instead of an
       * isolated fragment. This file's header comment already documents
       * the real risk that reopens: Google can reflow translated content
       * across a piece's own `<a i=N>` boundaries for some language pairs
       * (an index's content merging into a neighboring index), which
       * would silently misattribute one node's translation to another's
       * DOM position. `splitPieceResponse`'s reconstruction already tags
       * this shape unambiguously: a reflowed response decodes to FEWER
       * distinct entries than nodes were actually sent (merged content
       * collapses two node-indices into one Map key) — no live-endpoint
       * probing or raw-response access is needed here, just comparing the
       * decoded array's length against how many strings were sent. This
       * check is intentionally NOT extended to `dontSortResults` mode
       * (which reconstructs by tag-OCCURRENCE count, not by node
       * identity, so a reflow could coincidentally preserve array length
       * there) — real page-translation traffic never sets it (checked:
       * `content.ts`/`translateLoop.ts` never call `getDontSortResults`),
       * so this is a documented, deliberately-scoped gap, not an
       * oversight.
       *
       * `repairs` caches one in-flight repair promise per index — `repair`
       * can be invoked twice for the same index (once from the wrapped
       * `onPieceComplete` below, once from the final reconciliation loop)
       * and must not fire two separate repair requests for the same node.
       */
      const repairs = new Map<number, Promise<PieceOutcome>>();

      // Real corruption found via live verification against Wikipedia (not
      // theorized — see the improvement-history ledger's Google-grouping
      // entry): a large, citation-heavy group produced a response whose
      // tag structure broke partway through — `tokenize()`'s regex
      // (`<a i=(\d+)>([^<]*)<\/a>/g`) stopped matching mid-response, so
      // everything after that point became one giant untagged "orphan"
      // chunk that still contained literal, never-actually-parsed
      // `<a i=N>...</a>` text. Orphan text folds into the nearest
      // preceding tagged index per `splitPieceResponse`'s existing rule,
      // so the RAW markup — and the duplicated content inside it, since
      // the broken region also duplicated a clause — ended up spliced
      // straight into the page. Length still matched `originalPiece`'s
      // count in this exact case (the break happened late enough that
      // every expected index still showed up as A key), so the
      // length-mismatch check alone did not catch it — this second check
      // does, directly, by looking for the literal marker syntax in the
      // decoded text itself.
      const RAW_MARKER_LEAK = /<a i=\d+>|<\/a>/;

      function needsRepair(index: number, outcome: PieceOutcome): boolean {
        if (paddedIndices.has(index) || !outcome.ok) return false;
        const originalPiece = request.pieces[index];
        if (!originalPiece || originalPiece.length <= 1) return false;
        // Reliability fix, found via a round-6 audit: `splitPieceResponse`
        // builds this array by index assignment (`result[index] = ...`),
        // which is CORRECT — it's what keeps a surviving index's value at
        // its real position when an earlier one reflows away — but it also
        // makes the array sparse. `.length` on a sparse array is
        // `maxIndex + 1`, not the entry count, so this used to only catch
        // a reflow that dropped the LAST index; one that dropped a middle
        // or first index (a real Google reflow shape, not just the
        // last-index case this was originally written for) left a hole
        // `.length` doesn't see, so no repair fired — the neighboring
        // index silently absorbed the merged content, and the holed index
        // came back `undefined`, got treated as a missing result, and was
        // retranslated on its own: the page ended up showing the merged
        // clause AND a duplicate of it. `.filter()`, like `.some()` below
        // it, skips holes entirely (never invokes its callback for an
        // unassigned index) — counting only entries a real translation
        // filled in, including a legitimately empty string, is what
        // `byIndex.size` already means one function up in
        // `splitPieceResponse` itself.
        if (outcome.value.filter((s) => s !== undefined).length !== originalPiece.length) return true;
        if (outcome.value.some((s) => RAW_MARKER_LEAK.test(s))) return true;
        // Third signal (round-8, from a real user report): a SAME-COUNT
        // reflow — right number of entries, no leaked markers, but content
        // redistributed across the node boundaries. Both checks above are
        // structurally blind to it. See `reflowIntegrity.ts` for the
        // invariants and for why an over-eager answer here costs one extra
        // repair request rather than wrong text.
        return hasBoundaryReflow(originalPiece, outcome.value);
      }

      function repair(index: number): Promise<PieceOutcome> {
        const existing = repairs.get(index);
        if (existing) return existing;
        const promise = (async (): Promise<PieceOutcome> => {
          const originalPiece = request.pieces[index];
          if (!originalPiece) return err({ kind: 'parse', message: '[google] internal: piece missing for repair' });
          // Contained, immediate re-request — one single-string piece per
          // original node, going through THIS SAME translateBatch (so the
          // existing single-item padding path above applies to each) —
          // deliberately NOT routed through batchedHttpProvider.ts's
          // generic missing/suspicious repair mechanism, which retries the
          // exact same wire text (the whole group, still multi-item) and
          // would risk reflowing again indefinitely. A single-item piece
          // has no multi-index structure left to reflow across, so this
          // can't recurse into needing its own repair.
          const results = await translator.translateBatch({
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            pieces: originalPiece.map((s) => [s]),
            dontSortResults: false,
          });
          const failure = results.find((r) => !r.ok);
          if (failure && !failure.ok) return err(failure.error);
          return ok(results.map((r) => (r.ok ? (r.value[0] ?? '') : '')));
        })();
        repairs.set(index, promise);
        return promise;
      }

      const outcomes = await inner.translateBatch({
        ...request,
        pieces,
        sourceLanguage: fixLanguageCode(request.sourceLanguage),
        targetLanguage: fixLanguageCode(request.targetLanguage),
        // Always wrapped (even when the caller didn't ask for incremental
        // delivery at all) so a grouped piece's repair can start the
        // instant its wrong-shaped response is known, rather than waiting
        // for the whole batch to finish. Critical part of this fix, not
        // just a speed nicety: a grouped piece needing repair is held back
        // here and forwarded to the REAL `onPieceComplete` only once its
        // final, correct value is ready — an incremental-write-back caller
        // (translateLoop.ts) must never see (and flash to the screen) the
        // raw, reflowed intermediate result first.
        onPieceComplete: (index, rawOutcome) => {
          if (needsRepair(index, rawOutcome)) {
            void repair(index).then((repaired) => {
              request.onPieceComplete?.(index, repaired);
            });
            return;
          }
          request.onPieceComplete?.(index, rawOutcome);
        },
      });

      // Speed fix, found via a live-page audit (a chapter reader with many
      // short dialogue pieces plus inline name-highlighting tags — exactly
      // the shape that produces lots of grouped, reflow-prone pieces in
      // one tick): this used to `await repair(index)` one index at a time
      // in the loop below. Most repairs are already dispatched concurrently
      // via `onPieceComplete` above (fired the instant a grouped piece's
      // raw outcome is known, not held until the whole batch settles), so
      // a sequential await here still needlessly pays each one's latency
      // serially for any repair `onPieceComplete` didn't already kick off
      // early. Collecting every needed repair first and awaiting them all
      // together means total wait time is bounded by the SLOWEST repair,
      // not their sum.
      const final: PieceOutcome[] = new Array(outcomes.length);
      const repairIndices: number[] = [];
      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index];
        if (!outcome) continue;
        if (repairs.has(index) || needsRepair(index, outcome)) {
          repairIndices.push(index);
          continue;
        }
        if (paddedIndices.has(index) && outcome.ok) {
          // Real bug, found via a security/accuracy audit and confirmed
          // directly against the live endpoint: this file's own header
          // comment already documents that Google can reflow translated
          // content across piece/tag boundaries — that's not limited to
          // *genuine* multi-string pieces, it happens to the throwaway
          // padding above too. Confirmed case: "Apple iPhone 15 Pro Max"
          // (source forced to a different language, as a real mixed-
          // language page would have) came back with "Max" reflowed into
          // the padding's own index — `.slice(0, 1)` silently dropped it.
          // splitPieceResponse's own orphan-text-folds-into-the-preceding-
          // tag rule already leaves natural spacing intact between the two
          // slots (confirmed: value[0] came back "Apple iPhone 15 Pro "
          // with the trailing space already folded in), so joining every
          // element back together reconstructs the correct full string —
          // including the untranslated-but-invisible padding filler in
          // the ordinary case where nothing reflowed, which is harmless.
          //
          // Real regression found in a later audit of this exact fix:
          // unconditionally joining then `trimEnd()`-ing also strips
          // LEGITIMATE trailing whitespace that belongs to the real
          // content — e.g. "Hello " before "<b>world</b>" translating to
          // "Bonjour" instead of "Bonjour ", jamming into "BonjourMonde"
          // on the page once spliced in. `splitPieceResponse` already
          // folds the correct trailing space onto value[0] when nothing
          // reflowed (confirmed: `google.test.ts`'s existing padding
          // test), so index 0 needs no touching up in that case at all —
          // only reach for the padding slot's content when it's genuinely
          // non-whitespace (a real reflowed word/punctuation, not the
          // padding's own echoed filler).
          const [first, ...rest] = outcome.value;
          const overflow = rest.join('');
          const hasRealOverflow = overflow.trim().length > 0;
          final[index] = ok([hasRealOverflow ? (first ?? '') + overflow : (first ?? '')]);
          continue;
        }
        final[index] = outcome;
      }
      if (repairIndices.length > 0) {
        const repaired = await Promise.all(
          repairIndices.map(async (index) => ({ index, outcome: await repair(index) })),
        );
        repaired.forEach(({ index, outcome }) => {
          final[index] = outcome;
        });
      }
      return final;
    },
  };

  return translator;
}
