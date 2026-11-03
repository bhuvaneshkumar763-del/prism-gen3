/**
 * Cross-list cleanup for the always/never-translate site and language lists:
 * adding to one list removes from the other, so an entry is never in both.
 * Pure snapshot-in, patch-out; `src/platform/configMutations.ts` applies the
 * patch, and every UI surface goes through it.
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

/** Adds `hostname` unless the list already holds the same site, so `www.x.com` never duplicates `x.com`. */
function withAddedSite(list: string[], hostname: string): string[] {
  return siteListIncludesHostname(list, hostname) ? list : [...list, normalizeHostname(hostname)];
}

/** Removes every entry for the same site, whichever of the `www.` or apex forms it was saved under. */
function withRemovedSite(list: string[], hostname: string): string[] {
  const target = apexForm(hostname);
  if (!target) return list;
  return list.filter((entry) => apexForm(entry) !== target);
}

/**
 * Normalizes a bare hostname or full URL to `location.hostname` form
 * (lowercase, no scheme/path), which every site-list check matches against.
 * An unnormalized rule (`BBC.com`, `https://bbc.com/`) would never match.
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

/**
 * Treats `www.example.com` and `example.com` as the same site, which is what
 * a user who typed either one into the site lists means.
 *
 * Stops short of full subdomain matching on purpose: a never-translate rule
 * for `example.com` should not silently cover `docs.example.com`, which the
 * user never named. Only the `www.` label is collapsed.
 *
 * The `www.` strip is skipped when nothing but a bare label would remain, so
 * the real registrable hostname `www.com` keeps its own identity instead of
 * being matched by a nonsensical `com` rule.
 */
function apexForm(hostname: string): string {
  const normalized = normalizeHostname(hostname);
  if (!normalized.startsWith('www.')) return normalized;
  const withoutWww = normalized.slice(4);
  return withoutWww.includes('.') ? withoutWww : normalized;
}

/**
 * The single membership test for the always/never-translate site lists, so
 * the auto-translate decision and the bubble/popup toggles always agree.
 *
 * Entries are re-normalized rather than trusted: a list restored from a
 * backup or written by an older build can still hold `HTTPS://Example.COM/path`.
 */
export function siteListIncludesHostname(list: readonly string[], hostname: string): boolean {
  if (!hostname.trim()) return false;
  const target = apexForm(hostname);
  if (!target) return false;
  return list.some((entry) => entry.trim() !== '' && apexForm(entry) === target);
}

export function addSiteToAlwaysTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  return {
    alwaysTranslateSites: withAddedSite(snapshot.alwaysTranslateSites, hostname),
    neverTranslateSites: withRemovedSite(snapshot.neverTranslateSites, hostname),
  };
}

export function addSiteToNeverTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  return {
    neverTranslateSites: withAddedSite(snapshot.neverTranslateSites, hostname),
    alwaysTranslateSites: withRemovedSite(snapshot.alwaysTranslateSites, hostname),
  };
}

export function removeSiteFromAlwaysTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  return { alwaysTranslateSites: withRemovedSite(snapshot.alwaysTranslateSites, hostname) };
}

export function removeSiteFromNeverTranslate(snapshot: ListsSnapshot, hostname: string): ListsPatch {
  return { neverTranslateSites: withRemovedSite(snapshot.neverTranslateSites, hostname) };
}

export function addLangToAlwaysTranslate(snapshot: ListsSnapshot, lang: string, hostname?: string): ListsPatch {
  const patch: ListsPatch = {
    alwaysTranslateLangs: withAdded(snapshot.alwaysTranslateLangs, lang),
    neverTranslateLangs: withRemoved(snapshot.neverTranslateLangs, lang),
  };
  if (hostname) patch.neverTranslateSites = withRemovedSite(snapshot.neverTranslateSites, hostname);
  return patch;
}

export function addLangToNeverTranslate(snapshot: ListsSnapshot, lang: string, hostname?: string): ListsPatch {
  const patch: ListsPatch = {
    neverTranslateLangs: withAdded(snapshot.neverTranslateLangs, lang),
    alwaysTranslateLangs: withRemoved(snapshot.alwaysTranslateLangs, lang),
  };
  if (hostname) patch.alwaysTranslateSites = withRemovedSite(snapshot.alwaysTranslateSites, hostname);
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
