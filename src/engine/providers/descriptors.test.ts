import { describe, expect, it } from 'vitest';
import { getBatchingHint, getProviderDescriptor, isProviderAvailable, providerDescriptors } from './descriptors';

describe('descriptors', () => {
  it('lists exactly the 4 providers', () => {
    expect(providerDescriptors.map((d) => d.id).sort()).toEqual(
      ['google', 'googleCloudTranslate', 'libretranslate', 'llm'].sort(),
    );
  });

  it('getProviderDescriptor finds a known provider and returns undefined for an unknown one', () => {
    expect(getProviderDescriptor('llm')?.displayName).toContain('AI');
    expect(getProviderDescriptor('nope')).toBeUndefined();
  });

  it('getBatchingHint returns grouping hints for llm and google, and undefined for providers without one', () => {
    expect(getBatchingHint('llm')).toEqual({ groupByBlock: true, maxGroupChars: 2000 });
    expect(getBatchingHint('google')).toEqual({ groupByBlock: true, maxGroupChars: 800 });
    expect(getBatchingHint('libretranslate')).toBeUndefined();
    expect(getBatchingHint('googleCloudTranslate')).toBeUndefined();
    expect(getBatchingHint('nope')).toBeUndefined();
  });

  it('isProviderAvailable is true for providers with no isAvailable check', () => {
    expect(isProviderAvailable('libretranslate')).toBe(true);
    expect(isProviderAvailable('google')).toBe(true);
  });

  it('isProviderAvailable is false for an unknown provider id', () => {
    expect(isProviderAvailable('nope')).toBe(false);
  });
});
