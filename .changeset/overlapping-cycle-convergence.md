---
"prism-gen3": patch
---

Fixed a real bug found via a live user report: rapidly skipping between chapters worked two or three times, then the next one would spin forever — recovering only on a page reload, or on skipping to the page after it. That recovery signature (any *subsequent* cycle clears it) pointed at how the tick loop handles overlapping translate cycles, which is exactly what rapid navigation produces: a new `translatePage()` starts while the previous chapter's batch is still in flight.

Two defects in that path, both in `translateLoop.ts`:

**1. A stale cycle cleared the in-flight flag for a newer, live one.** `batchInFlight = false` lives in the tick's `finally`, and a `return` inside `try` still runs `finally` — so when an OLD cycle's batch resolved and correctly bailed out on the `requestedUnderGeneration !== cycleGeneration` check, it still wiped the flag a NEWER, still-running tick had just set, making `isWorking()` report idle while a batch was genuinely outstanding. The flag is now generation-keyed (`inFlightGeneration`), so only the cycle that set it can clear it — the same `if (x === mine)` discipline `translationRoutine`'s own `finally` already used for `runningForGeneration`. Covered by a regression test that reverts-and-confirms-fails.

**2. A dropped wake could leave the loop with no scheduled successor.** The re-entrancy guard (`if (runningForGeneration === cycleGeneration) return;`) discards a wake entirely, which was only safe under the assumption that the already-running tick reschedules at its tail — but the generation-mismatch bail-outs return *before* reaching that tail. Combined, those could strand a non-empty `queue` with no tick pending and nothing to restart it: `working` stuck true until some external event (a reload, or the next page's own `translatePage()`) kicked it. `runTranslationTick` now reports whether it scheduled its own successor, and `translationRoutine`'s `finally` schedules one whenever it didn't and real work remains — making "a tick always schedules its successor" structural rather than something every future early-return path has to remember.

Also adds a convergence test that drives several rapid chapter switches with batches resolving out of order and asserts the invariant that has to hold once everything settles: queue drained, spinner off.
