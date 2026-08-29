import { err, ok } from '../../shared/result';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';
import { escapeHTML, unescapeHTML } from './htmlEscape';

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
      const response = await fetch(
        'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main',
      );
      const text = await response.text();
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
  });

  return {
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
      const outcomes = await inner.translateBatch({
        ...request,
        pieces,
        sourceLanguage: fixLanguageCode(request.sourceLanguage),
        targetLanguage: fixLanguageCode(request.targetLanguage),
      });
      return outcomes.map((outcome, index) => {
        if (paddedIndices.has(index) && outcome.ok) {
          return ok(outcome.value.slice(0, 1));
        }
        return outcome;
      });
    },
  };
}
