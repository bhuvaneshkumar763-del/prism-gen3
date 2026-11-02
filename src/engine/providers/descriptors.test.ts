import { describe, expect, it } from 'vitest';
import { getBatchingHint, getProviderDescriptor, isProviderAvailable, providerDescriptors } from './descriptors';

describe('descriptors', () => {
  it('lists exactly the 2 providers', () => {
    expect(providerDescriptors.map((d) => d.id).sort()).toEqual(['google', 'googleCloudTranslate'].sort());
  });

  it('getProviderDescriptor finds a known provider and returns undefined for an unknown one', () => {
    expect(getProviderDescriptor('googleCloudTranslate')?.displayName).toContain('Google Cloud');
    expect(getProviderDescriptor('nope')).toBeUndefined();
  });

  it('getBatchingHint returns a grouping hint for google, and undefined for providers without one', () => {
    // google's batchingHint was re-enabled (round-3 audit follow-up) now
    // that google.ts has its own repair mechanism for the reflow
    // corruption that got it removed post-launch — see descriptors.ts's
    // comment on the google entry.
    expect(getBatchingHint('google')).toEqual({ groupByBlock: true, maxGroupChars: 2000 });
    expect(getBatchingHint('googleCloudTranslate')).toBeUndefined();
    expect(getBatchingHint('nope')).toBeUndefined();
  });

  it("getBatchingHint turns grouping off when Settings' paragraph-grouping switch is off, keeping the rest of the hint", () => {
    expect(getBatchingHint('google', false)).toEqual({ groupByBlock: false, maxGroupChars: 2000 });
    expect(getBatchingHint('google', true)).toEqual({ groupByBlock: true, maxGroupChars: 2000 });
    expect(getBatchingHint('googleCloudTranslate', false)).toBeUndefined();
  });

  it('isProviderAvailable is true for providers with no isAvailable check', () => {
    expect(isProviderAvailable('google')).toBe(true);
  });

  it('isProviderAvailable is false for an unknown provider id', () => {
    expect(isProviderAvailable('nope')).toBe(false);
  });
});
