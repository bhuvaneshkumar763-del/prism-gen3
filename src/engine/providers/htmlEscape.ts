/**
 * Shared HTML-escaping helpers for providers that wrap pieces in HTML-ish
 * marker tags (Google's `<a i=N>`).
 *
 * Round-6 audit: this used to carve out an exemption for Bing's
 * custom-dictionary `<mstrans:dictionary translation="...">` tags,
 * protecting a literal occurrence of that substring from escaping —
 * "a real Bing API feature this must not corrupt if a future dictionary
 * feature (Session 6) ever emits it." No such feature was ever built (this
 * codebase has no Bing provider at all — `registry.ts` lists only
 * google/googleCloudTranslate/llm), so the carve-out was dead weight. Worse
 * than inert: page text that happens to contain that literal marker
 * substring (rare, but not impossible — a page discussing this exact XML
 * tag syntax) skipped escaping for whatever sat between the markers,
 * letting a stray `<`/`>`/`"` reach this file's callers' own wire format
 * (Google's `<pre>`/`<a i=N>` markup) unescaped — real corruption risk for
 * a feature that protected nothing real.
 */

export function escapeHTML(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function unescapeHTML(unsafe: string): string {
  // &amp; must decode last: decoding it first would turn text that was
  // legitimately double-escaped (e.g. the literal prose "&lt;br&gt;",
  // escaped by escapeHTML into "&amp;lt;br&amp;gt;") into a string that
  // then matches &lt;/&gt; below and gets decoded a second time, corrupting
  // it into "<br>" instead of round-tripping back to "&lt;br&gt;".
  return unsafe
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
