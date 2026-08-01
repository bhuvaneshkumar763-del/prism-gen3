import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBuiltinProvider } from './builtin';

describe('createBuiltinProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a network error for every piece when the Translator API is unavailable', async () => {
    vi.stubGlobal('Translator', undefined);

    const provider = createBuiltinProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'es', pieces: [['hello']] });

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
  });

  it('returns an error for every piece when the language pair is unavailable', async () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn(async () => 'unavailable'),
      create: vi.fn(),
    });

    const provider = createBuiltinProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'zz', pieces: [['hello']] });

    expect(results[0]?.ok).toBe(false);
  });

  it('translates each piece using a cached per-language-pair instance', async () => {
    const translate = vi.fn(async (text: string) => `${text}-translated`);
    const create = vi.fn(async () => ({ translate }));
    vi.stubGlobal('Translator', {
      availability: vi.fn(async () => 'available'),
      create,
    });

    const provider = createBuiltinProvider();
    const results = await provider.translateBatch({
      sourceLanguage: 'en',
      targetLanguage: 'es',
      pieces: [['hello'], ['world', 'again']],
    });

    expect(results).toEqual([
      { ok: true, value: ['hello-translated'] },
      { ok: true, value: ['world-translated', 'again-translated'] },
    ]);
    // create() is only called once — reused across both pieces via the cache.
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns a network error when translation itself throws', async () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => ({
        translate: vi.fn(async () => {
          throw new Error('model error');
        }),
      })),
    });

    const provider = createBuiltinProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'de', pieces: [['hi']] });

    expect(results[0]?.ok).toBe(false);
  });

  it('returns a network error for every piece when create() itself rejects', async () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn(async () => 'available'),
      create: vi.fn(async () => {
        throw new Error('model unavailable');
      }),
    });

    const provider = createBuiltinProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'nl', pieces: [['hi']] });

    expect(results[0]?.ok).toBe(false);
  });

  it('returns a network error when availability() itself rejects', async () => {
    vi.stubGlobal('Translator', {
      availability: vi.fn(async () => {
        throw new Error('boom');
      }),
      create: vi.fn(),
    });

    const provider = createBuiltinProvider();
    const results = await provider.translateBatch({ sourceLanguage: 'en', targetLanguage: 'fr', pieces: [['hi']] });

    expect(results[0]?.ok).toBe(false);
  });
});
