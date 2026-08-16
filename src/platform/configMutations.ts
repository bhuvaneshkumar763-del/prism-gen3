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
  // One combined write, not N independent store.set() calls — a patch can
  // legitimately touch both the always- and never-list at once (e.g. moving
  // a site from one to the other), and N separate writes meant a failure
  // partway through could land only some of them, leaving a site on both
  // lists simultaneously — the exact state listMutations.ts's cross-list
  // cleanup exists to prevent.
  const entries = Object.fromEntries(
    (Object.keys(patch) as Array<keyof ListsPatch>)
      .filter((key) => patch[key] !== undefined)
      .map((key) => [key, patch[key]]),
  );
  await store.setMany(entries);
}
