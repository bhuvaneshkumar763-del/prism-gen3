import { err, ok } from '../../shared/result';
import { escapeHTML, unescapeHTML } from '../providers/htmlEscape';
import { isSuspiciousOutcome } from '../providers/outputSanityCheck';
import { hasBoundaryReflow } from '../providers/reflowIntegrity';
import type { PieceOutcome, TranslateBatchRequest, Translator } from '../translator';

/**
 * A test `Translator` that behaves like the Google provider rather than an
 * idealised one: it answers from real replay recordings where it can, and
 * otherwise applies Google's observed quirks to a simple transformation, so
 * engine tests see the punctuation, echo and reflow cases real pages produce.
 */

/** A replay case's `google.json`: `["auto", target, wireText]` → Google's answers in order, each `[wireText, detectedLanguage]`. */
export type GoogleRecording = Record<string, ReadonlyArray<readonly [string, string | null]>>;

export interface GoogleFakeOptions {
  /** Replay recordings to answer from first, matched per piece and then per item. */
  recordings?: GoogleRecording | GoogleRecording[];
  /** Exact translations by trimmed item text, then by letter run, used before the default run transform. */
  dictionary?: Record<string, string>;
  /** Google writes full-width brackets and CJK sentence marks as ASCII (`（`→`(`, `【`→`[`, `。`→`.`). Default true. */
  asciiPunctuation?: boolean;
  /**
   * Whether a leading `. ` the source carried is dropped. Google does it only
   * sometimes, so `'alternate'` (the default) drops it on every other such item.
   */
  dropLeadingPeriod?: 'always' | 'never' | 'alternate';
  /**
   * Items Google sends back unchanged, with the language it reports detecting.
   * A function also gets the request's wire source, so a test can echo under
   * `'auto'` and translate the retry with an explicit source.
   */
  echo?: Record<string, string> | ((text: string, sourceLanguage: string) => string | null);
  /** Grouped pieces whose first item's last word moves into the second item. Default none. */
  reflow?: boolean | ((piece: readonly string[]) => boolean);
  /** Re-translate a reflowed piece item by item when `hasBoundaryReflow` sees it, as `google.ts` does. Default true. */
  repairReflow?: boolean;
  /** Run the real `isSuspiciousOutcome` and its one retry, as the provider does. Default true. */
  sanityCheck?: boolean;
  /** Detected language reported for a translated (not echoed, not recorded) item. Default: the request's declared source. */
  detectedLanguage?: string;
}

/** One piece as the fake answered it, for assertions. */
export interface GoogleFakeAnswer {
  piece: readonly string[];
  /** The source language on the wire: `'auto'` unless the user chose one, like `google.ts`. */
  sourceLanguage: string;
  targetLanguage: string;
  outcome: PieceOutcome;
  detectedLanguage: string | null;
}

export interface GoogleFake extends Translator {
  readonly requests: TranslateBatchRequest[];
  readonly answers: GoogleFakeAnswer[];
}

const ASCII_PUNCTUATION: Record<string, string> = {
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '［': '[',
  '］': ']',
  '｛': '{',
  '｝': '}',
  '〔': '[',
  '〕': ']',
  '。': '.',
  '，': ',',
  '、': ',',
  '！': '!',
  '？': '?',
  '：': ':',
  '；': ';',
};
const ASCII_PUNCTUATION_PATTERN = new RegExp(`[${Object.keys(ASCII_PUNCTUATION).join('')}]`, 'gu');
const LETTER_RUN = /[\p{L}\p{M}]+/gu;
const LEADING_PERIOD = /^\s*\.\s+/;

/** The default "translation" of a letter run: visibly changed, and never equal to the source. */
function defaultRunTranslation(run: string): string {
  const upper = run.toUpperCase();
  return upper !== run ? upper : `⟨${run}⟩`;
}

function wireText(piece: readonly string[]): string {
  // google.ts pads a single-string piece with ' ' so it is always marker-wrapped.
  const items = piece.length === 1 ? [...piece, ' '] : piece;
  return `<pre>${items.map((text, index) => `<a i=${index}>${escapeHTML(text)}</a>`).join('')}</pre>`;
}

/** Google's response markup back to one string per item, by marker index, as `google.ts` reassembles it. */
function decodeWire(raw: string, itemCount: number): string[] {
  const html = raw.match(/^<pre[^>]*>([\s\S]*)<\/pre>$/)?.[1] ?? raw;
  const byIndex = new Map<number, string>();
  for (const match of html.matchAll(/<a i=(\d+)>([^<]*)<\/a>/g)) {
    const index = Number(match[1]);
    const text = unescapeHTML(match[2] ?? '');
    const existing = byIndex.get(index);
    byIndex.set(index, existing === undefined ? text : `${existing} ${text}`);
  }
  if (itemCount === 1) {
    const overflow = [...byIndex.entries()].filter(([i]) => i > 0).map(([, t]) => t);
    const extra = overflow.join('');
    return [(byIndex.get(0) ?? '') + (extra.trim() ? extra : '')];
  }
  return Array.from({ length: itemCount }, (_, i) => byIndex.get(i) ?? '');
}

