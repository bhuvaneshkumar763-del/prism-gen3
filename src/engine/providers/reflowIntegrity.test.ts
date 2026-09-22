import { describe, expect, it } from 'vitest';
import { hasBoundaryReflow } from './reflowIntegrity';

/**
 * The exact reported failure, transcribed from the report's own
 * screenshots: sangtacviet.vip's facet panel, source (untranslated) beside
 * the corrupted first-load translation. Same entry count, no leaked
 * markers — both of google.ts's older signals pass it — but content has
 * moved across node boundaries.
 */
const REPORTED_SOURCE = [
  'Đô Thị(263673)',
  'Xuyên Qua(254923)',
  'Bản Gốc(238615)',
  'Huyền Huyễn Kỳ Huyễn(199579)',
  'Hệ Thống(192673)',
  'Huyền Huyễn(189348)',
  'Ngôn Tình(167599)',
  'Tình Yêu(165154)',
  'Đô Thị Ngôn Tình(163847)',
  'Hiện Đại Ngôn Tình(163673)',
];

const REPORTED_CORRUPTED = [
  'Urban (263673)',
  'Transmigration (254923)',
  'Original (238615)',
  'Fantasy/Supernatural (199579)',
  'System (192673) Fantasy (', // absorbed the head of the next node
  '189348)', // kept only its own tail
  'Romance (167599) Love (165154)', // absorbed the whole next node
  '(163847)', // holds the NEXT node's number, not its own
  'Urban Romance', // its own number went to the previous node
  'Modern Romance (163673)',
];

const REPORTED_GOOD = [
  'Urban (263673)',
  'Transmigration (254923)',
  'Original (238615)',
  'Fantasy (199579)',
  'System (192673)',
  'Fantasy (189348)',
  'Romance (167599)',
  'Love (165154)',
  'Urban Romance (163847)',
  'Modern Romance (163673)',
];

describe('hasBoundaryReflow', () => {
  it('flags the real reported same-count reflow (sangtacviet.vip facet chips)', () => {
    expect(hasBoundaryReflow(REPORTED_SOURCE, REPORTED_CORRUPTED)).toBe(true);
  });

  it("does NOT flag the same page's known-good translation — the one a retranslate produced", () => {
    expect(hasBoundaryReflow(REPORTED_SOURCE, REPORTED_GOOD)).toBe(false);
  });

  it('catches the bracket half on its own (a node left holding an unclosed paren)', () => {
    expect(
      hasBoundaryReflow(['Hệ Thống(192673)', 'Huyền Huyễn(189348)'], ['System (192673) Fantasy (', '189348)']),
    ).toBe(true);
  });

  it("catches the digit half on its own (a node holding its neighbour's number instead of its own)", () => {
    // Both values are bracket-balanced, so only the digit check can see this.
    expect(hasBoundaryReflow(['Tình Yêu(165154)', 'Đô Thị Ngôn Tình(163847)'], ['(163847)', 'Urban Romance'])).toBe(
      true,
    );
  });

  it('catches a node that came back empty while its source had real words', () => {
    expect(hasBoundaryReflow(['Hello there', 'Goodbye now'], ['Hello there Goodbye now', '   '])).toBe(true);
  });

  it('accepts an ordinary prose translation that reorders and changes length', () => {
    expect(
      hasBoundaryReflow(
        ['She left the party ', 'because it was late.'],
        ['Ella se fue de la fiesta ', 'porque era tarde.'],
      ),
    ).toBe(false);
  });

  it('does not flag a bracket legitimately split ACROSS two nodes — the source is already unbalanced, so balance says nothing', () => {
    // <span>(see </span><b>the docs)</b> — each node alone is unbalanced in
    // the source too, which is exactly why the check requires a balanced
    // source before it reads anything into an unbalanced output.
    expect(hasBoundaryReflow(['(see ', 'the docs)'], ['(consulte ', 'la documentación)'])).toBe(false);
  });

  it('tolerates a provider regrouping digit separators (1000 -> 1,000)', () => {
    expect(
      hasBoundaryReflow(['Total 1000 items', 'Page 2024 of many'], ['Total 1,000 items', 'Page 2,024 of many']),
    ).toBe(false);
  });

  it('tolerates full-width brackets being rewritten as ASCII, and mixed pairs', () => {
    expect(hasBoundaryReflow(['系统（192673）', '玄幻（189348）'], ['System (192673)', 'Fantasy（189348)'])).toBe(
      false,
    );
  });

  it('skips the digit check entirely when the provider localized numerals into another numeral system', () => {
    // Arabic-Indic digits: the ASCII run genuinely no longer appears, which
    // would otherwise flag every single node on the page.
    expect(hasBoundaryReflow(['Đô Thị(263673)', 'Hệ Thống(192673)'], ['حضري (٢٦٣٦٧٣)', 'نظام (١٩٢٦٧٣)'])).toBe(false);
  });

  it('ignores short numbers a translator may legitimately reword', () => {
    expect(hasBoundaryReflow(['Chapter 12', 'Part 7'], ['Capítulo doce', 'Parte siete'])).toBe(false);
  });

  it('never fires on a single-node piece, which has no boundary to reflow across', () => {
    expect(hasBoundaryReflow(['Hệ Thống(192673)'], ['System ('])).toBe(false);
  });

  it("returns false on a length mismatch — that is the caller's own earlier, more specific signal", () => {
    expect(hasBoundaryReflow(['a(1111)', 'b(2222)'], ['A (1111)'])).toBe(false);
  });
});
