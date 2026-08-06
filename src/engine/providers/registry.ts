import type { Translator } from '../translator';
import { isProviderAvailable, type ProviderId } from './descriptors';
import { createGoogleProvider } from './google';
import { createGoogleCloudTranslateProvider } from './googleCloudTranslate';
import { createLlmProvider } from './llm';

/**
 * Config each provider needs to be instantiated — deliberately plain data,
 * not the real config schema (`src/shared/config/schema.ts`) itself, so
 * this file stays decoupled from that schema's exact shape. The
 * extension-layer caller (background.ts) is responsible for mapping real
 * config into this shape.
 */
export interface ProviderConfig {
  google?: Record<string, never>;
  googleCloudTranslate?: { apiKey: string };
  llm?: { baseUrl: string; apiKey: string; model: string };
}

/**
 * Pure factory — no `chrome`/`browser` imports, safe to call from
 * anywhere. Returns null if the provider isn't configured or isn't
 * available in this environment.
 */
export function createProvider(id: ProviderId, config: ProviderConfig): Translator | null {
  if (!isProviderAvailable(id)) return null;

  switch (id) {
    case 'google':
      return createGoogleProvider();
    case 'googleCloudTranslate':
      return config.googleCloudTranslate ? createGoogleCloudTranslateProvider(config.googleCloudTranslate) : null;
    case 'llm':
      return config.llm ? createLlmProvider(config.llm) : null;
    default: {
      const exhaustiveCheck: never = id;
      return exhaustiveCheck;
    }
  }
}
