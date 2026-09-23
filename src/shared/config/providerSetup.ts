import type { ProviderId } from '../../engine/providers/descriptors';
import type { Config } from './schema';

export type ProviderSetupFields = Pick<Config, 'googleCloudTranslateApiKey' | 'llmBaseUrl' | 'llmApiKey' | 'llmModel'>;

/**
 * What a provider still needs before it can translate, as the labels the
 * settings page uses — or `null` when it's ready.
 *
 * The ONE place this rule lives. `background.ts`'s `buildProviderConfig`
 * decides whether a provider can be created from exactly this, and the UI
 * uses it to say "needs setup" before a translate fails. Previously the UI
 * said nothing at all: choosing an unconfigured provider was only discovered
 * when the next translation failed.
 *
 * Deliberately NOT `descriptors.ts`'s `requiresKey` flag, which is a single
 * boolean and can't say which of several fields is missing.
 *
 * The AI provider requires an API key even for a local server, because
 * that's what the provider factory enforces today — a local server that
 * doesn't check authentication accepts any placeholder. Whether it should
 * require one at all is a question for the separately deferred AI-provider
 * round, not something to change silently here.
 */
export function missingProviderSetup(id: ProviderId, fields: ProviderSetupFields): string[] | null {
  const has = (value: string) => value.trim() !== '';
  const missing: string[] = [];
  switch (id) {
    case 'google':
      return null;
    case 'googleCloudTranslate':
      if (!has(fields.googleCloudTranslateApiKey)) missing.push('API key');
      break;
    case 'llm':
      if (!has(fields.llmBaseUrl)) missing.push('server URL');
      if (!has(fields.llmApiKey)) missing.push('API key');
      if (!has(fields.llmModel)) missing.push('model');
      break;
    default: {
      const exhaustiveCheck: never = id;
      return exhaustiveCheck;
    }
  }
  return missing.length > 0 ? missing : null;
}
