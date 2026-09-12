---
"prism-gen3": patch
---

Reliability fix: translation could get stuck on the busy spinner forever on mobile, with no way to recover short of reloading the page (reported live on sangtacviet.vip, translating normally on desktop with the same page).

`remoteTranslator.ts`'s `translateBatch()` sends a `translatePieces` message to the background service worker and awaits its response with no timeout at all. The background's own worst-case processing time is already bounded (`batchedHttpProvider.ts`'s retry loop tops out around ~62s), but if the service worker is torn down mid-request before it can call `sendResponse` — Chrome's own idle eviction is already defeated by the existing keepalive alarm, but an OS-level low-memory kill on a constrained mobile device is not, and no extension API can prevent it — that response is gone for good and the content script's `await` had nothing left to resolve it. `working` never got set back to `false`, leaving the bubble stuck on "Translating…" indefinitely; only a full page reload (which tears down the content script and its stuck promise) could clear it, and a retry right after could land in the same state again.

Fixed by wrapping the call in the existing `withTimeout` helper (already used for the same class of risk elsewhere — `originalLanguageTracker.ts`, `popup/App.tsx`), sized generously above the background's own worst case. A timeout now rejects the call instead of hanging it, which `translateLoop.ts`'s existing failure-handling already treats like any other failed batch — retried, and, per the beta.42 fix, eventually surfaced as a real "Translation failed" instead of a silent, permanent stall.
