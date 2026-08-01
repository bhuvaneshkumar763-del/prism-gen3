import { describe, expect, it } from 'vitest';
import { err, ok } from '../shared/result';
import { type Translator, translateOne } from './translator';

function stubTranslator(
  outcomes: Array<ReturnType<typeof ok<string[]>> | ReturnType<typeof err<{ kind: 'network'; message: string }>>>,
): Translator {
  return {
    async translateBatch() {
      return outcomes;
    },
  };
}

describe('translateOne', () => {
  it('unwraps a single-piece batch result into a plain string', async () => {
    const translator = stubTranslator([ok(['hola'])]);
    const result = await translateOne(translator, 'hello', 'en', 'es');
    expect(result).toEqual({ ok: true, value: 'hola' });
  });

  it('propagates a provider error outcome', async () => {
    const translator = stubTranslator([err({ kind: 'network', message: 'boom' })]);
    const result = await translateOne(translator, 'hello', 'en', 'es');
    expect(result).toEqual({ ok: false, error: { kind: 'network', message: 'boom' } });
  });

  it('returns a parse error when the batch comes back empty', async () => {
    const translator = stubTranslator([]);
    const result = await translateOne(translator, 'hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
  });

  it('returns a parse error when the piece result has no string at index 0', async () => {
    const translator = stubTranslator([ok([])]);
    const result = await translateOne(translator, 'hello', 'en', 'es');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('parse');
  });
});
