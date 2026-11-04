export const TRANSLATE_MENU_ID = 'prism-translate-page';
export const RESTORE_MENU_ID = 'prism-show-original';
/** Gives keyboard users (Shift+F10) and anyone who dismissed the floating button a way to translate a selection. */
export const TRANSLATE_SELECTION_MENU_ID = 'prism-translate-selection';

export interface MenusApi {
  create(props: { id: string; title: string; contexts: ['page'] | ['selection'] }, callback?: () => void): unknown;
  removeAll(): Promise<void>;
}

const ITEMS = [
  { id: TRANSLATE_MENU_ID, title: 'Translate this page', contexts: ['page'] as ['page'] },
  { id: RESTORE_MENU_ID, title: 'Show original text', contexts: ['page'] as ['page'] },
  // %s is replaced by the browser with the selected text.
  { id: TRANSLATE_SELECTION_MENU_ID, title: 'Translate “%s”', contexts: ['selection'] as ['selection'] },
];

/**
 * Run on every background start: Firefox and Orion drop menus on a browser
 * restart or re-enable without firing `onInstalled`. Clearing first makes a
 * repeat run (each Chrome worker wake) replace the items instead of erroring.
 */
export async function ensureContextMenus(menus: MenusApi): Promise<void> {
  await menus.removeAll();
  for (const item of ITEMS) {
    menus.create(item, () => {
      // Read so the browser doesn't log an unchecked error for a racing duplicate.
      void browser.runtime.lastError;
    });
  }
}
