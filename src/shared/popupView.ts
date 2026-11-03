import { describeTranslateError } from '../engine/pageTranslator/errorState';
import type { ErrorKind } from '../engine/pageTranslator/translateLoop';
import {
  addSiteToAlwaysTranslate,
  addSiteToNeverTranslate,
  type ListsPatch,
  type ListsSnapshot,
  removeSiteFromAlwaysTranslate,
  removeSiteFromNeverTranslate,
  siteListIncludesHostname,
} from './config/listMutations';
import { languageName, translationDirection } from './languages';
import { TimeoutError } from './withTimeout';

/** What the toolbar popup shows, as pure functions so its wording and rules are testable without a browser. */

export const REACH_PAGE_MESSAGE = "Prism can't reach this page. Reload it and try again.";
export const SAVE_FAILED_MESSAGE = "Couldn't save that setting. Please try again.";
export const GENERIC_POPUP_ERROR = 'Something went wrong. Reload the page and try again.';

export function translateButtonLabel(targetLanguage: string): string {
  return `Translate to ${languageName(targetLanguage)}`;
}

/** The header pill. An unknown language reads "Original", never a "…" that looks like it is still loading. */
export function statusPillText(translated: boolean, originalLanguage: string, targetLanguage: string): string {
  if (translated) return translationDirection(originalLanguage, targetLanguage) ?? 'Translated';
  if (!originalLanguage || originalLanguage === 'und') return 'Original';
  return `Original · ${languageName(originalLanguage)}`;
}

/**
 * The quick-language row after a pick. Pills already shown keep their place
 * so the row never moves under a finger; a new language takes the last slot.
 * Recency order is saved separately and used the next time the popup opens.
 */
export function pillRowAfterPick(row: readonly string[], picked: string, max: number): string[] {
  if (row.includes(picked)) return [...row];
  if (row.length < max) return [...row, picked];
  return [...row.slice(0, max - 1), picked];
}

/** `default` is "on neither list": the page is translated only when asked, or by a language rule. */
export type SiteRule = 'always' | 'default' | 'never';

/** Never wins, matching auto-translate, so a site on both lists shows the rule that actually applies. */
export function siteRuleFor(
  lists: Pick<ListsSnapshot, 'alwaysTranslateSites' | 'neverTranslateSites'>,
  hostname: string,
): SiteRule {
  if (siteListIncludesHostname(lists.neverTranslateSites, hostname)) return 'never';
  if (siteListIncludesHostname(lists.alwaysTranslateSites, hostname)) return 'always';
  return 'default';
}

export function siteRulePatch(snapshot: ListsSnapshot, hostname: string, rule: SiteRule): ListsPatch {
  if (rule === 'always') return addSiteToAlwaysTranslate(snapshot, hostname);
  if (rule === 'never') return addSiteToNeverTranslate(snapshot, hostname);
  return {
    ...removeSiteFromAlwaysTranslate(snapshot, hostname),
    ...removeSiteFromNeverTranslate(snapshot, hostname),
  };
}

/** The browser's and the messaging library's wording for "the page never answered". */
const UNREACHABLE_PAGE =
  /timed out after \d+ ?ms|^No response$|Could not establish connection|Receiving end does not exist|message port closed|^No active tab$|Extension context invalidated/i;
const NOT_CONFIGURED = /^\[[\w-]+\] not configured/;

/** Plain words for internal text, or null when `message` is already meant for people. */
function plainWordsFor(message: string): string | null {
  if (UNREACHABLE_PAGE.test(message)) return REACH_PAGE_MESSAGE;
  if (NOT_CONFIGURED.test(message)) return describeTranslateError({ kind: 'notConfigured', message });
  return null;
}

/** For a thrown error: a failed message to the page, or anything else the popup caught. */
export function describePopupError(error: unknown): string {
  if (error instanceof TimeoutError) return REACH_PAGE_MESSAGE;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return plainWordsFor(message) ?? GENERIC_POPUP_ERROR;
}

/** The page's own error is already written for people; only internal text is rewritten. */
export function pageErrorText(error: { message: string; kind: ErrorKind }): string {
  return plainWordsFor(error.message) ?? error.message;
}
