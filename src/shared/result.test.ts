import { describe, expect, it } from 'vitest';
import { err, ok, unwrapOr } from './result';

describe('Result', () => {
  it('ok() creates a success result carrying its value', () => {
    const r = ok(42);
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it('err() creates a failure result carrying its error', () => {
    const e = new Error('boom');
    const r = err(e);
    expect(r).toEqual({ ok: false, error: e });
  });

  it('unwrapOr() returns the value for an ok result', () => {
    expect(unwrapOr(ok('hi'), 'fallback')).toBe('hi');
  });

  it('unwrapOr() returns the fallback for an err result', () => {
    expect(unwrapOr(err(new Error('x')), 'fallback')).toBe('fallback');
  });
});
