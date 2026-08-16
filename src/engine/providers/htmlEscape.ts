/**
 * Shared HTML-escaping helpers for providers that wrap pieces in HTML-ish
 * marker tags (Google's `<a i=N>`, Bing's `<bN>`). Bing's custom-dictionary
 * `<mstrans:dictionary translation="...">` tags are protected from
 * escaping first — a real Bing API feature this must not corrupt if a
 * future dictionary feature (Session 6) ever emits it.
 */

const BING_DICTIONARY_OPEN = '<mstrans:dictionary translation="';
const BING_DICTIONARY_CLOSE = '"></mstrans:dictionary>';
const BING_DICTIONARY_OPEN_PLACEHOLDER = '@-/629^*';
const BING_DICTIONARY_CLOSE_PLACEHOLDER = '^$537+*';

export function escapeHTML(unsafe: string): string {
  let s = unsafe
    .replaceAll(BING_DICTIONARY_OPEN, BING_DICTIONARY_OPEN_PLACEHOLDER)
    .replaceAll(BING_DICTIONARY_CLOSE, BING_DICTIONARY_CLOSE_PLACEHOLDER);

  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  return s
    .replaceAll(BING_DICTIONARY_OPEN_PLACEHOLDER, BING_DICTIONARY_OPEN)
    .replaceAll(BING_DICTIONARY_CLOSE_PLACEHOLDER, BING_DICTIONARY_CLOSE);
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
