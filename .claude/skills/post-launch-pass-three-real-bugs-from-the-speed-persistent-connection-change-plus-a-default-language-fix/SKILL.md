---
name: post-launch-pass-three-real-bugs-from-the-speed-persistent-connection-change-plus-a-default-language-fix
description: Filed by the user shortly after the pass above shipped — the persistent
---

# Post-launch pass: three real bugs from the speed/persistent-connection change, plus a default-language fix

Filed by the user shortly after the pass above shipped — the persistent
IndexedDB connection (this pass's own biggest speed win) had a real
regression the desktop-only verification above never exercised, plus two
unrelated small bugs surfaced in the same report.

**1. `src/platform/cache/translationCache.ts` — "Attempt to get a record
from database without an in-progress transaction."** The speed pass
traded "open and close a fresh connection every call" for "keep one
connection open for the life of the module" — correct for the intended
optimization, but it introduced a failure mode the old design structurally
couldn't hit: the browser can close an IndexedDB connection at any time
(memory pressure, low storage), and mobile browsers reclaim these far more
aggressively than desktop Chrome, which is exactly where this pass's own
verification ran and never saw it. Once closed, every subsequent call kept
trying to open a transaction on the dead connection, failing for the rest
of that context's lifetime. Fixed two ways: `db.addEventListener('close',
...)` resets the cached connection promise so the *next* call transparently
reopens, and a new `withDb()` wrapper retries any operation once with a
fresh connection, covering the race where the connection dies between
`getDb()` resolving and the transaction actually being created (which
`onclose` alone doesn't cover, since it fires asynchronously). Separately
hardened `entrypoints/background.ts`'s `translatePieces` handler, which had
an independent bug: a cache **write** failure was awaited *before*
`return outcomes`, so any cache-layer error — even a transient one — broke
an otherwise-successful translation instead of just losing the caching
optimization. Both the cache read and write paths now catch and log rather
than propagate. **Verified for real**: force-closed the background's live
IndexedDB connection via a direct `db.close()` call against the built
extension, then confirmed a `translatePieces` round trip (sent from the
options page, not the background messaging itself — self-messaging a
service worker from its own context doesn't reliably loop back in Chrome,
already documented elsewhere in this file) still completes successfully.
Also added real unit tests for the retry/reopen paths themselves (a
same-instance `db.close()` dispatch isn't triggerable through
fake-indexeddb, so the close-listener is captured via `addEventListener`
and invoked directly — still exercises the exact same callback body a real
browser-initiated close would run).

**2. `components/bubble/bubbleStyles.ts` — misdiagnosed, reverted.** The
user's actual report was a different, unrelated element appearing on
Android ("a table of translation options on top, in addition to the
bubble") — not the bubble's own hover panel. This was guessed at without
confirming against the real symptom: `.wrap:hover .panel` was gated behind
`@media (hover: hover)` on the theory that mobile browsers stick `:hover`
after a tap, verified only in the narrow sense that the CSS did what it
was written to do, never against what the user actually saw. The user
corrected this directly — "that's not the problem, revert that" — and the
change was reverted in full, byte-for-byte back to what it was before.
**The real cause of the "table on top" report is still open** — don't
re-attempt this same fix; whatever's actually showing up needs to be
identified from the user's own description or a screenshot before
touching this file again.

**3. `src/shared/config/schema.ts` — default target language was Spanish,
not English.** `defaultConfig.targetLanguage` had been `'es'` since early
in Gen 3's development with no comment explaining why — almost certainly
an arbitrary placeholder that was never revisited, unlike every other
default in this file (which all have a real reason documented inline).
Changed to `'en'`, along with `entrypoints/popup/App.tsx`'s own separate
hardcoded `'es'` fallback signal (used only before `configStore.onReady()`
resolves) — a second, independent place the same wrong default was
hardcoded, found while fixing the first.

Full verification chain (`compile`, `lint` — 0 errors, `test:coverage`
with the new retry/reopen logic itself fully covered — the whole point of
this fix, not just the aggregate number, both CI guards, `build` ×2
browsers, `guard:bundle-size`, `test:e2e`, `npm audit`) clean throughout.
