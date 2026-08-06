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
 *
 * Session 5 (auto-translate-on-load) added the 4 site/language allow-deny
 * list fields below — purely additive (new keys, no shape change to an
 * existing one), so no migration entry was needed: `configStore.ts`'s
 * `initConfig` already falls back to `defaultConfig`'s value (`[]`) for any
 * key absent from an existing install's storage.
 *
 * Post-launch UI-parity pass (bubble/popup/settings depth) added the four
 * `bubble*`/`sourceLanguageByHost` fields below — also purely additive, same
 * reasoning as Session 5's note above: an existing install missing these
 * keys just gets `defaultConfig`'s value until it writes one. No migration,
 * no version bump. Booleans, not the old pre-rewrite fork's `'yes'|'no'`
 * string enum — that enum only existed to match that fork's legacy
 * `chrome.storage.local` data, which this codebase never had.
 *
 * Same pass, Phase 2 (popup): `targetLanguages` (a recency-ordered list for
 * the popup's quick-pick pills — see `src/shared/config/listMutations.ts`'s
 * `addRecentTargetLanguage`) and `hoverTooltipEnabled`/`selectionPopupEnabled`
 * (both previously hardcoded-on in `entrypoints/content.ts` with no config
 * at all — now real togglable settings). Also purely additive.
 *
 * Same pass, Phase 3 (settings): `theme` and `translationCacheEnabled`.
 * `translationCacheEnabled` isn't decorative — `entrypoints/background.ts`'s
 * `translatePieces` handler actually skips the cache read/write when it's
 * off, not just a checkbox with no effect (the exact "shipped a settings
 * field with no effect" mistake this codebase's own custom-dictionary
 * scope note elsewhere warns against). Also purely additive.
 */
export const configSchema = z.object({
  targetLanguage: z.string(),
  /** ISO 639-1 code, or 'auto' to let the provider detect it. */
  sourceLanguage: z.string(),
  pageTranslatorProvider: z.enum(['google', 'googleCloudTranslate', 'llm']),
  googleCloudTranslateApiKey: z.string(),
  llmBaseUrl: z.string(),
  llmApiKey: z.string(),
  llmModel: z.string(),
  /** Hostnames the user has explicitly chosen to always/never auto-translate — takes priority over the language-based decision. */
  alwaysTranslateSites: z.array(z.string()),
  neverTranslateSites: z.array(z.string()),
  /** Detected source-language codes to always/never auto-translate from. */
  alwaysTranslateLangs: z.array(z.string()),
  neverTranslateLangs: z.array(z.string()),
  /** Global default for whether the floating bubble shows at all. Per-site overrides live in `bubbleByHost`. */
  bubbleEnabled: z.boolean(),
  /** Per-hostname override of `bubbleEnabled` — present means override, absent means "use the global default" (see `src/shared/config/siteOverrides.ts`). */
  bubbleByHost: z.record(z.string(), z.boolean()),
  /** Remembered edge-docked position, `null` until the user drags it once. */
  bubblePosition: z.object({ side: z.enum(['left', 'right']), yFrac: z.number() }).nullable(),
  /** Per-hostname source-language override, set via the bubble's "From" select. Absent means auto-detect. */
  sourceLanguageByHost: z.record(z.string(), z.string()),
  /** Recency-ordered list of target languages the user has actually picked — powers the popup's quick-pick pills, most recent first. */
  targetLanguages: z.array(z.string()),
  hoverTooltipEnabled: z.boolean(),
  selectionPopupEnabled: z.boolean(),
  theme: z.enum(['auto', 'light', 'dark']),
  translationCacheEnabled: z.boolean(),
});

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof Config;

export const defaultConfig: Config = {
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  // 'google' (free, no signup, no API key — see docs/decisions/0004-provider-scope.md)
  // is the only provider that works with zero configuration.
  pageTranslatorProvider: 'google',
  googleCloudTranslateApiKey: '',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  alwaysTranslateSites: [],
  neverTranslateSites: [],
  alwaysTranslateLangs: [],
  neverTranslateLangs: [],
  bubbleEnabled: true,
  bubbleByHost: {},
  bubblePosition: null,
  sourceLanguageByHost: {},
  targetLanguages: [],
  hoverTooltipEnabled: true,
  selectionPopupEnabled: true,
  theme: 'auto',
  translationCacheEnabled: true,
};
