/**
 * Detects text that is ENTIRELY tag-like tokens — `#hashtag`, `@mention`,
 * or a cluster of several with no prose between them (`#go#be`, `#A #B #C`,
 * `#动作, #冒险`) — so `grouping.ts` can isolate it from surrounding text
 * before it's ever sent to a provider.
 *
 * Faithful port of `TAG_TOKEN`/`PURE_TAGS_RE` from the *original*
 * pre-rewrite vanilla-JS codebase's `contentScript/pageTranslator.js`
 * (`getPiecesToTranslate()`'s `isStandaloneTagAnchor`, ~line 831 onward —
 * NOT the Gen 2 TWP rewrite, which never had this at all; that repo's
 * history was checked directly and confirmed empty). Real production code,
 * refined over three separate bug-fix rounds against real traffic:
 *
 * 1. Google's translate-pa endpoint reorders/merges the `<a i=N>` index
 *    markers it uses to track which translated fragment maps back to which
 *    source piece when several short tag links sit next to each other in
 *    one multi-string batch (tag clouds, chip rows) — producing stray
 *    commas, merged words, and mislabeled tags.
 * 2. The token charset was widened to survive real-world tags with
 *    hyphens/underscores/dots/plus/apostrophe/slash ("#sci-fi", "#C++",
 *    "#anime_2024") and multi-token clusters with CJK-aware delimiters
 *    (spaces, commas incl. CJK ，、, middots, pipes, slashes).
 * 3. Matching is anchored to the WHOLE trimmed string (`^...$`), not a
 *    substring test — a tag sitting inside real prose (a footnote marker
 *    like "#1" in the middle of a sentence) must NOT be isolated, only
 *    text that is *entirely* tag content.
 *
 * Deliberately does not attempt the fork's later "isolate any short
 * standalone link, with DOM-sibling prose-vs-non-prose awareness" round —
 * that needs real tree-walk context (which element wraps a node, what its
 * neighbors are) that this engine's flat `Text[]` grouping pipeline
 * doesn't have. Documented as a follow-up, not built here — see the
 * post-launch pass writeup in this repo's CLAUDE.md.
 */

const TAG_TOKEN = "[#@][\\p{L}\\p{N}_+#'&./\\-]+";
const PURE_TAGS_RE = new RegExp(`^${TAG_TOKEN}(?:[\\s,，、・·|/]+${TAG_TOKEN})*[\\s,，、・·|/.]*$`, 'u');

/** True if `text` (already trimmed by the caller) is entirely one or more tag tokens — nothing else. */
export function isPureTagText(text: string): boolean {
  return text.length > 0 && PURE_TAGS_RE.test(text);
}
