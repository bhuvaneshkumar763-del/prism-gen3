import { z } from 'zod';

/**
 * The config schema — fresh key names and shape, not a port of the old
 * repo's `defaultConfig` (see the Gen 3 plan's Session 3 section). Grows
 * incrementally as later sessions add features (more providers in Session
 * 4, more UI surfaces in Session 6, ...) — this is deliberately just what
 * Session 3's storage/migration mechanism needs to be real, not a guess at
 * the full eventual field list.
 *
 * One thing kept from the old repo on purpose, because it's genuinely good
 * engineering independent of where it came from: storage is one key per
 * field (see src/platform/configStore.ts), not one combined JSON blob —
 * cheaper partial reads/writes, simpler migration semantics.
 */
export const configSchema = z.object({
  targetLanguage: z.string(),
  /** ISO 639-1 code, or 'auto' to let the provider detect it. */
  sourceLanguage: z.string(),
  /** Only 'libretranslate' exists as of Session 2/3 — grows in Session 4. */
  pageTranslatorProvider: z.enum(['libretranslate']),
  providerBaseUrl: z.string(),
  providerApiKey: z.string(),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof Config;

export const defaultConfig: Config = {
  targetLanguage: 'es',
  sourceLanguage: 'auto',
  pageTranslatorProvider: 'libretranslate',
  providerBaseUrl: 'https://libretranslate.com',
  providerApiKey: '',
};
