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

  it('escapes a literal occurrence of the (removed) Bing dictionary marker syntax like any other text — real bug this closed, found via a round-6 audit: a dead carve-out (no Bing provider exists in this codebase — registry.ts lists only google/googleCloudTranslate/llm) used to protect a literal `<mstrans:dictionary translation="...">` substring from escaping entirely, so page text that happened to contain it (a page discussing this exact XML tag syntax, however rare) reached this file\'s callers\' own wire format (Google\'s <pre>/<a i=N> markup) with unescaped `<`/`>`/`"` characters — real corruption risk for a feature that protected nothing real', () => {
    const text = 'See the <mstrans:dictionary translation="foo"></mstrans:dictionary> tag.';
    const escaped = escapeHTML(text);

    expect(escaped).not.toContain('<mstrans:dictionary');
    expect(escaped).toContain('&lt;mstrans:dictionary');
    expect(unescapeHTML(escaped)).toBe(text);
  });
});
