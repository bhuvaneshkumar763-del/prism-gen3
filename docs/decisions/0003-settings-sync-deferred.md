# 0003 — Settings sync: deferred, not rejected

## Status
Accepted — 2026-08-01 (Session 3)

## Context
The old repo shipped `chrome.storage.sync` for cross-device settings sync,
then fully removed it after a real, hard-to-diagnose bug: feature-detecting
`!!browser.storage.sync` proves the API *exists*, not that it *works* — on
WebKit-based browsers (reported on Orion for iOS) it silently split-brained.
The options page (an extension page) could read/write `sync:` fine; the
content-script execution context reading the *same key* got nothing back,
with no error surfacing anywhere. Symptom: a setting visibly saved in the
UI, but the feature it controlled behaved as if it had never been set. See
the old repo's `CLAUDE.md`, "storage.sync removed," for the full incident
account — it's worth reading before touching this decision again.

Gen 3's storage layer (`src/platform/storage/`) is built behind a
`StorageBackend` port specifically so this class of decision doesn't
require rearchitecting the config store — but that doesn't mean sync should
just be quietly reattempted once the port exists.

## Decision
**No sync backend ships in Gen 3's initial architecture.** Only
`localStorageBackend` (`browser.storage.local`) exists. This is a deferral,
not a permanent rejection — cross-device sync is a real, reasonable feature
to want eventually.

**The precondition for reconsidering it**: a `syncBackend.ts` implementing
the same `StorageBackend` interface must pass the cross-context consistency
test in `configStore.test.ts` (`describe('cross-context consistency')`) —
which asserts that a write made through one `configStore` instance
(simulating, e.g., the options page) is visible to a *second, independent*
`configStore` instance (simulating, e.g., a content script) within the
test's timeout, in the exact same execution environment class of bug that
broke on WebKit. If a sync backend can't make that test pass reliably on
every target browser, it doesn't ship, full stop — this is a testable gate,
not a vibe check.

## Consequences
- `configStore.ts` never imports `browser.storage` directly — only
  `StorageBackend`, injected. `getConfigStore()`'s default wiring picks
  `localStorageBackend`, but that's a composition-root choice, not
  something baked into the store's own logic.
- No settings ever silently fail to sync, because nothing claims to sync
  yet. Export/import (`configStore.ts`'s `export`/`import`) is the
  supported way to move settings between devices for now, matching what
  the old repo settled on after removing sync.
- If/when a sync backend is attempted, it inherits this ADR's precondition
  test as a merge gate, not just a suggestion.
