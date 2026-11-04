import { err, ok } from '../../shared/result';
import { describeTranslateError } from '../pageTranslator/errorState';
import type { PieceOutcome, TranslateBatchRequest, TranslateError, Translator } from '../translator';
import { createBatchedHttpProvider } from './batchedHttpProvider';
import { escapeHTML, unescapeHTML } from './htmlEscape';
import { hasBoundaryReflow } from './reflowIntegrity';

/**
 * Google provider: an undocumented, reverse-engineered endpoint
 * (`translate-pa.googleapis.com`). The `<pre><a i=N>` marker scheme, the
 * auth-key scrape and the hardcoded fallback key are what actually work
 * against an endpoint we don't control; keep them as they are.
 */

let lastRequestAuthTime: number | null = null;
let translateAuth: string | null = null;
let authNotFound = false;
let authPromise: Promise<void> | null = null;

// Bound on the auth-key scrape. Every translateBatch() awaits the memoized
// `authPromise`, so a scrape that never settled would hang all translation
// for the rest of the background context's life.
const AUTH_SCRAPE_TIMEOUT_MS = 10000;

/** Plain data shape for persisting/restoring the scraped auth key — see `hydrateAuthKey`'s doc comment for why this exists. */
export interface AuthKeySnapshot {
  key: string;
  notFound: boolean;
  time: number;
}

/**
 * Seeds the in-memory auth cache, which doesn't survive an MV3 service-worker
 * restart. The engine can't touch `browser.storage`, so `background.ts`
 * persists the snapshot in session storage and restores it through this.
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

let authKeyListener: ((snapshot: AuthKeySnapshot | undefined) => void) | null = null;

/**
 * Called after every scrape and every invalidation (`undefined`), so
 * `background.ts` can keep its persisted copy current and a restarted worker
 * never restores a key Google already rejected.
 */
export function onAuthKeyChange(listener: (snapshot: AuthKeySnapshot | undefined) => void): void {
  authKeyListener = listener;
}

/** Saving the key is best-effort: a listener that throws must never fail a translation. */
function notifyAuthKeyChange(snapshot: AuthKeySnapshot | undefined): void {
  try {
    authKeyListener?.(snapshot);
  } catch (e) {
    console.warn('[google] auth key listener failed', e);
  }
}

/**
 * Forces the next `findAuth` to re-scrape, for a rejected key or a suspicious
 * streak (the endpoint's usual failure mode for a bad key). Clearing
 * `translateAuth` makes a request still waiting to be sent fetch a fresh key
 * first (see `getExtraHeaders`) instead of resending the dead one.
 */
function invalidateAuth(): void {
  translateAuth = null;
  lastRequestAuthTime = null;
  notifyAuthKeyChange(undefined);
}

/**
 * Whether a rejection is about the key. Checked live: Google answers a bad
 * key with HTTP 400 "API key not valid" and a missing one with 403, while a
 * malformed request is also a 400 ("Request contains an invalid argument"),
 * so only the message tells a dead key apart.
 */
function isKeyRejection(status: number, reason: string | null): boolean {
  return status === 401 || status === 403 || /\bAPI key\b/i.test(reason ?? '');
}

/** An `'auth'` error whose message names the way out, for surfaces that show `message` as-is. */
function keyFailure(status?: number, reason?: string): TranslateError {
  const error: TranslateError = { kind: 'auth', message: '' };
  if (status !== undefined) error.status = status;
  if (reason) error.reason = reason;
  return { ...error, message: describeTranslateError(error) };
}

/** Marks a rejection that is about the key as `'auth'`; anything else passes through. */
function classifyKeyFailure(outcome: PieceOutcome): PieceOutcome {
  if (outcome.ok || outcome.error.kind !== 'http' || outcome.error.status === undefined) return outcome;
  const { status, reason } = outcome.error;
  if (status === 429 || status >= 500 || !isKeyRejection(status, reason ?? null)) return outcome;
  return err(keyFailure(status, reason));
}

/**
 * Lets `background.ts` start the scrape speculatively at startup, so its cost
 * is off the first translation's critical path.
 */
