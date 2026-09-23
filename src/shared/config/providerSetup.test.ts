import { describe, expect, it } from 'vitest';
import { missingProviderSetup, type ProviderSetupFields } from './providerSetup';

const empty: ProviderSetupFields = {
  googleCloudTranslateApiKey: '',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
};

describe('missingProviderSetup', () => {
  it('never flags the free Google provider — it needs nothing', () => {
    expect(missingProviderSetup('google', empty)).toBeNull();
  });

  it('flags Cloud Translate without an API key, and clears once one is set', () => {
    expect(missingProviderSetup('googleCloudTranslate', empty)).toEqual(['API key']);
    expect(missingProviderSetup('googleCloudTranslate', { ...empty, googleCloudTranslateApiKey: 'k' })).toBeNull();
  });

  it('lists every missing AI field, in the order the settings page shows them', () => {
    expect(missingProviderSetup('llm', empty)).toEqual(['server URL', 'API key', 'model']);
    expect(missingProviderSetup('llm', { ...empty, llmBaseUrl: 'http://localhost:11434/v1/chat/completions' })).toEqual(
      ['API key', 'model'],
    );
  });

  it('treats a whitespace-only value as missing — it would be rejected by the provider anyway', () => {
    expect(missingProviderSetup('googleCloudTranslate', { ...empty, googleCloudTranslateApiKey: '   ' })).toEqual([
      'API key',
    ]);
  });

  it('is satisfied by a fully configured AI provider', () => {
    expect(missingProviderSetup('llm', { ...empty, llmBaseUrl: 'u', llmApiKey: 'k', llmModel: 'm' })).toBeNull();
  });
});
