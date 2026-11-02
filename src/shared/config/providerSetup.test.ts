import { describe, expect, it } from 'vitest';
import { missingProviderSetup, type ProviderSetupFields } from './providerSetup';

const empty: ProviderSetupFields = {
  googleCloudTranslateApiKey: '',
};

describe('missingProviderSetup', () => {
  it('never flags the free Google provider — it needs nothing', () => {
    expect(missingProviderSetup('google', empty)).toBeNull();
  });

  it('flags Cloud Translate without an API key, and clears once one is set', () => {
    expect(missingProviderSetup('googleCloudTranslate', empty)).toEqual(['API key']);
    expect(missingProviderSetup('googleCloudTranslate', { ...empty, googleCloudTranslateApiKey: 'k' })).toBeNull();
  });

  it('treats a whitespace-only value as missing — it would be rejected by the provider anyway', () => {
    expect(missingProviderSetup('googleCloudTranslate', { ...empty, googleCloudTranslateApiKey: '   ' })).toEqual([
      'API key',
    ]);
  });
});
