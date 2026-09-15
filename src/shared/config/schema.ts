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
 *
 * Round-5 bloat audit: this used to be `z.object({...})` (the `zod` schema
 * library), with `Config` derived from it via `z.infer`. Measured directly:
 * zod was 51% of the shipped extension's bytes, tripled across the content
 * script, background, and options bundles — see `validate.ts`'s header
 * comment for the full measurement and reasoning. `Config` is now a
 * hand-written interface; `validate.ts`'s `configValidators` is a mapped
 * type over it, which is what keeps the two in sync — adding a field here
 * without adding its validator there is a compile error, the same static
 * coupling `z.infer` gave for free.
 */
export interface Config {
  targetLanguage: string;
  /** ISO 639-1 code, or 'auto' to let the provider detect it. */
  sourceLanguage: string;
  pageTranslatorProvider: 'google' | 'googleCloudTranslate' | 'llm';
  googleCloudTranslateApiKey: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
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
   * Whether `<pre>` blocks get translated. Default **on** — matches TWP's
   * real default exactly (`translateTag_pre: "yes"` in their actual
   * `defaultConfig`, re-verified directly against their source after
   * shipping this backwards the first time — see this field's own
   * changeset history for the correction). Real bug this setting exists to
   * let a user recover from: some sites use `<pre>` purely to preserve
   * line breaks in plain prose (a forum post, e.g.), not for code, and the
   * previous hardcoded "always skip `<pre>`" (added to protect genuine
   * code samples from being reworded) silently excluded the bulk of those
   * pages' content with no way to turn it back on. `<code>` stays
   * protected regardless of this setting — real code samples almost
   * always use it, nested inside `<pre>` or standalone.
   */
  translatePreTags: boolean;
  /**
   * Hide the selection-translate trigger for a selection with nothing
   * translatable in it (a lone character, or only punctuation/digits/
   * whitespace). Default `true` — matches TWP's real default exactly
   * (`dontShowIfIsNotValidText: "yes"`, the only one of their equivalent
   * settings that defaults on — verified directly, not assumed, the same
   * way the `translatePreTags` default mistake was caught).
   */
  selectionPopupSkipInvalidText: boolean;
  /**
   * Hide the selection-translate trigger when the selected text is
   * already confidently detected as the target language — the selection-
   * popup equivalent of the source-language-override fix earlier this
   * session (same underlying risk: offering to "translate" text that's
   * already correct). Default `false` — matches TWP's real default
   * exactly (`dontShowIfSelectedTextIsTargetLang: "no"`); this is a real
   * feature TWP offers, not a hidden default-behavior bug like the last
   * two fixes — confirmed their own default doesn't filter here either,
   * so this is opt-in, not a silent behavior change.
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
  translatePreTags: true,
  selectionPopupSkipInvalidText: true,
  selectionPopupSkipTargetLanguageText: false,
};
