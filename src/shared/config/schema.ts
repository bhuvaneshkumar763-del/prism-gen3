/**
 * The config schema. Stored one key per field (see src/platform/configStore.ts),
 * so a new field needs no migration: an install missing the key just gets
 * `defaultConfig`'s value. Only renames/removals need a migration.
 *
 * `Config` is hand-written (no schema library, for bundle size);
 * `validate.ts`'s `configValidators` is a mapped type over it, so a field
 * without a validator is a compile error.
 */
export interface Config {
  targetLanguage: string;
  /** ISO 639-1 code, or 'auto' to let the provider detect it. */
  sourceLanguage: string;
  pageTranslatorProvider: 'google' | 'googleCloudTranslate';
  googleCloudTranslateApiKey: string;
  /** Hostnames the user has explicitly chosen to always/never auto-translate — takes priority over the language-based decision. */
  alwaysTranslateSites: string[];
  neverTranslateSites: string[];
  /** Detected source-language codes to always/never auto-translate from. */
  alwaysTranslateLangs: string[];
  neverTranslateLangs: string[];
  /** Global default for whether the floating bubble shows at all. Per-site overrides live in `bubbleByHost`. */
  bubbleEnabled: boolean;
  /** Per-hostname override of `bubbleEnabled` — present means override, absent means "use the global default" (see `src/shared/config/siteOverrides.ts`). */
  bubbleByHost: Record<string, boolean>;
  /** Remembered edge-docked position, `null` until the user drags it once. */
  bubblePosition: { side: 'left' | 'right'; yFrac: number } | null;
  /** Per-hostname source-language override, set via the bubble's "From" select. Absent means auto-detect. */
  sourceLanguageByHost: Record<string, string>;
  /** Recency-ordered list of target languages the user has actually picked — powers the popup's quick-pick pills, most recent first. */
  targetLanguages: string[];
  hoverTooltipEnabled: boolean;
  selectionPopupEnabled: boolean;
  theme: 'auto' | 'light' | 'dark';
  translationCacheEnabled: boolean;
  /**
   * Whether `<pre>` blocks get translated. Default on: some sites use `<pre>`
   * for plain prose. `<code>` stays protected regardless.
   */
  translatePreTags: boolean;
  /**
   * Whether a provider that groups a paragraph's text nodes into one request
   * (Google, for sentence context) gets to. Default `true`. The off switch
   * lets a user escape Google moving words across links and styled spans
   * without a release.
   */
  groupParagraphs: boolean;
  /**
   * Hide the selection-translate trigger for a selection with nothing
   * translatable in it (a lone character, or only punctuation/digits/
   * whitespace). Default `true`.
   */
  selectionPopupSkipInvalidText: boolean;
  /**
   * Hide the selection-translate trigger when the selected text is already
   * confidently detected as the target language. Opt-in (default `false`).
   */
  selectionPopupSkipTargetLanguageText: boolean;
}

export type ConfigKey = keyof Config;

export const defaultConfig: Config = {
  targetLanguage: 'en',
  sourceLanguage: 'auto',
  // 'google' (free, no signup, no API key — see docs/decisions/0004-provider-scope.md)
  // is the only provider that works with zero configuration.
  pageTranslatorProvider: 'google',
  googleCloudTranslateApiKey: '',
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
  translatePreTags: true,
  groupParagraphs: true,
  selectionPopupSkipInvalidText: true,
  selectionPopupSkipTargetLanguageText: false,
};
