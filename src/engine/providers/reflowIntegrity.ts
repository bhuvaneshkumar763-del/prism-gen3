/**
 * Detects a SAME-COUNT reflow in a grouped multi-node piece — Google's
 * `<a i=N>` wire format handing back the right NUMBER of entries, with no
 * literal markers left over, but with content redistributed across the
 * node boundaries.
 *
 * `google.ts`'s two older signals both miss this shape by construction: one
 * counts decoded entries against nodes sent (unchanged here), the other
 * looks for literal `<a i=N>`/`</a>` text surviving in a value (nothing
 * leaks here — the markers parsed fine, they just ended up in the wrong
 * places). Found via a real user report on sangtacviet.vip's search page:
 * a ~1000-chip facet panel rendered `System (192673) Fantasy (` in one chip
 * and `189348)` in the next, i.e. one node absorbed the head of its
 * neighbour's translation and the neighbour kept only the tail.
 *
 * The checks below are deliberately NOT a general "does this translation
 * look plausible" heuristic. Each one is a structural invariant that a
 * correct per-node translation cannot violate, chosen so that a violation
 * means content crossed a node boundary rather than merely that the
 * translation was surprising. They were validated against the exact
 * reported failure (transcribed from the report's own screenshots) BEFORE
 * being written: bracket balance flags the `System (192673) Fantasy (` /
 * `189348)` pair, the digit check flags the `(163847)` / `Urban Romance`
 * pair — disjoint node sets, which is why both earn their place — and
 * NEITHER fires on the same page's known-good translation.
 *
 * **Cost of a false positive is bounded and never corruption.** A `true`
 * here makes `google.ts` re-request that one piece as individual
 * single-string pieces, which is the safest wire shape available (a
 * single-item piece has no multi-index structure left to reflow across).
 * So the failure mode of an over-eager check is one extra, slower request
 * for that piece — not wrong text on the page. That asymmetry is why these
 * lean toward catching a real reflow over avoiding an occasional
 * unnecessary repair.
 */

const HAS_LETTER = /\p{L}/u;
/**
 * Four or more consecutive ASCII digits: long enough to read as an
 * identifier, count, or year that a translator carries across verbatim,
 * rather than a small number it might legitimately reword ("2" -> "two").
 */
const LONG_DIGIT_RUN = /[0-9]{4,}/g;
/** Any decimal digit that is NOT ASCII 0-9 — Arabic-Indic, Devanagari, etc. */
const NON_ASCII_DIGIT = /(?![0-9])\p{Nd}/u;

/**
 * Bracket pairs checked for balance, each class independently. Full-width
 * and CJK forms are normalized onto their ASCII class first, so a provider
 * that rewrites `（x）` as `(x)` — or mixes the two — stays balanced rather
 * than reading as a reflow.
 */
const BRACKET_CLASSES: ReadonlyArray<{ open: string; close: string }> = [
  { open: '(（', close: ')）' },
  { open: '[［【〔', close: ']］】〕' },
  { open: '{｛', close: '}｝' },
];

function bracketsBalanced(text: string): boolean {
  for (const { open, close } of BRACKET_CLASSES) {
    let depth = 0;
    for (const char of text) {
      if (open.includes(char)) depth++;
      else if (close.includes(char)) {
        depth--;
        // A close before its open means content from an earlier node's
        // share is missing from this one — already conclusive, no need to
        // finish the scan.
        if (depth < 0) return false;
      }
    }
    if (depth !== 0) return false;
  }
  return true;
}

/**
 * Every ASCII digit in `text`, in order, with separators dropped. Compared
 * as a digit STREAM rather than by substring on the raw text so that a
 * provider regrouping `1000` as `1,000` (or `1 000`) still matches — the
 * digits themselves are what must survive, not their punctuation.
 */
function digitStream(text: string): string {
  let out = '';
  for (const char of text) {
    if (char >= '0' && char <= '9') out += char;
  }
  return out;
}

/**
 * True when `translated` shows a node-boundary violation against `source`,
 * meaning the piece should be repaired as individual single-string pieces.
 *
 * Caller contract: both arrays describe the SAME grouped piece, index for
 * index, and `google.ts` has already established that the entry counts
 * match (a count mismatch is its own, earlier signal). A piece of one node
 * can't reflow across anything and is rejected outright.
 */
export function hasBoundaryReflow(source: readonly string[], translated: readonly string[]): boolean {
  if (source.length <= 1 || source.length !== translated.length) return false;

  // Skipped wholesale when the provider localized numerals into another
  // numeral system: the ASCII run from the source legitimately no longer
  // appears anywhere in the output, which would flag every node.
  const digitsComparable = !translated.some((text) => NON_ASCII_DIGIT.test(text));

  for (const [index, sourceText] of source.entries()) {
    const translatedText = translated[index] ?? '';

    // A node with real words cannot correctly translate to nothing. If it
    // came back empty, its share of the response went somewhere else.
    if (HAS_LETTER.test(sourceText) && translatedText.trim() === '') return true;

    // Balance is only meaningful when the SOURCE node was itself balanced.
    // A bracket legitimately opened in one node and closed in another (a
    // parenthetical split across inline markup) leaves both nodes
    // unbalanced to begin with, and must not be read as a reflow.
    if (bracketsBalanced(sourceText) && !bracketsBalanced(translatedText)) return true;

    if (digitsComparable) {
      const stream = digitStream(translatedText);
      for (const run of sourceText.match(LONG_DIGIT_RUN) ?? []) {
        if (!stream.includes(run)) return true;
      }
    }
  }
  return false;
}
