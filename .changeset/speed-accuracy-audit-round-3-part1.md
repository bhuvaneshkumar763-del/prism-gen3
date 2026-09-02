---
"prism-gen3": minor
---

A third, deeper speed audit round (perceived speed and the cache/network path — the accuracy half of this round ships separately), covering the whole engine via 12 parallel discovery angles plus a live TWP source comparison:

- **Speed — a whole tick's translated text was withheld from the page until the SLOWEST sub-request finished.** `translateBatch()` used to resolve only once every underlying HTTP sub-request in a tick (up to ~50 for a large page) had completed — so if one sub-request stalled, the other 29+ already-translated pieces sat in memory instead of appearing on screen. The `Translator` interface now supports an optional `onPieceComplete` callback that fires the instant each individual piece's own result is known, and the page-translation engine writes each piece to the DOM right then instead of waiting for the whole tick.

- **Speed — a fully-cached page revisit paid for an IndexedDB write on every cache hit.** The translation cache's batched read (`getMany`) used to run inside a `readwrite` transaction purely so it could also bump each hit's recency timestamp in the same transaction — meaning a page you'd already translated before issued one IndexedDB write per text node just to read from cache. Reads now run in their own `readonly` transaction; the recency touch happens in a separate transaction that isn't awaited.

- **Speed — every translated batch's reply waited on a cache write to fully commit.** The background handler awaited the cache write (including, on a cold service worker, a full-store cursor scan) before replying with the translated text — delaying every batch's DOM write-back for a write whose own doc comment already says is "purely an optimization." The write is now fire-and-forget.

- **Reliability — a repair retry for a missing/suspicious piece could double a request's worst-case time.** The 30-second overall deadline that bounds a translate request's whole retry sequence was being recomputed from scratch for the individual-piece repair retry that runs when a batch response comes back short — so one `handleBatch()` call could genuinely run for up to ~60 seconds, double what the constant's own doc comment says it enforces. The repair retry now inherits the parent's deadline instead of starting a fresh one.

- **Reliability — the repair retry bypassed the request concurrency limiter entirely.** A batch-wide failure (Google's documented silent-echo mode, or a truncated response) used to fan out into one HTTP request per missing piece via a bare `Promise.all`, invisible to the `maxConcurrent` cap that the top-level batch dispatch respects — turning one counted "slot" into dozens of simultaneous, uncounted requests precisely when the endpoint is already struggling. Both paths now share one concurrency-limited dispatcher.

Verified end-to-end against real live Wikipedia through the built extension: first translated text now appears well before the page finishes, with zero change in translation accuracy (spot-checked against an unpatched build of the same page — identical output).
