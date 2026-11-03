/**
 * Detects text that is ENTIRELY tag-like tokens (`#hashtag`, `@mention`, or a
 * cluster like `#A #B #C` / `#动作, #冒险`) so `grouping.ts` can isolate it:
 * Google's translate-pa reorders/merges its `<a i=N>` markers when several
 * short tag links share one batch, producing stray commas and mislabeled tags.
 *
 * Matching is anchored to the whole trimmed string, so a tag inside prose
 * (a "#1" footnote mid-sentence) is not isolated.
 */

// `/` is only a separator, never a token char: a char in both classes lets the repeats split one run many ways (ReDoS).
const TAG_TOKEN = "[#@][\\p{L}\\p{N}_+#'&.\\-]+";
const PURE_TAGS_RE = new RegExp(`^${TAG_TOKEN}(?:[\\s,，、・·|/]+${TAG_TOKEN})*[\\s,，、・·|/.]*$`, 'u');
// Backstop against long page text; real tag clusters are far shorter.
const MAX_PURE_TAGS_LENGTH = 500;

/** True if `text` (already trimmed by the caller) is entirely one or more tag tokens — nothing else. */
export function isPureTagText(text: string): boolean {
  return text.length > 0 && text.length <= MAX_PURE_TAGS_LENGTH && PURE_TAGS_RE.test(text);
}
