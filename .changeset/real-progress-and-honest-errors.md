---
"prism-gen3": minor
---

Fixed three related, real user-reported problems with the translate progress indicator:

1. **The bubble/popup turned green ("translated") the instant you clicked translate, before anything was actually translated, with no indication that work was in progress.** `translatePage()` reports its state synchronously before any real translate request has even been sent — busy/spinner feedback around it resolved in ~zero frames. `translateLoop.ts` now tracks real activity (queued or in-flight work) separately via `isWorking()`/`onWorkingChange()`, and the bubble and popup only show "done" once real work has actually finished, not when the state flag flips.
2. **A consistent multi-second delay, with parts of the page translating in visible waves.** The engine paced itself with a hardcoded 150ms pause between every batch of 100 nodes, regardless of how fast the provider actually responded — pure self-inflicted latency on top of real network time. Removed the artificial pause and raised the per-tick batch size; a real page now issues its translate requests as fast as the provider allows.
3. **The bubble showed a red "Translation failed" panel even when the page had translated successfully**, because 3 failures counted toward surfacing an error even when those 3 failures happened within a fraction of a second of each other (rapid retries of the same stuck batch, not independent evidence of a real outage). Pre-surfacing retries are now genuinely spaced out (real seconds apart, not milliseconds), giving a transient blip a real chance to clear before it's treated as a confirmed failure — a page that actually can't reach the provider still surfaces red, just without false positives from momentary lag. The message shown is also now in plain language instead of the raw internal provider string.

Verified against a real page end-to-end (not just unit tests): the bubble correctly shows "Translating…" throughout, and only flips to done once the page is genuinely fully translated — previously ~2s+ of self-inflicted pacing plus an instantly-green bubble, now settles in well under a second with accurate progress feedback the whole way.
