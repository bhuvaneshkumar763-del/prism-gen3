import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from './registry';

describe('createProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a libretranslate provider when configured', () => {
    const provider = createProvider('libretranslate', { libretranslate: { baseUrl: 'https://example.com' } });
    expect(provider).not.toBeNull();
  });

  it('returns null for libretranslate when unconfigured', () => {
    expect(createProvider('libretranslate', {})).toBeNull();
  });

  it('creates a google provider unconditionally (no config needed)', () => {
    expect(createProvider('google', {})).not.toBeNull();
  });

  it('creates a googleCloudTranslate provider only when a key is configured', () => {
    expect(createProvider('googleCloudTranslate', {})).toBeNull();
    expect(createProvider('googleCloudTranslate', { googleCloudTranslate: { apiKey: 'k' } })).not.toBeNull();
  });

  it('creates an llm provider only when configured', () => {
    expect(createProvider('llm', {})).toBeNull();
    expect(
      createProvider('llm', { llm: { baseUrl: 'https://example.com', apiKey: 'k', model: 'gpt-4o-mini' } }),
    ).not.toBeNull();
  });

  it('creates a builtin provider when the Translator API is available', () => {
    vi.stubGlobal('Translator', { availability: vi.fn(), create: vi.fn() });
    expect(createProvider('builtin', {})).not.toBeNull();
  });

  it('returns null for an unavailable provider even when configured', () => {
    vi.stubGlobal('Translator', undefined);
    // builtin has no config requirement but isAvailable() gates it.
    expect(createProvider('builtin', {})).toBeNull();
  });

  it('returns null for an unknown provider id', () => {
    // @ts-expect-error deliberately testing an invalid id at the runtime boundary
    expect(createProvider('not-a-real-provider', {})).toBeNull();
  });
});
