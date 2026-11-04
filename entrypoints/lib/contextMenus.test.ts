import { describe, expect, it } from 'vitest';
import {
  ensureContextMenus,
  type MenusApi,
  RESTORE_MENU_ID,
  TRANSLATE_MENU_ID,
  TRANSLATE_SELECTION_MENU_ID,
} from './contextMenus';

/** Like the browser: a duplicate id is refused (reported through lastError), not added twice. */
function fakeMenus() {
  const items = new Map<string, string>();
  const refusedDuplicates: string[] = [];
  const api: MenusApi = {
    create(props, callback) {
      if (items.has(props.id)) refusedDuplicates.push(props.id);
      else items.set(props.id, props.title);
      callback?.();
    },
    async removeAll() {
      items.clear();
    },
  };
  return { api, items, refusedDuplicates };
}

describe('ensureContextMenus', () => {
  it('creates all three items in a browser that has none (a fresh start after a Firefox restart)', async () => {
    const menus = fakeMenus();
    await ensureContextMenus(menus.api);
    expect([...menus.items.keys()].sort()).toEqual(
      [RESTORE_MENU_ID, TRANSLATE_MENU_ID, TRANSLATE_SELECTION_MENU_ID].sort(),
    );
  });

  it('can run on every background start: a second run leaves one of each item and no refused duplicates', async () => {
    const menus = fakeMenus();
    await ensureContextMenus(menus.api);
    await ensureContextMenus(menus.api);
    expect(menus.items.size).toBe(3);
    expect(menus.refusedDuplicates).toEqual([]);
  });
});
