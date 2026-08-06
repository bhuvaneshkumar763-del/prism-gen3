import { describe, expect, it } from 'vitest';
import { createProvider } from './registry';

describe('createProvider', () => {
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

  it('returns null for an unknown provider id', () => {
    // @ts-expect-error deliberately testing an invalid id at the runtime boundary
    expect(createProvider('not-a-real-provider', {})).toBeNull();
  });
});
