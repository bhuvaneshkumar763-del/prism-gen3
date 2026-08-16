import { describe, expect, it } from 'vitest';
import { escapeHTML, unescapeHTML } from './htmlEscape';

describe('escapeHTML / unescapeHTML round trip', () => {
  it('round-trips ordinary text unchanged', () => {
    const text = 'Hello, "world" & friends! It\'s <great>.';
    expect(unescapeHTML(escapeHTML(text))).toBe(text);
  });

  it('round-trips text that already looks like HTML entities (prose describing HTML), not just double-escaping', () => {
    const text = '&lt;br&gt;';
    expect(unescapeHTML(escapeHTML(text))).toBe(text);
  });

  it('does not corrupt literal entity-like text into a decoded tag', () => {
    const escaped = escapeHTML('&lt;br&gt;');
    expect(escaped).toBe('&amp;lt;br&amp;gt;');
    expect(unescapeHTML(escaped)).toBe('&lt;br&gt;');
    expect(unescapeHTML(escaped)).not.toBe('<br>');
  });

  it('still decodes real single-escaped markup correctly', () => {
    expect(unescapeHTML('&lt;b&gt;bold&lt;/b&gt;')).toBe('<b>bold</b>');
  });
});
