import type { ProviderId } from '../../engine/providers/descriptors';
import type { Config } from './schema';

export type ProviderSetupFields = Pick<Config, 'googleCloudTranslateApiKey'>;

/**
 * What a provider still needs before it can translate, as the labels the
 * settings page uses, or `null` when it's ready. The one place this rule
 * lives: `background.ts` and the UI both use it. Not `descriptors.ts`'s
 * `requiresKey`, which can't say which field is missing.
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
    default: {
      const exhaustiveCheck: never = id;
      return exhaustiveCheck;
    }
  }
  return missing.length > 0 ? missing : null;
}