export function createGoogleFake(options: GoogleFakeOptions = {}): GoogleFake {
  const recordings = [options.recordings ?? []].flat();
  const served = new Map<string, number>();
  let leadingPeriodsSeen = 0;
  const requests: TranslateBatchRequest[] = [];
  const answers: GoogleFakeAnswer[] = [];

  function recorded(sourceLanguage: string, targetLanguage: string, piece: readonly string[]) {
    const key = JSON.stringify([sourceLanguage, targetLanguage, wireText(piece)]);
    for (const recording of recordings) {
      const list = recording[key];
      if (!list || list.length === 0) continue;
      // Repeats get Google's later answers in order, then the last one again (as the replay harness does).
      const n = served.get(key) ?? 0;
      served.set(key, n + 1);
      const [raw, detected] = list[Math.min(n, list.length - 1)] ?? ['', null];
      return { texts: decodeWire(raw, piece.length), detected };
    }
    return null;
  }

  function echoed(text: string, sourceLanguage: string): string | null {
    const { echo } = options;
    if (!echo) return null;
    return typeof echo === 'function' ? echo(text, sourceLanguage) : (echo[text] ?? null);
  }

  function transform(text: string): string {
    let body = text.trim();
    if (LEADING_PERIOD.test(text)) {
      const mode = options.dropLeadingPeriod ?? 'alternate';
      const drop = mode === 'always' || (mode === 'alternate' && leadingPeriodsSeen++ % 2 === 0);
      if (drop) body = body.replace(LEADING_PERIOD, '');
    }
    if (options.asciiPunctuation ?? true) {
      body = body.replace(ASCII_PUNCTUATION_PATTERN, (ch) => ASCII_PUNCTUATION[ch] ?? ch);
    }
    const whole = options.dictionary?.[body];
    if (whole !== undefined) return whole;
    return body.replace(LETTER_RUN, (run) => options.dictionary?.[run] ?? defaultRunTranslation(run));
  }

  function translateItem(text: string, sourceLanguage: string, targetLanguage: string, declared: string) {
    const hit = recorded(sourceLanguage, targetLanguage, [text]);
    if (hit) return { text: hit.texts[0] ?? '', detected: hit.detected };
    const echoLanguage = echoed(text, sourceLanguage);
    if (echoLanguage !== null) return { text, detected: echoLanguage };
    return { text: transform(text), detected: options.detectedLanguage ?? declared };
  }

  function reflows(piece: readonly string[]): boolean {
    const { reflow } = options;
    if (piece.length < 2 || !reflow) return false;
    return reflow === true || reflow(piece);
  }

  /** One request for one piece, as Google answers it before the provider's checks. */
  function answerOnce(piece: readonly string[], sourceLanguage: string, targetLanguage: string, declared: string) {
    const whole = piece.length > 1 ? recorded(sourceLanguage, targetLanguage, piece) : null;
    if (whole) return whole;
    const items = piece.map((text) => translateItem(text, sourceLanguage, targetLanguage, declared));
    const texts = items.map((item) => item.text);
    if (reflows(piece)) {
      const words = (texts[0] ?? '').split(' ');
      if (words.length > 1) {
        const moved = words.pop();
        texts[0] = words.join(' ');
        texts[1] = `${moved} ${texts[1] ?? ''}`;
      }
    }
    return { texts, detected: items[0]?.detected ?? null };
  }

  function answerPiece(piece: readonly string[], request: TranslateBatchRequest): GoogleFakeAnswer {
    const declared = request.sourceLanguage;
    const wireSource = request.sourceLanguageIsExplicit || declared === 'auto' ? declared : 'auto';
    const target = request.targetLanguage;
    let sentSource = wireSource;
    let answer = answerOnce(piece, sentSource, target, declared);
    const suspicious = (texts: string[], detected: string | null) =>
      (options.sanityCheck ?? true) &&
      isSuspiciousOutcome(piece.join(''), { text: texts.join(''), detectedLanguage: detected }, sentSource, target);

    if (suspicious(answer.texts, answer.detected)) {
      // The provider's one repair: the page's guess instead of 'auto' (see batchedHttpProvider.ts).
      sentSource = wireSource === 'auto' ? declared : 'auto';
      answer = answerOnce(piece, sentSource, target, declared);
      if (suspicious(answer.texts, answer.detected)) {
        const outcome = err({ kind: 'suspicious' as const, message: '[google] kept sending text back untranslated' });
        return {
          piece,
          sourceLanguage: sentSource,
          targetLanguage: target,
          outcome,
          detectedLanguage: answer.detected,
        };
      }
    }

    let texts = answer.texts;
    if ((options.repairReflow ?? true) && piece.length > 1 && hasBoundaryReflow(piece, texts)) {
      texts = piece.map((text) => answerOnce([text], sentSource, target, declared).texts[0] ?? '');
    }
    return {
      piece,
      sourceLanguage: sentSource,
      targetLanguage: target,
      outcome: ok(texts),
      detectedLanguage: answer.detected,
    };
  }

  return {
    requests,
    answers,
    async translateBatch(request) {
      requests.push(request);
      await Promise.resolve();
      return request.pieces.map((piece, index) => {
        const answer = answerPiece(piece, request);
        answers.push(answer);
        request.onPieceComplete?.(index, answer.outcome);
        return answer.outcome;
      });
    },
  };
}
