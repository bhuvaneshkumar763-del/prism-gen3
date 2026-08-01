import { z } from 'zod';

/**
 * The config schema — fresh key names and shape, not a port of the old
 * repo's `defaultConfig` (see the Gen 3 plan's Session 3 section). Grows
 * incrementally as later sessions add features — this is deliberately just
 * what's needed so far, not a guess at the full eventual field list.
 *
 * One thing kept from the old repo on purpose, because it's genuinely good
 * engineering independent of where it came from: storage is one key per
 * field (see src/platform/configStore.ts), not one combined JSON blob —
 * cheaper partial reads/writes, simpler migration semantics.
 *
 * Session 3 shipped `providerBaseUrl`/`providerApiKey` as generic
 * single-provider fields, on the assumption there'd only ever be one
 * configured provider at a time. Session 4 added more providers, each with
 * its own distinct settings (LLM needs a model name too; Google Cloud
 * needs just a key; Google/Builtin need nothing) — the generic naming was
 * premature. Renamed to per-provider fields via a real migration
 * (`CONFIG_SCHEMA_VERSION` 2) rather than kept as a wrong abstraction.
 */
export const configSchema = z.object({
  targetLanguage: z.string(),
  /** ISO 639-1 code, or 'auto' to let the provider detect it. */
  sourceLanguage: z.string(),
  pageTranslatorProvider: z.enum(['libretranslate', 'google', 'googleCloudTranslate', 'llm', 'builtin']),
  libreTranslateBaseUrl: z.string(),
  libreTranslateApiKey: z.string(),
  googleCloudTranslateApiKey: z.string(),
  llmBaseUrl: z.string(),
  llmApiKey: z.string(),
  llmModel: z.string(),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof Config;

export const defaultConfig: Config = {
  targetLanguage: 'es',
  sourceLanguage: 'auto',
  pageTranslatorProvider: 'libretranslate',
  libreTranslateBaseUrl: 'https://libretranslate.com',
  libreTranslateApiKey: '',
  googleCloudTranslateApiKey: '',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
};
