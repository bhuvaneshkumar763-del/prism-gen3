import type { PageLanguageState } from '../../src/engine/pageTranslator/translateLoop';
import {
  addLangToAlwaysTranslate,
  type ListsPatch,
  type ListsSnapshot,
  removeLangFromAlwaysTranslate,
} from '../../src/shared/config/listMutations';
import { sameLanguage } from '../../src/shared/languages';

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

/** Hidden when the page is already in the target language, where auto-translate never fires. */
export function offersAlwaysTranslateFrom(originalLanguage: string, targetLanguage: string): boolean {
  return originalLanguage !== 'und' && !sameLanguage(originalLanguage, targetLanguage);
}

/** Whether the always list covers the page's language, by the rule the list helpers and auto-translate share. */
export function alwaysTranslatesFrom(alwaysTranslateLangs: readonly string[], originalLanguage: string): boolean {
  return alwaysTranslateLangs.some((l) => sameLanguage(l, originalLanguage));
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
