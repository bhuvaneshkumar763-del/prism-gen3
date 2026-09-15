import { describe, expect, it } from 'vitest';
import {
  bool,
  configValidators,
  enumOf,
  nullableObject,
  num,
  parsePartialConfigOrThrow,
  recordOf,
  str,
  strArray,
  validatePartialConfig,
} from './validate';

describe('primitive validators', () => {
  it('str accepts a string, rejects everything else', () => {
    expect(str('hello')).toEqual({ ok: true, value: 'hello' });
    expect(str(42).ok).toBe(false);
    expect(str(null).ok).toBe(false);
    expect(str(undefined).ok).toBe(false);
  });

  it('bool accepts a boolean, rejects everything else', () => {
    expect(bool(true)).toEqual({ ok: true, value: true });
    expect(bool(false)).toEqual({ ok: true, value: false });
    expect(bool('true').ok).toBe(false);
    expect(bool(1).ok).toBe(false);
  });

  it('num accepts a finite number, rejects NaN/Infinity/non-numbers', () => {
    expect(num(3.5)).toEqual({ ok: true, value: 3.5 });
    expect(num(Number.NaN).ok).toBe(false);
    expect(num(Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(num('3').ok).toBe(false);
  });

  it('strArray accepts an array of strings, rejects a mixed or non-array value', () => {
    expect(strArray(['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    expect(strArray([])).toEqual({ ok: true, value: [] });
    expect(strArray(['a', 1]).ok).toBe(false);
    expect(strArray('not an array').ok).toBe(false);
  });

  it('enumOf accepts only the listed values', () => {
    const v = enumOf('a', 'b', 'c');
    expect(v('b')).toEqual({ ok: true, value: 'b' });
    expect(v('z').ok).toBe(false);
    expect(v(1).ok).toBe(false);
  });
});

describe('recordOf', () => {
  const boolRecord = recordOf(bool);

  it('accepts a string-keyed object whose every value passes the inner validator', () => {
    const result = boolRecord({ 'example.com': true, 'foo.org': false });
    expect(result).toEqual({ ok: true, value: { 'example.com': true, 'foo.org': false } });
  });

  it('accepts an empty object', () => {
    expect(boolRecord({})).toEqual({ ok: true, value: {} });
  });

  it('rejects when any single value fails the inner validator', () => {
    const result = boolRecord({ 'example.com': true, 'foo.org': 'not a bool' });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object (array, string, null)', () => {
    expect(boolRecord([]).ok).toBe(false);
    expect(boolRecord('x').ok).toBe(false);
    expect(boolRecord(null).ok).toBe(false);
  });
});

describe('nullableObject', () => {
  const position = nullableObject({ side: enumOf('left', 'right'), yFrac: num });

  it('accepts null', () => {
    expect(position(null)).toEqual({ ok: true, value: null });
  });

  it('accepts a matching object', () => {
    expect(position({ side: 'left', yFrac: 0.5 })).toEqual({ ok: true, value: { side: 'left', yFrac: 0.5 } });
  });

  it('drops unknown keys rather than rejecting them — same zod-strip behavior this replaces', () => {
    const result = position({ side: 'right', yFrac: 0.2, extra: 'ignored' });
    expect(result).toEqual({ ok: true, value: { side: 'right', yFrac: 0.2 } });
    if (result.ok) expect(Object.hasOwn(result.value as object, 'extra')).toBe(false);
  });

  it('rejects when a known field has the wrong type', () => {
    expect(position({ side: 'left', yFrac: 'not a number' }).ok).toBe(false);
  });

  it('rejects a non-object, non-null value', () => {
    expect(position('x').ok).toBe(false);
    expect(position(42).ok).toBe(false);
  });
});

describe('configValidators', () => {
  it('has exactly one validator per config key, with no gaps (the compile-time mapped-type coupling backed by a runtime check)', () => {
    const keys = Object.keys(configValidators);
    expect(keys).toContain('targetLanguage');
    expect(keys).toContain('bubblePosition');
    expect(keys).toContain('selectionPopupSkipTargetLanguageText');
    expect(keys.length).toBe(23);
  });
});

describe('validatePartialConfig', () => {
  it('accepts a partial object, returning only the keys that were present', () => {
    const result = validatePartialConfig({ targetLanguage: 'de' });
    expect(result).toEqual({ ok: true, value: { targetLanguage: 'de' } });
  });

  it('drops unknown keys instead of rejecting them — real requirement: a newer-build export must still import on an older build', () => {
    const result = validatePartialConfig({ notARealField: 'x' });
    expect(result).toEqual({ ok: true, value: {} });
  });

  it('accepts an empty object', () => {
    expect(validatePartialConfig({})).toEqual({ ok: true, value: {} });
  });

  it('rejects when a known key has the wrong type, naming the offending path', () => {
    const result = validatePartialConfig({ targetLanguage: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.path).toBe('targetLanguage');
  });

  it('rejects a non-object top-level value', () => {
    expect(validatePartialConfig(42).ok).toBe(false);
    expect(validatePartialConfig(null).ok).toBe(false);
    expect(validatePartialConfig([1, 2]).ok).toBe(false);
  });
});

describe('parsePartialConfigOrThrow', () => {
  it('returns the validated value on success', () => {
    expect(parsePartialConfigOrThrow({ targetLanguage: 'ja' })).toEqual({ targetLanguage: 'ja' });
  });

  it('throws, naming the field, on a known key with the wrong type', () => {
    expect(() => parsePartialConfigOrThrow({ targetLanguage: 42 })).toThrow(/targetLanguage/);
  });
});
