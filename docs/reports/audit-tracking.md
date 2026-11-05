# Audit tracking: every finding, checked against the current code

_2026-11-03 · checked at commit `2c8fdc9` (0.3.2-beta.4, after Release 6) · updated 2026-11-04 with Release 7's outcome (0.3.2-beta.5)_

This is the Release 7 work list. It lists every finding from both audits and
from the fix plan's lists, removes duplicates, and gives each one a status.
Each status comes from reading the current code, not the audit's line numbers.
Line numbers below are for `2c8fdc9`.

**Totals (193 rows), after Release 7:** Closed 172 · Closed (partly) 6 · Won't fix 7 · Not a bug 1 · Obsolete 7 · Open 0

Before Release 7, 82 rows were Open: 8 Med (one is PL-9, found while
checking), 3 Low-Med, 67 Low (including 4 performance rows and 1 test row),
and 4 Design or Process points.

| Status | Meaning |
|---|---|
| Closed | Fixed. The commit is given; `R7` means Release 7 (0.3.2-beta.5). |
| Closed (partly) | The part that can bite is fixed; the row says what was left. |
| Won't fix | Kept on purpose; the row gives the reason. |
| Open | Still in the code. The file:line and the failure are given. |
| Not a bug | On reading, the failure can't happen. |
| Obsolete | The code it was about no longer exists. |

**Source codes**

| Code | File |
|---|---|
| S-PT, S-PR, S-UI, S-PL | `senior-audit-2026-11-03/` slices: pageTranslator, providers, entrypoints-components, platform-ci (0.3.1) |
| B-PT, B-PR, B-EN, B-CO, B-PL | `self-audit-findings/` slices: pageTranslator, providers, entrypoints, components, platform-shared (beta.70) |
| FP-C | `fix-plan.md` "Bugs to confirm, then fix when they bite" |
| FP-R2 … FP-R6 | Release 2 checklist in `fix-plan.md`; Releases 3–6 in `release-programme.md` |
| X | Found while checking. Not in any audit. |

Not tracked: "strengths", "praise" and "fixed since" bullets. A test-gap
bullet is tracked under the bug it would have caught. Test-quality bullets
that stand alone have their own rows (PT-40, PT-41, PR-32, PL-34).

Severity for Open rows is the audit's own (Med, Low-Med, Low). "Design" and
"Process" mean the audit raised it as a design or process point, not a bug.

---

