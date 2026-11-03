import type { ListsPatch, ListsSnapshot } from '../shared/config/listMutations';
import type { ConfigStore } from './configStore';

/**
 * The one place a `listMutations.ts` patch is applied to the config store.
 * UI surfaces never `store.set()` the site/language lists directly, so the
 * cross-list cleanup in `listMutations.ts` applies everywhere.
 */
export function readListsSnapshot(store: ConfigStore): ListsSnapshot {
  return {
    alwaysTranslateSites: store.get('alwaysTranslateSites'),
    neverTranslateSites: store.get('neverTranslateSites'),
    alwaysTranslateLangs: store.get('alwaysTranslateLangs'),
    neverTranslateLangs: store.get('neverTranslateLangs'),
  };
}

export async function applyListPatch(store: ConfigStore, patch: ListsPatch): Promise<void> {
  // One combined write: a patch can touch both the always- and never-list,
  // and separate writes could fail halfway and leave a site on both.
  const entries = Object.fromEntries(
    (Object.keys(patch) as Array<keyof ListsPatch>)
      .filter((key) => patch[key] !== undefined)
      .map((key) => [key, patch[key]]),
  );
  await store.setMany(entries);
}
