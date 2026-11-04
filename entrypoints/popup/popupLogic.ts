import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import {
  addLangToAlwaysTranslate,
  type ListsPatch,
  type ListsSnapshot,
  removeLangFromAlwaysTranslate,
} from '../../src/shared/config/listMutations';
import { baseLanguageTag } from '../../src/shared/languages';

export type PopupStatus = 'idle' | 'busy' | 'error';
export type PopupAction = 'translate' | 'restore';
export type PrimaryButtonMode = 'translate' | 'translating' | 'restore' | 'restoring';

/**
 * Which main button the popup shows. A busy translate keeps the Translate
 * button (the page reads 'translated' before the work is done); a busy
 * restore keeps Show original, so it can say "Restoring…".
 */
export function primaryButtonMode(
  pageState: PageLanguageState,
  status: PopupStatus,
  busyAction: PopupAction,
): PrimaryButtonMode {
  if (status === 'busy') return busyAction === 'restore' ? 'restoring' : 'translating';
  return pageState === 'translated' ? 'restore' : 'translate';
}

/** Matches the auto-translate decision, which never translates a page already in the target's base language. */
export function offersAlwaysTranslateFrom(originalLanguage: string, targetLanguage: string): boolean {
  return originalLanguage !== 'und' && baseLanguageTag(originalLanguage) !== baseLanguageTag(targetLanguage);
}

/** The "Always translate from X" toggle's list change, through the same helpers Settings uses. */
export function alwaysFromTogglePatch(
  snapshot: ListsSnapshot,
  lang: string,
  currentlyOn: boolean,
  hostname: string,
): ListsPatch {
  if (currentlyOn) return removeLangFromAlwaysTranslate(snapshot, lang);
  return addLangToAlwaysTranslate(snapshot, lang, hostname || undefined);
}
