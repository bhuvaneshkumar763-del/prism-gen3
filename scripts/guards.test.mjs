import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFiles as checkEnginePurity } from './check-engine-purity.mjs';
import { checkFiles as checkSolidReactivity } from './check-solid-reactivity.mjs';

// The fixtures end in .txt so the type checker and linter skip them.
const fixture = (name) => [resolve('scripts/fixtures/guards', name)];

describe('engine-purity guard', () => {
  it('rejects every kind of extension or layer import', () => {
    const violations = checkEnginePurity(fixture('engine-bad-imports.ts.txt'));
    for (const name of [
      '#imports',
      '@webext-core/messaging',
      'wxt/browser',
      'src/platform/',
      'entrypoints/',
      'components/',
    ]) {
      expect(
        violations.some((v) => v.includes(name)),
        name,
      ).toBe(true);
    }
    expect(violations).toHaveLength(6);
  });

  it('rejects ambient extension and WXT globals, in code and in types', () => {
    const violations = checkEnginePurity(fixture('engine-bad-globals.ts.txt'));
    expect(violations.filter((v) => v.includes("'chrome'"))).toHaveLength(1);
    expect(violations.filter((v) => v.includes("'browser'"))).toHaveLength(2);
    expect(violations.filter((v) => v.includes("'storage'"))).toHaveLength(1);
  });

  it('accepts shared imports, locally declared names, property names, strings and comments', () => {
    expect(checkEnginePurity(fixture('engine-good.ts.txt'))).toEqual([]);
  });
});

describe('Solid-reactivity guard', () => {
  it('rejects non-reactive config reads during render, including through helpers and createMemo', () => {
    const violations = checkSolidReactivity(fixture('reactivity-bad.tsx.txt'));
    expect(violations).toHaveLength(5);
    expect(violations.some((v) => v.includes('createMemo'))).toBe(true);
    expect(violations.some((v) => v.includes('label()'))).toBe(true);
    expect(violations.some((v) => v.includes('language()'))).toBe(true);
  });

  it('accepts reads in event handlers, signals initialised from config, and strings', () => {
    expect(checkSolidReactivity(fixture('reactivity-good.tsx.txt'))).toEqual([]);
  });
});
