/**
 * HTML-escaping helpers for providers that wrap pieces in HTML-ish marker
 * tags (Google's `<pre>`/`<a i=N>`). Everything is escaped, no exemptions.
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
  // &amp; must decode last, or double-escaped text ("&amp;lt;br&amp;gt;")
  // would be decoded twice into "<br>" instead of "&lt;br&gt;".
  return unsafe
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