## src/engine/pageTranslator

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PT-1 | Opening brackets doubled: `（本章完）` became `（(End of this chapter)` | S-PT, FP-R2 | Closed | 67580f1 | Opening brackets added to the not-carried set |
| PT-2 | Punctuation restore stripped `¿ « 「` and re-imposed the source's | B-PT, S-PT | Closed | c69c820 | Opening marks no longer carried (R1-1) |
| PT-3 | `PURE_TAGS_RE` backtracks exponentially (ReDoS) | B-PT, S-PT | Closed | c69c820 | `/` out of token class, 500-char cap |
| PT-4 | Word-per-element chapter cut every 300 nodes | S-PT, FP-R2 | Closed | 67580f1 | Whole block taken into one tick |
| PT-5 | `translatedChars` counted only a word run's head, so a false "N% untranslated" | S-PT, FP-R2 | Closed | 67580f1 | Every word in a run now counted |
| PT-6 | `wakeRoutine()` cancels the error backoff; a stray 0 ms timer clears it too | B-PT, S-PT, FP-C, FP-R5 | Closed | e44fd83 | One scheduler; backoff is a floor |
| PT-7 | `totalPieces` fixed per cycle, so the progress bar hides early | B-PT, S-PT, FP-R5 | Closed | e44fd83 | Late nodes counted into the total |
| PT-8 | Catch path requeues nodes `onPieceComplete` already wrote | S-PT | Closed | R7 | translateLoop.ts: the catch path requeues only nodes onPieceComplete hadn't written (per-batch written set) |
| PT-9 | Hover original for a word run is only its head word | S-PT | Closed | R7 | writeBack.ts: the ledger keeps a word run's whole sent text (recordRun), and hover returns it |
| PT-10 | Attribute restore keeps the first value ever seen | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Restore puts back the page's latest value |
| PT-11 | Attribute write-back has no staleness check | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Same `sentText` rule as text nodes |
| PT-12 | Rejected attribute batch stops the observer starting | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Rejection caught; observer still starts |
| PT-13 | Attribute change path uses the wrong skip check (textarea placeholder, `translate="no"`) | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Uses the page walk's ancestor rule |
| PT-14 | Title translator has no generation guard (late chapter-1 title) | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Generation counter drops late replies |
| PT-15 | Attributes inside shadow DOM are never collected | S-PT | Closed | R7 | collectTextNodes.ts collectAttributeTargets walks into shadow-root fragments |
| PT-16 | Attribute observer starts only after the first batch returns | S-PT | Closed | R7 | attributeTranslator.ts: start() starts the observer before the first request |
| PT-17 | Restore skips detached nodes; the two-tick prune drops long-detached ones | B-PT, S-PT | Closed | R7 | new restoreMap.ts (pruned entries are parked behind a WeakRef instead of being dropped, and are live again when reattached) |
| PT-18 | Retry counters survive across cycles | B-PT, S-PT | Closed | R7 | translateLoop.ts: requeueAt and missingResultAttempts reset in translatePage |
| PT-19 | `translate="no"` compared case-sensitively; nested `translate="yes"` ignored | B-PT, S-PT | Closed (partly) | R7 | Case-insensitive now, for text and attributes. Nested `translate="yes"` inside a no-translate area is left as is (rare; not seen on the owner's sites) |
| PT-20 | A sync throw after the queue splice drops the batch and spins | B-PT | Closed | R7 | translateLoop.ts: everything after the queue splice (hint lookup, grouping, writer, recomputeWorking) is inside the try, so a throw requeues the batch and backs |
| PT-21 | Tail always re-arms; timer handles overwritten without clearing | B-PT | Closed | e44fd83 | `schedule` always clears; idle 2 s poll is by design |
| PT-22 | `BLOCK_TAGS` misses NAV, HEADER, UL, OL, TABLE, custom elements | B-PT, S-PT | Closed (partly) | R7 | Lists, tables, nav, header, footer, main, aside, form and more are blocks now. Custom elements are left inline: their display varies by site |
| PT-23 | Three contradictory comments on the `<pre>` default | B-PT | Closed | 2e2fb57 | Comments now agree |
| PT-24 | Comment: `consecutiveBatchFailures` "reset on offline ticks" | B-PT | Obsolete | — | Variable replaced by errorState.ts (e44fd83) |
| PT-25 | "Offline error clears itself on the next tick" is false | B-PT | Closed | R7 | errorState.ts new backOnline |
| PT-26 | Stale cross-references and incident-narrative comments | B-PT, S-PT, FP-R3 | Closed | 2e2fb57 | Comments cut to short "why" notes |
| PT-27 | `getTranslatedNodes` has no caller | B-PT, FP-R5 | Closed | 95e72d1 | Removed |
| PT-28 | `suppressNextObserverTick` is effectively dead and can swallow a real title change | B-PT, FP-R5 | Closed | R7 | titleTranslator.ts: suppressNextObserverTick and noteOwnHeadWrite deleted |
| PT-29 | `HAS_LETTER` defined three times | B-PT, FP-R3 | Closed | 085aa3c | One copy in src/shared/text.ts |
| PT-30 | The two-tick prune helper is written twice | B-PT | Closed | R7 | one shared rule in new restoreMap.ts, used by writeBack.ts and attributeTranslator.ts |
| PT-31 | Perf: full `document.body` resweep every 1.5–10 s forever | B-PT | Won't fix | R7 | The full resweep is the only safety net for shadow-root changes and detach/reattach without a mutation record. Change only with a measurement from a real page |
| PT-32 | Perf: `findOriginalTextForElement` is O(N) per mousemove | B-PT | Closed | R7 | writeBack.ts findOriginalTextForElement reads only the target's own child nodes (O(children), no allocation) instead of scanning the whole ledger |
| PT-33 | Perf: any watched attribute change re-walks the element's subtree | B-PT | Closed | R7 | collectTextNodes.ts new attributeTargetsOf(el) |
| PT-34 | Perf: O(depth) ancestor walk per added node; duplicate subtree walks | B-PT | Closed (partly) | R7 | Duplicate walks removed; the O(depth) ancestor walk stays (it is the cheap way to know an added node's context) |
| PT-35 | `createPageTranslator` is one huge closure | S-PT, FP-R5 | Closed | e44fd83 | Split into scheduler, errors, progress, write-back |
| PT-36 | Error state spread over six variables | S-PT, FP-R5 | Closed | e44fd83 | One `ErrorState` value with pure transitions |
| PT-37 | Requeue and failure-surfacing blocks written twice | S-PT | Closed | e44fd83 | One function each |
| PT-38 | Attribute/title translators re-implement staleness and generation weakly | S-PT, FP-R3 | Closed | 085aa3c | Same rules as the main loop |
| PT-39 | Grouping stacks five isolation rules with magic thresholds; "is grouping worth it?" | S-PT | Won't fix | R7 | Design point; the fix plan defers it until saved pages show grouping hurting |
| PT-40 | Uppercase fake translator can't model Google | S-PT, FP-R5 | Closed | 0e9421b | Realistic Google fake from recordings |
| PT-41 | About 70 real-clock `waitFor` calls; timers untested | S-PT | Closed | R7 | translateLoop.test.ts: the two tests that asserted inside a fixed real-time window now use fake timers: "writes a fast piece to the DOM as soon as it individual |

## src/engine/providers (and src/engine/selection)

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PR-1 | Short Vietnamese echoes pass: length gate runs before the language check | S-PR, FP-R2, FP-R5 | Closed | 0e9421b | Data-checked short-echo rule |
| PR-2 | `repair()` drops `sourceLanguageIsExplicit`, so repairs go out as `'auto'` | S-PR, B-PR, FP-C | Closed | R7 | google.ts: repair() forwards sourceLanguageIsExplicit |
| PR-3 | Only non-retryable errors keep their cause; bad shapes read as "couldn't reach" | S-PR, FP-R5 | Closed | 95e72d1 | Structured error kinds; response shape checked |
| PR-4 | `needsRepair` skips padded pieces before the leaked-marker check | S-PR | Closed | R7 | google.ts: new finishPadded(): a one-string piece whose answer contains <a i=N>/</a> that the source didn't have fails as badResponse instead of being written ( |
| PR-5 | `onPieceComplete` forwards a padded piece's raw value without the overflow join | S-PR, B-PR | Closed | R7 | google.ts: onPieceComplete sends padded pieces through finishPadded too (same overflow join as the final result) |
| PR-6 | `throw lastError` can throw `undefined` | S-PR, B-PR, FP-C | Closed | 95e72d1 | Throws a timeout instead |
| PR-7 | Repairs inherit the parent deadline while queued in the gate | S-PR, B-PR | Closed | R7 | batchedHttpProvider.ts: a suspicious piece's retry that ends in 'timeout' (for example, the deadline ran out while it waited in the queue) is reported 'suspicio |
| PR-8 | Suspicious retry overrides an explicit source with `'auto'`; on `'auto'` it resends the same request | S-PR | Closed | R7 | batchedHttpProvider.ts: suspicious-retry source is worked out in translateBatch (provider fallback, otherwise an explicit pick or 'auto' is kept, otherwise 'aut |
| PR-9 | `invalidateAuth()` nulls the key while sibling batches are queued | S-PR, B-PR | Closed | R7 | batchedHttpProvider.ts: getExtraHeaders may return a Promise, read before the request timer starts |
| PR-10 | Key snapshot saved only at worker startup | S-PR, B-PR | Closed | R7 | google.ts: new onAuthKeyChange(listener), called after every scrape and with undefined on invalidation |
| PR-11 | `resolveFn` isn't idempotent; a throw mid-loop re-resolves pieces | S-PR | Closed | R7 | batchedHttpProvider.ts: resolveFn now acts only once (settled flag), so a throw partway through a batch can't count a piece twice in the suspicious window |
| PR-12 | A single hanzi can't be selected (`length >= 2`) | S-PR, B-PR, S-UI | Closed | 90c970d | One non-Latin letter allowed |
| PR-13 | `^<pre>…</pre>$` match isn't trimmed | S-PR, B-PR | Closed | R7 | google.ts: the <pre> match allows whitespace before and after (/^\s*<pre[^>]*>…<\/pre>\s*$/) |
| PR-14 | Repeated indices joined with an ASCII space | S-PR, B-PR | Closed | R7 | google.ts: joinReflowed() puts no space next to Han/Kana/Thai/Lao/Khmer/Myanmar text or next to existing whitespace |
| PR-15 | Batch budgets checked after the piece is added | S-PR, B-PR | Closed | R7 | batchedHttpProvider.ts: a batch is closed before a piece that would push it past 6000 wire chars |
| PR-16 | `Content-Type: application/application/json+protobuf` | S-PR, B-PR | Closed | R7 | google.ts: Content-Type is application/json+protobuf (the value Google's own web client sends |
| PR-17 | Raw `detectedLanguage` compare (`zh-CN` vs `zh`, `iw` vs `he`) | B-PR | Closed | c69c820 | Base-tag compare (R1-8) |
| PR-18 | Key-scrape regex `\w{39}` can't match `-` | B-PR, S-PR | Closed | c69c820 | `[\w-]{39}` (R1-9) |
| PR-19 | Google Cloud: no 128-segment cap; key in the URL | B-PR, S-PR | Closed | c69c820 | `maxBatchPieces` and header key (R1-11) |
| PR-20 | LLM `parseResponse` ignores the count; dropped separator duplicates text | B-PR | Obsolete | — | LLM provider removed (03d223a) |
| PR-21 | LLM `temperature: 0` and `<think>` preambles | B-PR | Obsolete | — | LLM provider removed (03d223a) |
| PR-22 | LLM prompt numbering can be steered by the page | B-PR | Obsolete | — | LLM provider removed (03d223a) |
| PR-23 | `networkQuality` can raise a configured cap | B-PR, S-PR | Closed | 95e72d1 | Uses `Math.min` |
| PR-24 | Stale comments: `runWithConcurrencyLimit`, Yandex, Bing, titleTranslator note, stranded JSDoc, repair-trigger note | B-PR, S-PR, FP-R3 | Closed | 2e2fb57 | Comments rewritten |
| PR-25 | Dead code: `getQueryString`/GET, `dontSortResults`, `isAvailable`, `ProviderConfig.google`; `'http'` kind never produced | B-PR, S-PR, FP-R5 | Closed | 95e72d1 | Removed; `'http'` is now produced |
| PR-26 | Separator escape helpers copied between llm.ts and the Cloud provider | B-PR | Obsolete | — | llm.ts removed (03d223a) |
| PR-27 | Errors passed as strings and re-parsed with regex | S-PR, FP-R5 | Closed | 95e72d1 | `TranslateError` carries a kind |
| PR-28 | JSON parse errors are retried | S-PR | Closed | 95e72d1 | Bad JSON is `badResponse`, not retried |
| PR-29 | An HTTP-date `Retry-After` is ignored | S-PR | Closed | R7 | batchedHttpProvider.ts: parseRetryAfterMs() reads delay-seconds or an HTTP date, still capped at 6s |
| PR-30 | Auth state in module globals; scrape has no `response.ok` check and no log on a miss | S-PR | Closed (partly) | R7 | Non-OK scrape answers and a missing key are logged and go to the fallback. The module-level auth state stays: the shared provider and the key snapshot depend on it |
| PR-31 | Heuristics stacked as patches (padding, grouping, three repair signals, streak, retry switching) | S-PR | Won't fix | R7 | Each heuristic answers a separate behaviour seen on live Google; take up with PT-39 |
| PR-32 | Test mocks encode an assumed Google wire format | S-PR | Closed | 0e9421b | Fake answers from recorded responses |

## src/platform

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-1 | Clear cache resets only the Settings page's byte counter | B-PL, S-PL, FP-C, FP-R5 | Closed | 2973ed9 | Byte total kept in the database |
| PL-2 | Eviction loses updates and can double-evict | B-PL, S-PL, FP-R5 | Closed | 2973ed9 | Total updated in the same transaction |
| PL-3 | A failed `indexedDB.open` is cached forever | S-PL, FP-R3 | Closed | a15e60d | Next call retries the open |
| PL-4 | No `onabort`, so a quota failure leaves `setMany` hanging | S-PL, FP-R5 | Closed | 2973ed9 | `onabort` rejects |
| PL-5 | No `onversionchange`/`onblocked` | B-PL, S-PL, FP-R5 | Closed | 2973ed9 | Both handled |
| PL-6 | `withDb` retries on any error and drops the old connection without `close()` | B-PL | Closed | R7 | src/platform/cache/translationCache.ts (withDb now close()s the failed connection and forgets it only if it is still the current one — tracked via currentDb — s |
| PL-7 | Cache entries have no maximum age | FP-C, FP-R5 | Closed | 2973ed9 | 30-day expiry |
| PL-8 | Any `ok` outcome is cached, so a missed echo sticks | S-UI | Won't fix | R7 | Nothing here tells a missed echo from a correct one: English labels on a Vietnamese page come back unchanged correctly and often, and not caching them would re-request them on every load |
| PL-9 | The background drops `sourceLanguageIsExplicit` on every page request | X | Closed | R7 | pieceTranslation.ts: passes sourceLanguageIsExplicit to the provider |
| PL-10 | configStore: `onChanged` registered before init; `set`/`setMany` don't roll back | B-PL, S-PL | Closed | R7 | src/platform/configStore.ts (changedDuringInit set: init skips keys a live change updated while it was reading |
| PL-11 | `configStore.isReady()` is dead | B-PL, FP-R5 | Closed | 95e72d1 | Removed |
| PL-12 | `configStore.export()` is used only by tests | B-PL, FP-R5 | Closed | R7 | src/platform/configStore.ts (removed export()), src/platform/configStore.test.ts (removed its test), src/shared/config/backup.ts + backup.test.ts (comments/test |
| PL-13 | `start()` keeps one language detection for the whole content-script life | B-PL | Won't fix | R7 | No route-change hook in the content script, and detecting again on a translated page would report the target language. Revisit if the owner hits it |
| PL-14 | Stale header and drifted JSDoc in originalLanguageTracker | B-PL | Closed | 2e2fb57 | Comments rewritten |
| PL-15 | Diagnostics redaction misses credentials in `llmBaseUrl`; a crafted backup could send `llmApiKey` elsewhere | B-PL | Obsolete | — | LLM fields removed and deleted by migration v5 (03d223a) |

## src/shared

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-16 | Site lists: `www.`/apex add and remove didn't match the membership test | B-PL | Closed | c69c820 | Apex-aware add/remove (R1-4) |
| PL-17 | Language add/remove match exactly while the decision compares base tags | B-PL, S-PL | Closed | R7 | src/shared/config/listMutations.ts (language add/remove now match by language, not by exact string: withAddedLang de-dupes by languageKey, withRemovedLang remov |
| PL-18 | `baseLanguageTag` treats `zh-CN` and `zh-TW` as one language | B-PL | Closed | R7 | sameLanguage keeps Simplified and Traditional Chinese apart in the lists, the auto-translate decision and the sanity check |
| PL-19 | Orphaned `libreTranslateApiKey` left in storage forever | B-PL | Closed | R7 | src/shared/config/migrations.ts (v6 deletes libreTranslateBaseUrl / libreTranslateApiKey |
| PL-20 | Backups had their own copy of the provider-removal remap | S-PL, FP-R3 | Closed | a15e60d | `parseBackup` runs the migrations |
| PL-21 | `BACKUP_FORMAT_VERSION` is written but never checked | B-PL | Closed | R7 | src/shared/config/backup.ts (parseBackup refuses a wrapped backup whose version > BACKUP_FORMAT_VERSION with "made by a newer version of Prism |
| PL-22 | `unwrapOr` is dead | B-PL, FP-R5 | Closed | 95e72d1 | Removed |
| PL-23 | Stale comments: migrations init note, bubblePosition `min`/`max`, schema "Builtin" | B-PL | Closed | 2e2fb57 | Comments fixed |
| PL-24 | README says engine depends on shared, but shared imports engine | B-PL | Closed | R7 | src/shared/README.md now states imports run both ways, which leaf modules the engine may import (languages, result, text, withTimeout, config/listMutations — no |
| PL-25 | Stable releases sort below their own betas | S-PL, FP-R2 | Closed | 67580f1 | One shared manifestVersion rule |

## entrypoints/background.ts

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-1 | Google key fetched for users on another provider | B-EN, S-UI | Closed | c69c820 | Prefetch only for Google (R1-3) |
| UI-2 | Context menus created only in `onInstalled` | B-EN, S-UI, FP-C | Closed | R7 | New entrypoints/lib/contextMenus.ts ensureContextMenus (removeAll, then create the 3 items) |
| UI-3 | `frameLanguageDecisions` lives only in worker memory | B-EN, S-UI | Closed | R7 | New entrypoints/lib/frameDecisions.ts createFrameDecisionStore: memory plus storage.session (key frameDecision:<tabId>, shape-checked on read) |
| UI-4 | Failure badge is global; overlapping timers clear a newer "!" | B-EN, S-UI | Closed | R7 | New entrypoints/lib/failureBadge.ts: badge on the failing tab (tabId), one timer per tab that a new failure restarts, failed badge calls caught |
| UI-5 | A `loading` status on a pushState navigation deletes the decision | B-EN | Closed | R7 | content.ts: a sub-frame that finds no decision on its first poll posts {prismFrameAsk:true} to the top frame (same origin only) |
| UI-6 | Menu and shortcut use `getActiveTabId()` instead of the given tab | B-EN | Closed | R7 | New entrypoints/lib/targetTab.ts tabIdOrActive (the given tab |
| UI-7 | Contradictory keepalive comments; 30-line `persistent` narrative | B-EN, S-UI, FP-R3 | Closed | 2e2fb57 | Comments rewritten |
| UI-8 | `isTrustedSender` pasted 13 times; threat overstated | B-EN, S-UI, B-PL, FP-R3 | Closed | a15e60d | One `onTrustedMessage` wrapper |
| UI-9 | Each Settings deep link opens a new tab | S-UI, FP-R6 | Closed | 9a444da | Reuses the open Settings tab |
| UI-10 | Background untested; cache merge should be a pure function | B-EN, S-UI, FP-R5 | Closed | 2973ed9 | Moved to src/platform with tests |
| UI-11 | Provider setup-field reading duplicated with the popup | B-EN | Closed | 2973ed9 | Both use `missingProviderSetup` |
| UI-12 | Background and content comments about half changelog | B-EN, S-UI, FP-R3 | Closed | 2e2fb57 | Comments cut |

## entrypoints/content.ts

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-13 | Manual translate never reaches same-origin iframes | B-EN, S-UI, FP-C, FP-R5 | Closed | 9869ad2 | One page controller for every control |
| UI-14 | Bubble "Show original" restores only the top frame | S-UI, FP-R5 | Closed | 9869ad2 | Same controller |
| UI-15 | Sub-frame poll's `sendMessage` is unguarded | B-EN, S-UI | Closed | R7 | New entrypoints/lib/subFramePoll.ts pollForFrameDecision: a failed sync stops the poll and goes to onError (console.warn) |
| UI-16 | `SKIP_UI_PROTOCOLS` is dead | B-EN, S-UI, FP-R5 | Closed | R7 | content.ts: SKIP_UI_PROTOCOLS and its check deleted (*://*/* only runs on http(s)) |

## entrypoints/popup

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-17 | Picking an unconfigured provider saves it, then every page fails | S-UI, FP-R2 | Closed | 67580f1 | Keeps the old provider, opens Settings |
| UI-18 | "Restoring…" never shows | B-EN, S-UI | Closed | R7 | New entrypoints/popup/popupLogic.ts primaryButtonMode |
| UI-19 | `alwaysLangOn` uses an exact `includes` | B-EN | Closed | c69c820 | Base-tag compare (R1-8) |
| UI-20 | "Always translate from X" visibility uses a raw `!==` | B-EN, S-UI | Closed | R7 | popupLogic.ts offersAlwaysTranslateFrom uses sameLanguage (the rule the auto-translate decision and list helpers now use) |
| UI-21 | Removing a language builds the patch by hand, not via listMutations | B-EN, B-PL | Closed | R7 | popupLogic.ts alwaysFromTogglePatch uses removeLangFromAlwaysTranslate / addLangToAlwaysTranslate from src/shared (read, not edited) |
| UI-22 | Popup UI: ~16 controls, pills reorder, unnamed button, mismatched Always/Never, two settings links, internal error text, small targets | S-UI, FP-R6 | Closed | e3486f4 | Popup redesign |
| UI-23 | Popup hand-copies about 12 settings | B-EN, S-UI, FP-R5 | Closed | f46536d | Shared config mirror |

## entrypoints/options

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-24 | "Source language" only feeds the selection popup | S-UI, FP-R2 | Closed | 67580f1 | Relabelled "for selected text" |
| UI-25 | Paragraph switch label tells you to turn off the sangtacviet fix | S-UI, FP-R2 | Closed | 67580f1 | Label says what it carries |
| UI-26 | "Always-translate takes priority" contradicts the code | B-EN | Closed | c69c820 | Text says never wins (R1-4) |
| UI-27 | Diagnostics: red "no" for unused `scripting`; developer wording; raw bytes | S-UI, FP-R6 | Closed | 9a444da | Plain wording; check removed |
| UI-28 | List hint says "one per line" for single-line inputs | S-UI, FP-R6 | Closed | 9a444da | Hints match inputs |
| UI-29 | API key saves on blur, so "Test translation" can use the old key | B-EN, S-UI | Closed | R7 | options/tabs/PageTranslationTab.tsx: provider/key saves are tracked |
| UI-30 | `App.css` imported twice | B-EN, S-UI | Closed | R7 | options/main.tsx: second import './App.css' removed (App.tsx keeps it) |
| UI-31 | Literal backticks around `chrome.storage.sync`; "see diagnostics for why" points nowhere | B-EN | Closed | 9a444da | Backup hint rewritten |
| UI-32 | CSS specificity: red remove hover and "Dismiss" link style never apply | B-EN | Closed | 9a444da | Selectors fixed |
| UI-33 | `options/App.tsx` is one ~700-line component | B-EN, S-UI, FP-R5 | Closed | f46536d | One component per tab |
| UI-34 | Lists show raw codes; small text and low contrast | S-UI, FP-R6 | Closed | 9a444da | Language names, 14px+, 4.5:1 |
| UI-35 | Per-site source-language overrides are explained under "Selection & hover" | S-UI | Closed | R7 | The bubble "From" picks list and its hint moved from options/tabs/SelectionTab.tsx to options/tabs/PageTranslationTab.tsx (new section "Source language picked i |

## components/bubble

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-36 | Long-press also toggles translation | B-CO, S-UI | Closed | c69c820 | `longPressFired` flag (R1-2) |
| UI-37 | Right/middle click starts a drag and a tap | B-CO | Closed | c69c820 | Ignores `button !== 0` |
| UI-38 | Open-on-hover rules not behind `(hover: hover)` | B-CO, S-UI | Closed | 312536c | Hover CSS gated |
| UI-39 | Tap on the ball while pinned switches the page back | S-UI, FP-R2 | Closed | 67580f1 | Tap closes the panel |
| UI-40 | Panel `<select>` at 12.5px makes iOS zoom | S-UI, FP-R2 | Closed | 67580f1 | 16px on touch screens |
| UI-41 | Pinch-zoom moves the ball off screen | B-CO, S-UI, FP-R6 | Closed | 8afc04c | Uses visual-viewport offsets |
| UI-42 | Keystrokes in the bubble reach the page | B-CO, S-UI, FP-C | Closed | R7 | FloatingBubble.tsx: keydown/keyup/keypress stopPropagation listener on props.shadowHost (removed in onCleanup) |
| UI-43 | `applyListPatch` has no `.catch`; Always chip shows saved | B-CO, S-UI, FP-C, FP-R3 | Closed | 92573c7 | Rolls back and warns |
| UI-44 | White on green is 3.30:1 | B-CO, S-UI, FP-C, FP-R6 | Closed | 8afc04c | Colours meet 4.5:1 |
| UI-45 | While busy, the ball and button can't restore | B-CO, S-UI | Closed | R7 | FloatingBubble.tsx: new restorable() (= not errored and pageState 'translated') |
| UI-46 | ArrowDown focuses the primary button even when it's disabled | B-CO | Closed | R7 | FloatingBubble.tsx: ArrowDown's first-control selector skips :disabled |
| UI-47 | `orientationchange` and `actionBusy` timers aren't cleared | B-CO | Closed | R7 | FloatingBubble.tsx: orientationchange and actionBusy timers kept and cleared in onCleanup (long-press timer too) |
| UI-48 | "Restoring…" label is dead (`translated()` needs `!busy`) | B-CO | Closed | R7 | FloatingBubble.tsx: dead "Restoring…" branch removed (restore is synchronous |
| UI-49 | `aria-haspopup` with no menu/dialog; static "Click to translate" title | B-CO | Closed | R7 | FloatingBubble.tsx: aria-haspopup removed (disclosure, aria-expanded stays) |
| UI-50 | `offline` class has no CSS rule ("red/amber" comment fixed in 2e2fb57) | B-CO | Closed | R7 | FloatingBubble.tsx: unstyled offline class dropped (offline is also error, which is styled) |
| UI-51 | Comment says `sourceLanguageByHost` feeds auto-translate-on-load | B-EN | Closed | R7 | FloatingBubble.tsx: comment now says sourceLanguageByHost feeds the picker on later visits and the Settings list (comment-only, no test) |
| UI-52 | Bubble touch UX: 40px ball covers text, Hide has no undo, outside tap reaches the page, no busy feedback, no callout block, 4px drag | S-UI, FP-R6 | Closed | 8afc04c | Bubble redesign |
| UI-53 | ~15 hand-kept listener pairs; 200-line `onMount` mixes drag, keys, viewport | S-UI, B-CO | Won't fix | R7 | Design only, no visible bug; the timer leak it pointed at is UI-47. A listener refactor would risk the bubble for no user gain |
| UI-54 | Viewport helper and hover check duplicated | S-UI, B-CO, FP-R3 | Closed | 92573c7 | One `viewportSize()`, one `canHover()` |
| UI-55 | Font stack and spinner CSS copied across three style files | B-CO | Closed (partly) | R7 | One font-stack constant (components/shared/uiFont.ts). The spinners differ in size and colour, so they stay separate |
| UI-56 | About 40% of component lines are history comments | S-UI | Closed | 2e2fb57 | Comments cut |

## components/selection and components/hoverTooltip

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-57 | Selection trigger doesn't follow scroll | B-CO, S-UI, FP-C, FP-R6 | Closed | 90c970d | Follows page and inner scrolling |
| UI-58 | A `translateOne` rejection leaves "Translating…" spinning | S-UI, FP-R6 | Closed | 90c970d | Clears with plain words |
| UI-59 | Only `mouseup`/`keyup`, so nothing on iPhone | B-CO, S-UI, FP-R6 | Closed | 90c970d | `selectionchange` for touch |
| UI-60 | Selection popup keys reach the page | B-CO, FP-R6 | Closed | 90c970d | Stopped at the host |
| UI-61 | Escape after a right-click translate records the browser's `selectionText` | B-CO | Closed | R7 | mountSelectionPopup.ts: dismiss() records shownForSelection (the page selection's own text, what later keyups compare) instead of selectedText (the browser's ri |
| UI-62 | Copy fallback replaces the page selection, fires page `copy` listeners; `body.append` outside `try` | B-CO, S-UI | Closed | R7 | copyText.ts: fallback answers copy from a window capture listener (setData + preventDefault, stopImmediatePropagation) so page handlers can't see/rewrite it |
| UI-63 | Trigger and tooltip cover the next line; tooltip not clamped | B-CO, S-UI, FP-R6 | Closed | 90c970d | Placed off the line, clamped |
| UI-64 | Hover tooltip sticks when the page is restored while it shows (target-removed case fixed in 90c970d) | B-CO, S-UI | Closed | R7 | mountHoverTooltip.ts: mousemove with no original any more hides the tooltip |
| UI-65 | Hover tooltip detects mobile by user-agent | S-UI, FP-R3 | Closed | 92573c7 | Uses `canHover()` |
| UI-66 | Selection tap targets under 44pt (trigger 30px, × and Copy ~24px) | S-UI | Closed | R7 | selectionPopupStyles.ts: trigger gets a 44px ::before hit area (visual 30px kept, so SELECTION_TRIGGER_SIZE placement math stays right) |
| UI-67 | Keyboard user can't reach the trigger; focus never moves to it | B-CO | Closed | R7 | mountSelectionPopup.ts: after a keyboard selection, plain Tab (not already handled by the page) moves focus to the trigger |
| UI-68 | `role="alert"` nested in a `role="status"` region that also wraps the buttons | B-CO | Closed | R7 | SelectionPopup.tsx: role="status" moved off the panel onto an inner div holding only busy text + result |
| UI-69 | No `dir="auto"` or `white-space: pre-wrap` on results | B-CO | Closed | R7 | SelectionPopup.tsx .result dir="auto" |
| UI-70 | Header comments: "no copy action", "runs on mouseup" | B-CO | Closed | 2e2fb57 | Comments match the code |
| UI-71 | Shadow root is `mode: 'open'`, so the page can read the result | B-CO | Not a bug | — | The result is shown on the page anyway; the audit called it acceptable |

## components/options

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-72 | `StringListEditor` input and select have no accessible name | B-CO | Closed | 9a444da | `aria-label` from the label |

## scripts

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-26 | Engine-purity guard passes `#imports`, `@webext-core`, `../platform`, WXT `storage` | B-PL, S-PL, FP-C, FP-R4 | Closed | 19b0753 | Parser-based, fixture-tested |
| PL-27 | Solid-reactivity guard misses helper reads and `createMemo` | B-PL, S-PL, FP-C, FP-R4 | Closed | 19b0753 | Parser-based, fixture-tested |
| PL-28 | Bundle-size check measures only the Chrome total | B-PL | Closed | R7 | Checks the Chrome and the Firefox build, total and largest file |
| PL-29 | Guard and release scripts untested; `amoVersionFor` copies the version rule | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Script tests in `npm test`; rule shared since 67580f1 |
| PL-30 | Release logic is inline bash in YAML | S-PL, FP-R4 | Closed | 19b0753 | `scripts/release-notes.mjs`, tested |
| PL-31 | The `Checked on:` gate checks the line exists, not that a check happened | S-PL | Closed (partly) | R7 | The gate now needs a real, not-future date and a browser or device on every line |

## .github

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-32 | A re-run after AMO signing silently ships the unsigned zip | S-PL, FP-R4 | Closed | 19b0753 | Fetches Mozilla's signed copy |
| PL-33 | Release checkout leaves a write token while `npm ci` runs | B-PL | Closed | c69c820 | `persist-credentials: false` (R1-12) |
| PL-34 | E2E uses live Google and asserts nothing; no early warning | S-PL, FP-R2 | Closed | 67580f1 | Daily Google canary. The e2e run itself still uses live Google |
| PL-35 | Actions pinned to movable tags | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Pinned to commit SHAs |
| PL-36 | `npx web-ext` outside the lockfile; ci.yml has no `permissions:` | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Lockfile web-ext; read-only default |
| PL-37 | fetch-signed-xpi shows "not approved yet" as red; keeps write credentials | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Notice, not failure; no persisted token |
| PL-38 | fetch-signed-xpi leaves the unsigned zip next to the signed .xpi | B-PL, S-PL | Closed | R7 | fetch-signed-xpi deletes the unsigned Firefox zip once the signed .xpi is attached |
| PL-39 | No Dependabot | S-PL, FP-R4 | Closed | 19b0753 | Weekly npm and actions updates |
| PL-40 | Safari bundle stuck at beta.70 with LLM code; `MARKETING_VERSION` never bumped; not in CI | S-PL, FP-R4 | Closed | 19b0753 | Synced, versioned, CI-checked |
| PL-41 | ci.yml comment says coverage covers only engine and shared | B-PL | Closed | R7 | Comment replaced: limits per folder live in vitest.config.ts |

## Root config and tests (wxt.config.ts, vitest.config.ts, tests/, CLAUDE.md)

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-42 | Coverage is one global threshold; a new file can land at 0% | S-PL, FP-R4 | Closed | 19b0753 | Per-folder thresholds |
| PL-43 | `entrypoints/` and `components/` are outside coverage | B-EN, S-PL, FP-R4 | Closed | R7 | components/ and entrypoints/lib/ are coverage-gated per folder |
| PL-44 | Replay harness has 3 cases, desktop Chrome only, no sangtacviet chapter | S-PL, FP-R5 | Won't fix | R7 | Needs a sangtacviet chapter page the owner saves from their browser |
| PL-45 | wxt.config.ts comments: "Chrome-only at launch"; `activeTab` "avoids broad host access" | B-EN | Closed | R7 | Comments say which browsers ship and what each permission is for |
| PL-46 | No `host_permissions`, so an LLM base URL needs CORS on Firefox | B-EN | Obsolete | — | LLM provider removed (03d223a) |
| PL-47 | Comments in scripts and root config are still incident narrative | S-PL | Closed | R7 | Script and config headers cut to the current why |
| PL-48 | Session rules at the top of `CLAUDE.md` | FP-R2 | Closed | 67580f1 | Added |

---

## Found by the re-grade (docs/reports/senior-engineer-regrade.md)

| ID | Finding | Source | Status | Where | Note |
|---|---|---|---|---|---|
| RG-1 | A browser without `storage.session` breaks translation through the key listener | Re-grade | Closed | 2f38fc0 | Listener wrapped in try/catch; save skipped without `storage.session` |
| RG-2 | A brief throttle abandons paragraphs in a mixed batch after 3 tries, with no message | Re-grade | Closed | af8e6a6 | Real failures in a mixed batch are requeued under the backoff |
| RG-3 | Bubble From picker shows an earlier visit's pick that isn't in effect, and can't re-pick it | Re-grade | Closed | 207f847 | Picker starts at Auto on each page load |
| RG-4 | `npm run compile` ran TypeScript 5.9, not 7 | Re-grade | Closed | 2f38fc0 | Script runs TypeScript 7 by path |

## Found by the iPhone Simulator check (Release 8)

| ID | Finding | Source | Status | Where | Note |
|---|---|---|---|---|---|
| SIM-1 | On iOS 26 the selection button sits under iOS's own Copy / Find Selection / Look Up menu, so a tap reaches Apple's menu | Simulator run 5 | Closed | cede0e8, f4d4e38 | On touch screens the button sits on the selected line, after its end; tapping it clears the selection so iOS's menu closes |
| SIM-2 | Same-origin iframes never get the page's decision on Safari: Safari names no tab for a frame's message | Simulator runs 5–6 | Closed | f4d4e38 | The top frame hands its frames a page key; the background stores the decision under it too |
| SIM-3 | The sub-frame dropped the page key: `event.source === window.top` never holds in Safari's content-script world | Simulator run 7 | Closed | 630e69b | The key is taken by origin; a forged key finds nothing |
| SIM-4 | The sub-frame sent the top frame's detected language (Safari's `zh-Hans`) as an explicit source, so Google echoed the text | Simulator run 11 | Closed | 94d9278 | Only a From pick is explicit; a detected language is a hint, as in the top frame |
| SIM-5 | The bubble panel's three pickers cut their labels short at iPhone width ("Englisl", "Googl") | Simulator run 12 screenshot | Open | components/bubble/bubbleStyles.ts | Cosmetic; left for the owner to prioritise |

## Release 7 outcome

Every Open row was settled in Release 7 (marked `R7` in the table): fixed
with a test that failed first, or kept with a reason. What is left on purpose:

- **Won't fix (7):** PT-31, PT-39, PR-31, PL-8, PL-13, UI-53 — each would risk
  reading behaviour for no bug the owner has hit; the reason is in its row.
  PL-44 needs a sangtacviet chapter page saved by the owner.
- **Closed (partly) (6):** PT-19, PT-22, PT-34, PR-30, UI-55, PL-31 — the
  part that can bite is fixed; the row says what was left and why.

New rows come only from a bug the owner reports.