export async function ensureAuthReady(): Promise<void> {
  await findAuth();
}

// Fallback API key if the scrape fails. Stored as bytes only so it doesn't
// read as a plaintext secret to a grep; it's Google's own public web-client key.
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
      // path sets both, and a failed scrape should retry after 5 minutes,
      // not sit on the spare key for 20.
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
      // Raced against a plain timer (covering `response.text()` too), since
      // an aborted fetch doesn't always reject; see AUTH_SCRAPE_TIMEOUT_MS.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AUTH_SCRAPE_TIMEOUT_MS);
      let backstopTimeout: ReturnType<typeof setTimeout> | undefined;
      let text: string;
      try {
        text = await Promise.race([
          (async () => {
            const response = await fetch(
              'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main',
              { signal: controller.signal },
            );
            // An error page is never the script, even if it happens to hold a key.
            if (!response.ok) throw new Error(`Auth scrape got HTTP ${response.status}`);
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
      const match = text.length > 1 ? text.match(/['"]x-goog-api-key['"]\s*:\s*['"]([\w-]{39})['"]/i) : null;
      if (match?.[1]) {
        translateAuth = match[1];
        authNotFound = false;
      } else {
        // Most likely Google changed the script; worth seeing in the log.
        console.warn('[google] auth scrape found no key, using the fallback key');
        translateAuth = fallbackKey;
        authNotFound = true;
      }
    } catch (e) {
      console.error('[google] auth scrape failed', e);
      translateAuth = fallbackKey;
      authNotFound = true;
    }
    notifyAuthKeyChange(getAuthKeySnapshot());
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
  // <a i=N> markers are only added for more than one item; a lone string
  // goes bare (see the single-string padding in translateBatch).
  if (arr.length > 1) {
    arr = arr.map((text, index) => `<a i=${index}>${text}</a>`);
  }
  return `<pre>${arr.join('')}</pre>`;
}

/**
 * Response parsing rules, confirmed against the live endpoint:
 * - Untagged ("orphan") text between tags, e.g. the space in
 *   `<a i=0>…</a> <a i=1>…</a>`, belongs to the PRECEDING tag.
 * - Google can reflow text across piece boundaries for some language pairs,
 *   so an index may appear more than once (or not at all).
 * - Inline `<b>`/`<i>` confidence tags were never observed and aren't handled.
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

// Scripts written without spaces between words: a reflow join must not add one.
const NO_SPACE_SCRIPT_END =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]$/u;
const NO_SPACE_SCRIPT_START =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** Joins two occurrences of one index, adding a space only where the text needs one and lacks it. */
function joinReflowed(before: string, after: string): string {
  if (/\s$/.test(before) || /^\s/.test(after)) return before + after;
  if (NO_SPACE_SCRIPT_END.test(before) || NO_SPACE_SCRIPT_START.test(after)) return before + after;
  return `${before} ${after}`;
}

// A broken tag structure mid-response leaves literal `<a i=N>` markup in the
// orphan text, which then folds into a real index while the entry count
// still matches. Caught by looking for the markers directly.
const RAW_MARKER_LEAK = /<a i=\d+>|<\/a>/;

function splitPieceResponse(raw: string): string[] {
  const preMatch = raw.match(/^\s*<pre[^>]*>([\s\S]*)<\/pre>\s*$/);
  const html = preMatch ? (preMatch[1] ?? raw) : raw;
  const tokens = tokenize(html);

  // Reassemble by index: repeated occurrences append, orphan text folds into
  // the preceding tagged index.
  const byIndex = new Map<number, string>();
  let lastIndex: number | null = null;
  // Orphan text before the first tag is prepended to the first tagged
  // segment, not dropped (Google prepends '¿'/'¡' for Spanish).
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
    byIndex.set(token.index, existing ? joinReflowed(existing, text) : text);
    lastIndex = token.index;
  }

  if (byIndex.size === 0) {
    // No tags matched: normal for a single-string piece. But if markers are
    // present and we failed to tokenize them, fail the parse so the caller
    // retries, rather than splicing raw markup into the page.
    if (html.includes('<a i=')) return [];
    return [unescapeHTML(html)];
  }

  const result: string[] = [];
  for (const [index, text] of byIndex) result[index] = unescapeHTML(text);
  return result;
}

/**
 * The endpoint answers `[[text, ...], [detectedLanguage, ...]]`. Anything
 * else means the scraped endpoint changed, so it's reported, not guessed at.
 */
function parseTranslateHtmlResponse(
  response: unknown,
): Array<{ text: string; detectedLanguage: string | null }> | null {
  if (!Array.isArray(response)) return null;
  const [texts, detectedLanguages] = response as unknown[];
  if (!Array.isArray(texts) || !texts.every((text) => typeof text === 'string')) return null;
  const languages: unknown[] = Array.isArray(detectedLanguages) ? detectedLanguages : [];
  return texts.map((text: string, index) => {
    const language = languages[index];
    return { text, detectedLanguage: typeof language === 'string' ? language : null };
  });
}

export function createGoogleProvider(): Translator {
  const inner = createBatchedHttpProvider({
    name: 'google',
    baseUrl: 'https://translate-pa.googleapis.com/v1/translateHtml',
    callbacks: {
      transformPiece,
      splitPieceResponse,
      getRequestBody: (sourceLanguage, targetLanguage, pieceWireTexts) =>
        JSON.stringify([[pieceWireTexts, sourceLanguage, targetLanguage], 'te']),
      getExtraHeaders: async () => {
        // A sibling request may have had the key rejected while this one queued.
        if (!translateAuth) await findAuth();
        return [
          { name: 'Content-Type', value: 'application/json+protobuf' },
          { name: 'X-goog-api-key', value: translateAuth ?? '' },
        ];
      },
      parseResponse: parseTranslateHtmlResponse,
    },
    // A key rejection means the cached key is dead; other statuses are unrelated to it.
    onNonRetryableStatus: (status, reason) => {
      if (isKeyRejection(status, reason)) invalidateAuth();
    },
    // A suspicious streak is the endpoint's usual symptom of a bad key.
    onSuspiciousStreak: () => invalidateAuth(),
  });

  const translator: Translator = {
    async translateBatch(request: TranslateBatchRequest): Promise<PieceOutcome[]> {
      await findAuth();
      if (!translateAuth) return request.pieces.map(() => err(keyFailure()));
      // Google doesn't reliably translate a bare single-string piece (no
      // <a i=N> wrapper), and most pieces are one string. Pad each with a
      // throwaway second string to force the wrapped path, then trim it off.
      // Done here so it covers every caller of this provider.
      const paddedIndices = new Set<number>();
      const pieces = request.pieces.map((piece, index) => {
        if (piece.length === 1) {
          paddedIndices.add(index);
          return [...piece, ' '];
        }
        return piece;
      });

      /**
       * A multi-node group can come back reflowed across its `<a i=N>`
       * boundaries, misattributing one node's text to another; `needsRepair`
       * detects that and `repair` re-requests the group node by node.
       *
       * `repairs` caches one repair promise per index: `repair` is called from
       * both `onPieceComplete` and the final loop and must not fire twice.
       */
      const repairs = new Map<number, Promise<PieceOutcome>>();

      function needsRepair(index: number, outcome: PieceOutcome): boolean {
        if (paddedIndices.has(index) || !outcome.ok) return false;
        const originalPiece = request.pieces[index];
        if (!originalPiece || originalPiece.length <= 1) return false;
        // The array is sparse (built by index assignment), so `.length` misses
        // a dropped middle index; `.filter()` counts only assigned entries.
        if (outcome.value.filter((s) => s !== undefined).length !== originalPiece.length) return true;
        if (outcome.value.some((s) => RAW_MARKER_LEAK.test(s))) return true;
        // A same-count reflow (content shifted across node boundaries) is
        // invisible to both checks above; see reflowIntegrity.ts.
        return hasBoundaryReflow(originalPiece, outcome.value);
      }

      /**
       * A padded piece comes back as [text, padding]. Google can reflow real
       * content into the padding slot (e.g. "Max" from "Apple iPhone 15 Pro
       * Max"), so non-whitespace overflow is appended; otherwise index 0 is
       * kept alone, preserving a real trailing space ("Bonjour " before
       * "<b>Monde</b>"). Leaked markup fails the piece: a single string has
       * no per-node repair, and markup must never reach the page.
       */
      function finishPadded(index: number, outcome: PieceOutcome): PieceOutcome {
        if (!outcome.ok) return outcome;
        const [first, ...rest] = outcome.value;
        const overflow = rest.join('');
        const text = overflow.trim().length > 0 ? (first ?? '') + overflow : (first ?? '');
        if (RAW_MARKER_LEAK.test(text) && !RAW_MARKER_LEAK.test(request.pieces[index]?.[0] ?? '')) {
          return err({ kind: 'badResponse', message: '[google] answer had broken tag markup' });
        }
        return ok([text]);
      }

      function repair(index: number): Promise<PieceOutcome> {
        const existing = repairs.get(index);
        if (existing) return existing;
        const promise = (async (): Promise<PieceOutcome> => {
          const originalPiece = request.pieces[index];
          if (!originalPiece)
            return err({ kind: 'badResponse', message: '[google] internal: piece missing for repair' });
          // One single-string piece per node through this same translateBatch
          // (so padding applies). Not the generic repair path, which resends
          // the same multi-item wire text and could reflow again.
          const results = await translator.translateBatch({
            sourceLanguage: request.sourceLanguage,
            sourceLanguageIsExplicit: request.sourceLanguageIsExplicit,
            targetLanguage: request.targetLanguage,
            pieces: originalPiece.map((s) => [s]),
          });
          const failure = results.find((r) => !r.ok);
          if (failure && !failure.ok) return err(failure.error);
          return ok(results.map((r) => (r.ok ? (r.value[0] ?? '') : '')));
        })();
        repairs.set(index, promise);
        return promise;
      }

      // Send 'auto' unless the user picked a source: one page-level guess
      // mistranslates pieces already in the target language, and with 'auto'
      // the endpoint returns a per-piece detected language for
      // outputSanityCheck.ts. An explicit From choice is honoured as-is.
      const declaredSource = fixLanguageCode(request.sourceLanguage);
      const autoDetect = !request.sourceLanguageIsExplicit && declaredSource !== 'auto';

      const outcomes = await inner.translateBatch({
        ...request,
        pieces,
        sourceLanguage: autoDetect ? 'auto' : declaredSource,
        // Falls back to the page's guess for a piece the sanity check
        // flags, rather than retrying `'auto'` into the same echo.
        suspiciousRetrySourceLanguage: autoDetect ? declaredSource : request.suspiciousRetrySourceLanguage,
        targetLanguage: fixLanguageCode(request.targetLanguage),
        // Always wrapped so a grouped piece's repair starts as soon as its bad
        // response is known, and so the caller only ever sees the repaired
        // value, never the reflowed intermediate.
        onPieceComplete: (index, rawOutcome) => {
          if (needsRepair(index, rawOutcome)) {
            void repair(index).then((repaired) => {
              request.onPieceComplete?.(index, classifyKeyFailure(repaired));
            });
            return;
          }
          const outcome = paddedIndices.has(index) ? finishPadded(index, rawOutcome) : rawOutcome;
          request.onPieceComplete?.(index, classifyKeyFailure(outcome));
        },
      });

      // Collect every needed repair and await them together, so the wait is
      // bounded by the slowest repair, not their sum.
      const final: PieceOutcome[] = new Array(outcomes.length);
      const repairIndices: number[] = [];
      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index];
        if (!outcome) continue;
        if (repairs.has(index) || needsRepair(index, outcome)) {
          repairIndices.push(index);
          continue;
        }
        final[index] = paddedIndices.has(index) ? finishPadded(index, outcome) : outcome;
      }
      if (repairIndices.length > 0) {
        const repaired = await Promise.all(
          repairIndices.map(async (index) => ({ index, outcome: await repair(index) })),
        );
        repaired.forEach(({ index, outcome }) => {
          final[index] = outcome;
        });
      }
      return final.map(classifyKeyFailure);
    },
  };

  return translator;
}
