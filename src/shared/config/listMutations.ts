/**
 * Cross-list cleanup for the always/never-translate site and language
 * lists — the single home for a rule the pre-rewrite fork applied
 * inconsistently: its popup removed a site from "never" when adding it to
 * "always" (and vice versa), but its options page's list editors did the
 * same add/remove with no cross-list cleanup at all, so a site could end up
 * listed in both simultaneously depending on which surface you used last.
 *
 * Pure snapshot-in, patch-out — no storage I/O. `src/platform/configMutations.ts`
 * is the only thing that applies a returned patch to the real config store;
 * every UI surface (bubble, popup, options) calls through that, never a raw
 * `configStore.set(...)` on these four keys.
 */

export interface ListsSnapshot {
  alwaysTranslateSites: string[];
  neverTranslateSites: string[];
  alwaysTranslateLangs: string[];
  neverTranslateLangs: string[];
}

export type ListsPatch = Partial<ListsSnapshot>;

function withAdded(list: string[], value: string): string[] {
  return list.includes(value) ? list : [...list, value];
}

function withRemoved(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : list;
}

/**
 * Every site-list check elsewhere in this codebase (`autoTranslateDecision.ts`,
 * `siteOverrides.ts`) matches against `location.hostname` — always lowercase,
 * no scheme, no path, per the URL spec. A rule added here from raw user
 * input (typed `BBC.com`, or a pasted `https://bbc.com/`) that ISN'T
 * normalized the same way silently never matches anything, while the
 * options page keeps displaying it as if it were an active rule. Accepts
 * either a bare hostname or a full URL — prefixing an assumed scheme when
 * one is missing lets `URL` do the actual stripping either way.
 */
export function normalizeHostname(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
    const hostname = new URL(withScheme).hostname;
    return hostname ? hostname.toLowerCase() : trimmed.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

export function addSiteToAlwaysTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  const normalized = normalizeHostname(hostname);
  return {
    alwaysTranslateSites: withAdded(snapshot.alwaysTranslateSites, normalized),
    neverTranslateSites: withRemoved(snapshot.neverTranslateSites, normalized),
  };
}

export function addSiteToNeverTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  const normalized = normalizeHostname(hostname);
  return {
    neverTranslateSites: withAdded(snapshot.neverTranslateSites, normalized),
    alwaysTranslateSites: withRemoved(snapshot.alwaysTranslateSites, normalized),
  };
}

export function removeSiteFromAlwaysTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  return { alwaysTranslateSites: withRemoved(snapshot.alwaysTranslateSites, normalizeHostname(hostname)) };
}

export function removeSiteFromNeverTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  return { neverTranslateSites: withRemoved(snapshot.neverTranslateSites, normalizeHostname(hostname)) };
}

export function addLangToAlwaysTranslate(snapshot: ListsSnapshot, lang: string, hostname?: string): ListsPatch {
  const patch: ListsPatch = {
    alwaysTranslateLangs: withAdded(snapshot.alwaysTranslateLangs, lang),
    neverTranslateLangs: withRemoved(snapshot.neverTranslateLangs, lang),
  };
  if (hostname) patch.neverTranslateSites = withRemoved(snapshot.neverTranslateSites, hostname);
  return patch;
}

export function addLangToNeverTranslate(snapshot: ListsSnapshot, lang: string, hostname?: string): ListsPatch {
  const patch: ListsPatch = {
    neverTranslateLangs: withAdded(snapshot.neverTranslateLangs, lang),
    alwaysTranslateLangs: withRemoved(snapshot.alwaysTranslateLangs, lang),
  };
  if (hostname) patch.alwaysTranslateSites = withRemoved(snapshot.alwaysTranslateSites, hostname);
  return patch;
}

export function removeLangFromAlwaysTranslate(snapshot: ListsSnapshot, lang: string): ListsPatch {
  return { alwaysTranslateLangs: withRemoved(snapshot.alwaysTranslateLangs, lang) };
}

export function removeLangFromNeverTranslate(snapshot: ListsSnapshot, lang: string): ListsPatch {
  return { neverTranslateLangs: withRemoved(snapshot.neverTranslateLangs, lang) };
}

/** Prepends `code` to a recency-ordered list, de-duplicating and capping to `max` entries — the popup's quick-language pills. */
export function addRecentTargetLanguage(list: string[], code: string, max: number): string[] {
  return [code, ...list.filter((c) => c !== code)].slice(0, max);
}
