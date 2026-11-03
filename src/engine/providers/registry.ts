import type { Translator } from '../translator';
import { isProviderAvailable, type ProviderId } from './descriptors';
import { createGoogleProvider } from './google';
import { createGoogleCloudTranslateProvider } from './googleCloudTranslate';

/**
 * Config each provider needs, as plain data decoupled from the config schema;
 * background.ts maps real config into this shape.
 */
export interface ProviderConfig {
  googleCloudTranslate?: { apiKey: string };
}

/** Pure factory. Returns null if the provider isn't configured or isn't available here. */
export function createProvider(id: ProviderId, config: ProviderConfig): Translator | null {
  if (!isProviderAvailable(id)) return null;

  switch (id) {
    case 'google':
      return createGoogleProvider();
    case 'googleCloudTranslate':
      return config.googleCloudTranslate ? createGoogleCloudTranslateProvider(config.googleCloudTranslate) : null;
    default: {
      const exhaustiveCheck: never = id;
      return exhaustiveCheck;
    }
  }
}
