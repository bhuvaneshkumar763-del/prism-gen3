---
"prism-gen3": patch
---

Reliability fix: a stale or rejected Google free-endpoint auth key could silently degrade translation into a no-op for up to 20 minutes at a time, with no error ever surfacing. Found live during this project's own testing — a page suddenly reported "Page translated" with every paragraph left completely untranslated, on a page as trivial as `example.com`.

Two compounding gaps, both fixed:

1. A genuine HTTP 401/403 (a key Google outright rejects) used to be swallowed inside `batchedHttpProvider.ts`'s retry handling with no way for the provider that supplied the credential to react, so the rejected key kept being resent for the rest of its normal 20-minute cache window. A new `onNonRetryableStatus` hook fires the instant this happens; `google.ts` uses it to invalidate the cached key immediately instead of waiting out the cache.

2. The free endpoint's real failure mode for a bad/exhausted key is more likely a silent echo (a real 200 OK that just returns the input unchanged) than a clean 401 — which is exactly what `kind: 'suspicious'` already exists to represent for a *legitimately* untranslatable piece (a same-language endonym), so a genuinely broken provider was indistinguishable from healthy behavior. `batchedHttpProvider.ts` now tracks a rolling window of the last 30 piece-level classifications; once the suspicious ratio crosses 90% — implausible for real, legitimately-mixed content — further suspicious outcomes are reclassified as `kind: 'network'`, letting translateLoop.ts's existing failure-surfacing logic correctly treat it as a real failure. Crossing this threshold also fires a new `onSuspiciousStreak` hook, which `google.ts` uses to force an immediate key re-scrape, giving the very next tick a real chance to self-heal.
