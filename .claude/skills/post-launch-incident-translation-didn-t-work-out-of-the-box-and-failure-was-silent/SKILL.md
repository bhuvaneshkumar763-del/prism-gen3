---
name: post-launch-incident-translation-didn-t-work-out-of-the-box-and-failure-was-silent
description: A real user installed the `0.2.2-beta.0` build and reported, in direct
---

# Post-launch incident: translation didn't work out of the box, and failure was silent

A real user installed the `0.2.2-beta.0` build and reported, in direct
terms: translation didn't work with any source, and the popup/bubble/
settings all looked broken as a result. This was **not** a scope
complaint — it was two real, confirmed bugs, found and fixed the same
session.

**Bug 1 — the shipped default provider never worked.**
`src/shared/config/schema.ts`'s `defaultConfig.pageTranslatorProvider` was
`'libretranslate'`, pointed at the public `libretranslate.com`. Confirmed
live (`curl -X POST https://libretranslate.com/translate ...`): it returns
HTTP 429 `{"error":"Slowdown: 10 per 1 minute"}` for an unauthenticated
request — it needs a paid API key to actually translate anything. Every
fresh install was defaulting to a provider that was never going to work,
full stop. `'google'` (the free, no-signup, no-API-key provider — see
`docs/decisions/0004-provider-scope.md`, which explicitly calls it out as
"the free fallback that just works") was built correctly back in Session 4
but was never actually wired up as the default. Fixed by changing the one
line; re-verified with a real Playwright run against the built extension,
zero configuration, hitting the live `translate-pa.googleapis.com`
endpoint: "Hello world, this is a test." → "Hola mundo, esto es una
prueba."

**Bug 2 — total translation failure was completely silent.** This is the
part that made the popup and bubble look broken even after Bug 1 is fixed
for any *other* misconfigured/rate-limited provider a user might pick:
`createBatchedHttpProvider`'s `translateBatch()` (`src/engine/providers/
batchedHttpProvider.ts`) deliberately never throws for an HTTP-level
failure — `handleBatch()` catches it internally and resolves every piece
with `ok: false` instead, so one bad request can't crash an entire batch.
That's reasonable in isolation, but `translateLoop.ts`'s
`translationRoutine()` had no handling at all for "every single piece in
this batch came back `ok: false`" — each node just fell through to
`noteMissingResult()`'s isolated single-node retry-then-give-up-after-3
logic, with **zero page-level signal** that anything was wrong.
`pageLanguageState` stayed `'translated'` throughout (it flips on
`translatePage()` call, not on confirmed success), so the popup and
floating bubble both reported "Translated" / showed the restore button —
a **false success** — while the page never visibly changed. A separately
thrown exception (network blip, messaging round trip breaking) *was*
already caught and logged to the console, but that's not something a user
looking at the popup or bubble would ever see, and it's the rarer failure
mode besides.

Fixed in `src/engine/pageTranslator/translateLoop.ts`: a new
`consecutiveBatchFailures` counter increments both when `translateBatch()`
throws AND when every outcome in a batch resolves `ok: false` (the
actually-common case for a real broken provider) — after 3 consecutive
full-batch failures, a real error message is surfaced via new
`getLastError()`/`onError()` API on the page translator, and the retry
cadence backs off from 150ms to 8s so a confirmed-broken provider isn't
hammered forever. **Requeues the whole failed batch directly** rather than
routing through `noteMissingResult()`'s per-node cooldown — without this,
a node that hits that cooldown drops out of the queue entirely (dedupe.ts
intentionally skips already-tracked nodes on resweep), and the
failure-counter would stall forever below the surfacing threshold; found
by a real Playwright run against a broken provider that kept showing
"Translated" indefinitely, not by reasoning about the code. `content.ts`
wires `pageTranslator.onError()` into the floating bubble
(`components/bubble/`), which now renders a distinct "Translation failed"
state — never the normal "Translated" success — whenever an error is
active, checked before the translated/prompt rows in `FloatingBubble.tsx`.
The popup does not yet show this (it's a single request/response
round-trip UI, not a live-subscribed one like the bubble); the bubble is
the persistent, always-visible surface and was prioritized for this fix.

**Verified for real, twice**, against the actual built extension:
1. Zero-config fresh profile, real live network to Google's endpoint —
   text visibly translates.
2. A guaranteed-broken local mock provider (always returns HTTP 429) —
   the bubble shows "Translation failed", the page text is confirmed
   unchanged (no false success), and the request count confirms the
   retry/backoff logic is actually firing (26+ requests over the
   verification window, not a single silent no-op).

17 new/rewritten unit tests in `translateLoop.test.ts` cover both failure
paths (thrown exception, `ok:false` outcomes, non-`Error` thrown values,
malformed/empty outcome arrays, a node disconnected mid-flight, and
double-`restorePage()`), plus the pre-existing partial-failure retry test
was corrected — it previously asserted "every piece fails" while actually
exercising `noteMissingResult()`, which is no longer the code path a
total batch failure takes.

**Still open, not addressed this session**: the popup itself has no live
error surface — closing and reopening it after a translate click that
later fails silently shows nothing wrong. Given the popup already reads
`getPageState()` on mount and the bubble's fix proves the `onError()` API
works, wiring the popup up the same way (or via a new message type) is a
reasonable near-term follow-up, not filed as its own numbered plan item.
