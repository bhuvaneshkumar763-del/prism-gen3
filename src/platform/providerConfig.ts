/**
 * The platform-adapter boundary in action (Gen 3 plan, Session 2): the
 * engine's LibreTranslate provider takes a plain `{baseUrl, apiKey}` and
 * has no idea where that came from. This is the one place allowed to read
 * it from `browser.storage.local` — a genuinely `chrome`/`browser`-
 * namespaced API, unlike `fetch` (which the provider itself calls
 * directly — see src/engine/providers/libretranslate.ts's header comment
 * for why that's fine per the purity rule).
 *
 * A real config schema/store lands in Session 3 — this is deliberately
 * the smallest possible version of "read provider config from storage"
 * to prove the seam, not a preview of the real config layer.
 */

import type { LibreTranslateOptions } from '../engine/providers/libretranslate';

const STORAGE_KEYS = {
  baseUrl: 'libreTranslateBaseUrl',
  apiKey: 'libreTranslateApiKey',
} as const;

const DEFAULT_BASE_URL = 'https://libretranslate.com';

export async function getLibreTranslateConfig(): Promise<LibreTranslateOptions> {
  const stored = await browser.storage.local.get([STORAGE_KEYS.baseUrl, STORAGE_KEYS.apiKey]);
  return {
    baseUrl: (stored[STORAGE_KEYS.baseUrl] as string | undefined) || DEFAULT_BASE_URL,
    apiKey: stored[STORAGE_KEYS.apiKey] as string | undefined,
  };
}
