---
"prism-gen3": patch
---

Reliability fix (round-4 audit, item 9): removing a per-site bubble-visibility or source-language override in Settings didn't actually delete it — the row would keep reappearing, and the next unrelated save could write the "removed" override straight back into storage.

Solid's `setStore(key, objectValue)` merges a plain object into whatever's already at that store path — it doesn't remove a key the new object no longer has. `bubbleByHost` and `sourceLanguageByHost` are both `Record<string, ...>`, so removing a host's override produces a smaller object, but the merge silently kept the deleted entry sitting in the options page's own in-memory mirror. The row never actually disappeared from that mirror, and the next save on either key re-spread the stale mirror and wrote the "removed" host back into persistent storage — the exact bug "Restore defaults" hit too, since resetting either key back to `{}` has the same shape.

Fixed with Solid's own `reconcile()` (a diff-based replace instead of a shallow merge), scoped to just these two keys — verified directly, with a standalone script against the real `solid-js` store, that `reconcile()` on an *array*-valued store path does NOT shrink it correctly (a 3-item array reconciled down to 2 left a trailing `null` instead of removing the slot), so applying it universally would have traded this bug for a different one on every array-shaped config key (`alwaysTranslateSites`, etc. — those already worked correctly without `reconcile`, confirmed the same way).

Added a real end-to-end regression test (`tests/e2e/run.mjs`): seeds a per-host override in storage, removes it via the actual UI, and confirms it stays removed in storage even after an unrelated field save — reverted-and-confirmed-failing against the old behavior before this fix.
