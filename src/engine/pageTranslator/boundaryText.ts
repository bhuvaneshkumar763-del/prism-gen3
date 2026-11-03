/**
 * Opening marks. The source's leading run is only carried up to the first of
 * these, so a source `¿` or `（` never gets forced onto a translation that
 * writes (or omits) its own form of that mark.
 */
const NOT_CARRIED = new Set([
  '¿',
  '¡',
  '«',
  '‹',
  '「',
  '『',
  '„',
  '“',
  '‘',
  '〈',
  '《',
  '（',
  '【',
  '〔',
  '〖',
  '［',
  '｛',
  '(',
  '[',
  '{',
]);

/** Marks that close the previous sentence or clause, in any script. */
const LEADING_CLOSING_MARK = /^[.,;:!?)\]}»」』。，、！？；：…]/u;

/**
 * Rebuilds a translated text node's boundary whitespace and punctuation.
 * Google sometimes drops a leading ". " that closed the previous sentence
 * and sometimes echoes it, so the carried prefix is removed from the
 * translation before re-adding it, to avoid a doubled mark. When the
 * translation starts with its own closing mark (`。` translated to `.`), that
 * one wins. The translation's own opening marks (`¿`, `「`, ...) are kept.
 */
export function restoreBoundaryText(original: { leading: string; trailing: string }, rawTranslated: string): string {
  let carried = '';
  for (const ch of original.leading) {
    if (NOT_CARRIED.has(ch)) break;
    carried += ch;
  }
  let body = rawTranslated.trimEnd().trimStart();
  const carriedMark = carried.replace(/\s+/g, '');
  if (carriedMark && body.startsWith(carriedMark)) {
    body = body.slice(carriedMark.length).trimStart();
  } else if (carriedMark && LEADING_CLOSING_MARK.test(body)) {
    return carried.match(/^\s*/)?.[0] + body + original.trailing;
  }
  return carried + body + original.trailing;
}
