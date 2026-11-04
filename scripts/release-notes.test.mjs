import { describe, expect, it } from 'vitest';
import { BODY_LIMIT, checkedOnProblem, extractSection, fitToLimit } from './release-notes.mjs';

const changelog = `# prism-gen3

## 0.3.2-beta.1

### Patch Changes

- Fix one thing. The format is \`Checked on: <page>, <browser>, <date>\`.

  Checked on: sangtacviet, Orion on iPhone, 2026-11-03

## 0.3.2-beta.0

- Older.
`;

describe('extractSection', () => {
  it("returns one version's entry, up to the next version", () => {
    const section = extractSection(changelog, '0.3.2-beta.1');
    expect(section).toContain('Fix one thing.');
    expect(section).not.toContain('Older.');
  });

  it('returns the last entry through the end of the file', () => {
    expect(extractSection(changelog, '0.3.2-beta.0')).toContain('Older.');
  });

  it('returns nothing for a version with no entry', () => {
    expect(extractSection(changelog, '9.9.9')).toBe('');
  });
});

describe('checkedOnProblem', () => {
  it('accepts a real Checked on line', () => {
    expect(checkedOnProblem(extractSection(changelog, '0.3.2-beta.1'))).toBeNull();
  });

  it('refuses a missing line, even when the text quotes the format', () => {
    expect(checkedOnProblem('- Releases need `Checked on: <page>, <browser>, <date>`.')).toMatch(/no 'Checked on/);
  });

  it('refuses a placeholder', () => {
    expect(checkedOnProblem('  Checked on: TODO')).toMatch(/placeholder/);
    expect(checkedOnProblem('  Checked on: tbd later')).toMatch(/placeholder/);
    expect(checkedOnProblem('  Checked on:   ')).toMatch(/placeholder/);
  });
});

describe('checkedOnProblem: what the line must say', () => {
  const now = new Date('2026-11-03T12:00:00Z');

  it('accepts the lines real releases use', () => {
    for (const line of [
      'Checked on: sangtacviet, Orion on iPhone, 2026-11-02',
      'Checked on: built extension in desktop Chromium (9 checks), plus live free Google, 2026-11-03. iPhone next.',
      'Checked on: pixiv, Firefox, 2025-01-31',
    ])
      expect(checkedOnProblem(line, now), line).toBeNull();
  });

  it('refuses a line without a YYYY-MM-DD date', () => {
    expect(checkedOnProblem('Checked on: sangtacviet, Orion on iPhone', now)).toMatch(/date/);
    expect(checkedOnProblem('Checked on: sangtacviet, Orion on iPhone, 3 Nov 2026', now)).toMatch(/date/);
    expect(checkedOnProblem('Checked on: sangtacviet, Orion on iPhone, 11/03/2026', now)).toMatch(/date/);
  });

  it('refuses a date that is not on the calendar', () => {
    expect(checkedOnProblem('Checked on: sangtacviet, Safari, 2026-02-30', now)).toMatch(/date/);
    expect(checkedOnProblem('Checked on: sangtacviet, Safari, 2026-13-01', now)).toMatch(/date/);
  });

  it('refuses a date in the future, allowing for time zones ahead of UTC', () => {
    expect(checkedOnProblem('Checked on: sangtacviet, Safari, 2026-11-05', now)).toMatch(/future/);
    expect(checkedOnProblem('Checked on: sangtacviet, Safari, 2027-01-01', now)).toMatch(/future/);
    // 12:00 UTC on the 3rd is already the 4th in Vietnam and Kiribati.
    expect(checkedOnProblem('Checked on: sangtacviet, Safari, 2026-11-04', now)).toBeNull();
  });

  it('refuses a line that names no browser or device', () => {
    expect(checkedOnProblem('Checked on: sangtacviet, 2026-11-02', now)).toMatch(/browser/);
    expect(checkedOnProblem('Checked on: looked fine, 2026-11-02', now)).toMatch(/browser/);
  });

  it('refuses when any of several lines is incomplete', () => {
    const notes = 'Checked on: pixiv, Firefox, 2026-11-01\n\nChecked on: sangtacviet, 2026-11-02';
    expect(checkedOnProblem(notes, now)).toMatch(/browser/);
  });
});

describe('fitToLimit', () => {
  it('leaves notes that fit alone', () => {
    expect(fitToLimit('short', '1.0.0', 'o/r')).toEqual({ notes: 'short', trimmed: false });
  });

  it('cuts long notes under the limit and links to the full changelog', () => {
    const { notes, trimmed } = fitToLimit('x'.repeat(130_000), '1.0.0', 'o/r');
    expect(trimmed).toBe(true);
    expect(notes.length).toBeLessThanOrEqual(BODY_LIMIT);
    expect(notes).toContain('https://github.com/o/r/blob/v1.0.0/CHANGELOG.md');
  });
});
