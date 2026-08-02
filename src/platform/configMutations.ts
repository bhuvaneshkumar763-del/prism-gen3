import type { ListsPatch, ListsSnapshot } from '../shared/config/listMutations';
import type { ConfigStore } from './configStore';

/**
 * The one place that applies a `src/shared/config/listMutations.ts` patch to
 * the real config store. Every UI surface (bubble panel, popup, options
 * page) reads a `ListsSnapshot` off `store`, passes it through a pure
 * mutator, and hands the resulting patch here — none of them call
 * `store.set('alwaysTranslateSites', ...)` directly. Keeping that rule to
 * one enforcement point is what makes the cross-list cleanup in
 * `listMutations.ts` actually apply everywhere, instead of the pre-rewrite
 * fork's fate where the popup applied it and the options page didn't.
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
  await Promise.all(
    (Object.keys(patch) as Array<keyof ListsPatch>).map((key) => {
      const value = patch[key];
      return value === undefined ? Promise.resolve() : store.set(key, value);
    }),
  );
}
