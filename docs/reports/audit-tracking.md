# Audit tracking: every finding, checked against the current code

_2026-11-03 · checked at commit `2c8fdc9` (0.3.2-beta.4, after Release 6) · for Release 7_

This is the Release 7 work list. It lists every finding from both audits and
from the fix plan's lists, removes duplicates, and gives each one a status.
Each status comes from reading the current code, not the audit's line numbers.
Line numbers below are for `2c8fdc9`.

**Totals (193 rows):** Closed 103 · Open 82 · Not a bug 1 · Obsolete 7

Of the 82 Open rows: 8 Med (one is PL-9, found while checking), 3 Low-Med,
67 Low (including 4 performance rows and 1 test row), and 4 Design or Process
points.

| Status | Meaning |
|---|---|
| Closed | Fixed. The commit is given. |
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
| PT-8 | Catch path requeues nodes `onPieceComplete` already wrote | S-PT | Open | translateLoop.ts:445-454 (calls `requeueBatch` :227) | A batch that times out after a partial write re-sends the English output, and emptied run nodes as `''` |
| PT-9 | Hover original for a word run is only its head word | S-PT | Open | writeBack.ts:74-79 | Hovering a translated sentence shows one source word |
| PT-10 | Attribute restore keeps the first value ever seen | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Restore puts back the page's latest value |
| PT-11 | Attribute write-back has no staleness check | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Same `sentText` rule as text nodes |
| PT-12 | Rejected attribute batch stops the observer starting | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Rejection caught; observer still starts |
| PT-13 | Attribute change path uses the wrong skip check (textarea placeholder, `translate="no"`) | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Uses the page walk's ancestor rule |
| PT-14 | Title translator has no generation guard (late chapter-1 title) | B-PT, S-PT, FP-C, FP-R3 | Closed | 085aa3c | Generation counter drops late replies |
| PT-15 | Attributes inside shadow DOM are never collected | S-PT | Open | collectTextNodes.ts:202, 215 | The walk pushes the shadow root, then skips it because it isn't an element |
| PT-16 | Attribute observer starts only after the first batch returns | S-PT | Open | attributeTranslator.ts:247-255 | Elements added during the first request are never translated |
| PT-17 | Restore skips detached nodes; the two-tick prune drops long-detached ones | B-PT, S-PT | Open | writeBack.ts:59; attributeTranslator.ts:262 | A recycled node off the page at "Show original" comes back still translated |
| PT-18 | Retry counters survive across cycles | B-PT, S-PT | Open | translateLoop.ts:116-117 (not reset in `translatePage` :600-639) | A node that gave up once gets no retry after a language switch |
| PT-19 | `translate="no"` compared case-sensitively; nested `translate="yes"` ignored | B-PT, S-PT | Open | collectTextNodes.ts:83, 169 | `translate="NO"` content gets translated |
| PT-20 | A sync throw after the queue splice drops the batch and spins | B-PT | Open | translateLoop.ts:405-416 (outside the `try`); listeners :145-151 | A throwing listener or grouping bug loses nodes and loops at 0 ms |
| PT-21 | Tail always re-arms; timer handles overwritten without clearing | B-PT | Closed | e44fd83 | `schedule` always clears; idle 2 s poll is by design |
| PT-22 | `BLOCK_TAGS` misses NAV, HEADER, UL, OL, TABLE, custom elements | B-PT, S-PT | Open | grouping.ts:24-42 | Unrelated nodes under those containers (and in shadow DOM) can share one marker piece |
| PT-23 | Three contradictory comments on the `<pre>` default | B-PT | Closed | 2e2fb57 | Comments now agree |
| PT-24 | Comment: `consecutiveBatchFailures` "reset on offline ticks" | B-PT | Obsolete | — | Variable replaced by errorState.ts (e44fd83) |
| PT-25 | "Offline error clears itself on the next tick" is false | B-PT | Open | translateLoop.ts:587-588; errorState.ts:49-51 | After reconnecting, a failing provider keeps showing "Offline" for up to 3 failed batches |
| PT-26 | Stale cross-references and incident-narrative comments | B-PT, S-PT, FP-R3 | Closed | 2e2fb57 | Comments cut to short "why" notes |
| PT-27 | `getTranslatedNodes` has no caller | B-PT, FP-R5 | Closed | 95e72d1 | Removed |
| PT-28 | `suppressNextObserverTick` is effectively dead and can swallow a real title change | B-PT, FP-R5 | Open | titleTranslator.ts:128-132, 183-186 | Listed for deletion in Release 5 but still there |
| PT-29 | `HAS_LETTER` defined three times | B-PT, FP-R3 | Closed | 085aa3c | One copy in src/shared/text.ts |
| PT-30 | The two-tick prune helper is written twice | B-PT | Open | writeBack.ts:21-36; attributeTranslator.ts:17-32 | Copied rule; a fix to one can miss the other |
| PT-31 | Perf: full `document.body` resweep every 1.5–10 s forever | B-PT | Open | resweep.ts:11; translateLoop.ts:557-566 | A churning page walks the whole DOM every 1.5 s |
| PT-32 | Perf: `findOriginalTextForElement` is O(N) per mousemove | B-PT | Open | writeBack.ts:74-79 | Long pages pay a full ledger scan per mouse move |
| PT-33 | Perf: any watched attribute change re-walks the element's subtree | B-PT | Open | attributeTranslator.ts:178-188 | A `title` toggled on a big container re-walks it |
| PT-34 | Perf: O(depth) ancestor walk per added node; duplicate subtree walks | B-PT | Open | mutationWatcher.ts:34-37 | Parent and child both added are walked twice |
| PT-35 | `createPageTranslator` is one huge closure | S-PT, FP-R5 | Closed | e44fd83 | Split into scheduler, errors, progress, write-back |
| PT-36 | Error state spread over six variables | S-PT, FP-R5 | Closed | e44fd83 | One `ErrorState` value with pure transitions |
| PT-37 | Requeue and failure-surfacing blocks written twice | S-PT | Closed | e44fd83 | One function each |
| PT-38 | Attribute/title translators re-implement staleness and generation weakly | S-PT, FP-R3 | Closed | 085aa3c | Same rules as the main loop |
| PT-39 | Grouping stacks five isolation rules with magic thresholds; "is grouping worth it?" | S-PT | Open | grouping.ts (whole file) | Design. The fix plan defers it until saved pages show a need |
| PT-40 | Uppercase fake translator can't model Google | S-PT, FP-R5 | Closed | 0e9421b | Realistic Google fake from recordings |
| PT-41 | About 70 real-clock `waitFor` calls; timers untested | S-PT | Open | translateLoop.test.ts (70 `waitFor`) | Low (tests). Scheduler now has fake-timer tests; the loop tests still race the clock |

## src/engine/providers (and src/engine/selection)

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PR-1 | Short Vietnamese echoes pass: length gate runs before the language check | S-PR, FP-R2, FP-R5 | Closed | 0e9421b | Data-checked short-echo rule |
| PR-2 | `repair()` drops `sourceLanguageIsExplicit`, so repairs go out as `'auto'` | S-PR, B-PR, FP-C | Open | google.ts:351-355 | A From pick is ignored for every repaired piece. Fix with PL-9 |
| PR-3 | Only non-retryable errors keep their cause; bad shapes read as "couldn't reach" | S-PR, FP-R5 | Closed | 95e72d1 | Structured error kinds; response shape checked |
| PR-4 | `needsRepair` skips padded pieces before the leaked-marker check | S-PR | Open | google.ts:329 | A broken tag in a one-string piece can write literal `<a i=0>` onto the page |
| PR-5 | `onPieceComplete` forwards a padded piece's raw value without the overflow join | S-PR, B-PR | Open | google.ts:382-389 | Page flashes "…Pro " before the end-of-tick rewrite |
| PR-6 | `throw lastError` can throw `undefined` | S-PR, B-PR, FP-C | Closed | 95e72d1 | Throws a timeout instead |
| PR-7 | Repairs inherit the parent deadline while queued in the gate | S-PR, B-PR | Open | batchedHttpProvider.ts:457-469, 375 | A queued repair times out, so a suspicious echo is reported as a timeout and retried as an outage |
| PR-8 | Suspicious retry overrides an explicit source with `'auto'`; on `'auto'` it resends the same request | S-PR | Open | batchedHttpProvider.ts:460-462 | From = vi is ignored on retry; `'auto'` retries are wasted |
| PR-9 | `invalidateAuth()` nulls the key while sibling batches are queued | S-PR, B-PR | Open | google.ts:54-57, 284 | One 403 sends the rest of the tick with an empty key |
| PR-10 | Key snapshot saved only at worker startup | S-PR, B-PR | Open | google.ts:37-47; entrypoints/background.ts:131-134 | A restart within 20 min brings back a key Google already rejected. Needs a hook here and a save in background.ts |
| PR-11 | `resolveFn` isn't idempotent; a throw mid-loop re-resolves pieces | S-PR | Open | batchedHttpProvider.ts:416-432, 471-480 | Suspicious window counts pieces twice |
| PR-12 | A single hanzi can't be selected (`length >= 2`) | S-PR, B-PR, S-UI | Closed | 90c970d | One non-Latin letter allowed |
| PR-13 | `^<pre>…</pre>$` match isn't trimmed | S-PR, B-PR | Open | google.ts:216 | A trailing newline leaks `</pre>` as text |
| PR-14 | Repeated indices joined with an ASCII space | S-PR, B-PR | Open | google.ts:239 | Stray spaces in zh/ja/th output |
| PR-15 | Batch budgets checked after the piece is added | S-PR, B-PR | Open | batchedHttpProvider.ts:534-545 | A request can pass the 6000-char wire ceiling by one piece |
| PR-16 | `Content-Type: application/application/json+protobuf` | S-PR, B-PR | Open | google.ts:283 | Works only because Google is lenient |
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
| PR-29 | An HTTP-date `Retry-After` is ignored | S-PR | Open | batchedHttpProvider.ts:293 | `parseFloat` of a date is NaN, so Google's wait is ignored |
| PR-30 | Auth state in module globals; scrape has no `response.ok` check and no log on a miss | S-PR | Open | google.ts:15-18, 132-156 | A changed bundle or error page drops silently to the fallback key |
| PR-31 | Heuristics stacked as patches (padding, grouping, three repair signals, streak, retry switching) | S-PR | Open | google.ts, batchedHttpProvider.ts | Design. Goes with PT-39 |
| PR-32 | Test mocks encode an assumed Google wire format | S-PR | Closed | 0e9421b | Fake answers from recorded responses |

## src/platform

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-1 | Clear cache resets only the Settings page's byte counter | B-PL, S-PL, FP-C, FP-R5 | Closed | 2973ed9 | Byte total kept in the database |
| PL-2 | Eviction loses updates and can double-evict | B-PL, S-PL, FP-R5 | Closed | 2973ed9 | Total updated in the same transaction |
| PL-3 | A failed `indexedDB.open` is cached forever | S-PL, FP-R3 | Closed | a15e60d | Next call retries the open |
| PL-4 | No `onabort`, so a quota failure leaves `setMany` hanging | S-PL, FP-R5 | Closed | 2973ed9 | `onabort` rejects |
| PL-5 | No `onversionchange`/`onblocked` | B-PL, S-PL, FP-R5 | Closed | 2973ed9 | Both handled |
| PL-6 | `withDb` retries on any error and drops the old connection without `close()` | B-PL | Open | cache/translationCache.ts:208-218 | Each non-connection error leaks an open connection |
| PL-7 | Cache entries have no maximum age | FP-C, FP-R5 | Closed | 2973ed9 | 30-day expiry |
| PL-8 | Any `ok` outcome is cached, so a missed echo sticks | S-UI | Open | pieceTranslation.ts:189-202 | An untranslated line stays untranslated on every reload for up to 30 days |
| PL-9 | The background drops `sourceLanguageIsExplicit` on every page request | X | Open | pieceTranslation.ts:160-163 | The bubble's From pick never reaches Google: it sends `'auto'` and uses the pick only as a retry fallback. Med (my estimate) |
| PL-10 | configStore: `onChanged` registered before init; `set`/`setMany` don't roll back | B-PL, S-PL | Open | configStore.ts:51-65 vs 67-87; 122-138 | A change from another tab during startup is overwritten by the stale snapshot |
| PL-11 | `configStore.isReady()` is dead | B-PL, FP-R5 | Closed | 95e72d1 | Removed |
| PL-12 | `configStore.export()` is used only by tests | B-PL, FP-R5 | Open | configStore.ts:144-146 | Listed for deletion in Release 5 but still there |
| PL-13 | `start()` keeps one language detection for the whole content-script life | B-PL | Open | originalLanguageTracker.ts:128-132 | An SPA route into another language keeps the first page's language |
| PL-14 | Stale header and drifted JSDoc in originalLanguageTracker | B-PL | Closed | 2e2fb57 | Comments rewritten |
| PL-15 | Diagnostics redaction misses credentials in `llmBaseUrl`; a crafted backup could send `llmApiKey` elsewhere | B-PL | Obsolete | — | LLM fields removed and deleted by migration v5 (03d223a) |

## src/shared

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-16 | Site lists: `www.`/apex add and remove didn't match the membership test | B-PL | Closed | c69c820 | Apex-aware add/remove (R1-4) |
| PL-17 | Language add/remove match exactly while the decision compares base tags | B-PL, S-PL | Open | config/listMutations.ts:109-133 (`withAdded`/`withRemoved` :17-23) | `zh` on never plus "always from Chinese" on a `zh-CN` page: toggle reads ON, page never auto-translates. Hostname part fixed in c69c820 |
| PL-18 | `baseLanguageTag` treats `zh-CN` and `zh-TW` as one language | B-PL | Open | languages.ts:62-65 | Target zh-TW on a Simplified page is skipped as "same language" |
| PL-19 | Orphaned `libreTranslateApiKey` left in storage forever | B-PL | Open | config/migrations.ts:7-9, 69-78 | An old API key stays in storage; v4 never deletes it |
| PL-20 | Backups had their own copy of the provider-removal remap | S-PL, FP-R3 | Closed | a15e60d | `parseBackup` runs the migrations |
| PL-21 | `BACKUP_FORMAT_VERSION` is written but never checked | B-PL | Open | config/backup.ts:11, 29-54 | A future format would import without a warning |
| PL-22 | `unwrapOr` is dead | B-PL, FP-R5 | Closed | 95e72d1 | Removed |
| PL-23 | Stale comments: migrations init note, bubblePosition `min`/`max`, schema "Builtin" | B-PL | Closed | 2e2fb57 | Comments fixed |
| PL-24 | README says engine depends on shared, but shared imports engine | B-PL | Open | src/shared/README.md; pageStatus.ts:1, popupView.ts:1-2, translationTest.ts:1-2, config/providerSetup.ts:1 | Two-way layer dependency the guard doesn't flag |
| PL-25 | Stable releases sort below their own betas | S-PL, FP-R2 | Closed | 67580f1 | One shared manifestVersion rule |

## entrypoints/background.ts

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-1 | Google key fetched for users on another provider | B-EN, S-UI | Closed | c69c820 | Prefetch only for Google (R1-3) |
| UI-2 | Context menus created only in `onInstalled` | B-EN, S-UI, FP-C | Open | background.ts:170-187 | Firefox/Orion lose the right-click items after a browser restart |
| UI-3 | `frameLanguageDecisions` lives only in worker memory | B-EN, S-UI | Open | background.ts:65 | A same-origin iframe added after a worker restart waits about 9 s and stays untranslated |
| UI-4 | Failure badge is global; overlapping timers clear a newer "!" | B-EN, S-UI | Open | background.ts:102-109 | The "!" can vanish early or show on the wrong tab |
| UI-5 | A `loading` status on a pushState navigation deletes the decision | B-EN | Open | background.ts:214-216 | Iframes after an SPA route change may not inherit (low confidence) |
| UI-6 | Menu and shortcut use `getActiveTabId()` instead of the given tab | B-EN | Open | background.ts:188-190, 199-200 | Can act on a different tab than the one clicked |
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
| UI-15 | Sub-frame poll's `sendMessage` is unguarded | B-EN, S-UI | Open | content.ts:375-387 | After an extension update the page console gets an unhandled rejection |
| UI-16 | `SKIP_UI_PROTOCOLS` is dead | B-EN, S-UI, FP-R5 | Open | content.ts:24, 152 | Listed for deletion in Release 5 but still there |

## entrypoints/popup

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-17 | Picking an unconfigured provider saves it, then every page fails | S-UI, FP-R2 | Closed | 67580f1 | Keeps the old provider, opens Settings |
| UI-18 | "Restoring…" never shows | B-EN, S-UI | Open | popup/App.tsx:84, 387 | During "Show original" the button flips to "Translating…" |
| UI-19 | `alwaysLangOn` uses an exact `includes` | B-EN | Closed | c69c820 | Base-tag compare (R1-8) |
| UI-20 | "Always translate from X" visibility uses a raw `!==` | B-EN, S-UI | Open | popup/App.tsx:489 | A `pt-BR` page with target `pt` shows a toggle that can never fire |
| UI-21 | Removing a language builds the patch by hand, not via listMutations | B-EN, B-PL | Open | popup/App.tsx:316-321 | Copied rule; goes with PL-17 |
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
| UI-29 | API key saves on blur, so "Test translation" can use the old key | B-EN, S-UI | Open | options/tabs/PageTranslationTab.tsx:86, 36 | First test after typing a key can say "needs setup" |
| UI-30 | `App.css` imported twice | B-EN, S-UI | Open | options/main.tsx:5 (also App.tsx:13) | Styles ship twice |
| UI-31 | Literal backticks around `chrome.storage.sync`; "see diagnostics for why" points nowhere | B-EN | Closed | 9a444da | Backup hint rewritten |
| UI-32 | CSS specificity: red remove hover and "Dismiss" link style never apply | B-EN | Closed | 9a444da | Selectors fixed |
| UI-33 | `options/App.tsx` is one ~700-line component | B-EN, S-UI, FP-R5 | Closed | f46536d | One component per tab |
| UI-34 | Lists show raw codes; small text and low contrast | S-UI, FP-R6 | Closed | 9a444da | Language names, 14px+, 4.5:1 |
| UI-35 | Per-site source-language overrides are explained under "Selection & hover" | S-UI | Open | options/tabs/SelectionTab.tsx:9-21 | The bubble's From picks are a page setting, filed under selection |

## components/bubble

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-36 | Long-press also toggles translation | B-CO, S-UI | Closed | c69c820 | `longPressFired` flag (R1-2) |
| UI-37 | Right/middle click starts a drag and a tap | B-CO | Closed | c69c820 | Ignores `button !== 0` |
| UI-38 | Open-on-hover rules not behind `(hover: hover)` | B-CO, S-UI | Closed | 312536c | Hover CSS gated |
| UI-39 | Tap on the ball while pinned switches the page back | S-UI, FP-R2 | Closed | 67580f1 | Tap closes the panel |
| UI-40 | Panel `<select>` at 12.5px makes iOS zoom | S-UI, FP-R2 | Closed | 67580f1 | 16px on touch screens |
| UI-41 | Pinch-zoom moves the ball off screen | B-CO, S-UI, FP-R6 | Closed | 8afc04c | Uses visual-viewport offsets |
| UI-42 | Keystrokes in the bubble reach the page | B-CO, S-UI, FP-C | Open | FloatingBubble.tsx:380-409 | Typing in the language picker on YouTube fires its shortcuts; no `stopPropagation` |
| UI-43 | `applyListPatch` has no `.catch`; Always chip shows saved | B-CO, S-UI, FP-C, FP-R3 | Closed | 92573c7 | Rolls back and warns |
| UI-44 | White on green is 3.30:1 | B-CO, S-UI, FP-C, FP-R6 | Closed | 8afc04c | Colours meet 4.5:1 |
| UI-45 | While busy, the ball and button can't restore | B-CO, S-UI | Open | FloatingBubble.tsx:212-215, 674 | On a busy feed "Show original" stays blocked. A pulse was added (8afc04c), not a way out |
| UI-46 | ArrowDown focuses the primary button even when it's disabled | B-CO | Open | FloatingBubble.tsx:395-396 | Panel opens but focus stays on the ball |
| UI-47 | `orientationchange` and `actionBusy` timers aren't cleared | B-CO | Open | FloatingBubble.tsx:218, 232 | Leak pattern; writes to detached nodes after Hide |
| UI-48 | "Restoring…" label is dead (`translated()` needs `!busy`) | B-CO | Open | FloatingBubble.tsx:591, 614 | Dead branch |
| UI-49 | `aria-haspopup` with no menu/dialog; static "Click to translate" title | B-CO | Open | FloatingBubble.tsx:630-632 | Screen readers announce a menu; title is wrong when a click restores |
| UI-50 | `offline` class has no CSS rule ("red/amber" comment fixed in 2e2fb57) | B-CO | Open | FloatingBubble.tsx:623; no rule in bubbleStyles.ts | Dead class |
| UI-51 | Comment says `sourceLanguageByHost` feeds auto-translate-on-load | B-EN | Open | FloatingBubble.tsx:533 | content.ts never reads it |
| UI-52 | Bubble touch UX: 40px ball covers text, Hide has no undo, outside tap reaches the page, no busy feedback, no callout block, 4px drag | S-UI, FP-R6 | Closed | 8afc04c | Bubble redesign |
| UI-53 | ~15 hand-kept listener pairs; 200-line `onMount` mixes drag, keys, viewport | S-UI, B-CO | Open | FloatingBubble.tsx:224-462 | Design. One `AbortController` and a gesture helper |
| UI-54 | Viewport helper and hover check duplicated | S-UI, B-CO, FP-R3 | Closed | 92573c7 | One `viewportSize()`, one `canHover()` |
| UI-55 | Font stack and spinner CSS copied across three style files | B-CO | Open | bubbleStyles.ts:31; selectionPopupStyles.ts:45; hoverTooltipStyles.ts:20 | Copied rule |
| UI-56 | About 40% of component lines are history comments | S-UI | Closed | 2e2fb57 | Comments cut |

## components/selection and components/hoverTooltip

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| UI-57 | Selection trigger doesn't follow scroll | B-CO, S-UI, FP-C, FP-R6 | Closed | 90c970d | Follows page and inner scrolling |
| UI-58 | A `translateOne` rejection leaves "Translating…" spinning | S-UI, FP-R6 | Closed | 90c970d | Clears with plain words |
| UI-59 | Only `mouseup`/`keyup`, so nothing on iPhone | B-CO, S-UI, FP-R6 | Closed | 90c970d | `selectionchange` for touch |
| UI-60 | Selection popup keys reach the page | B-CO, FP-R6 | Closed | 90c970d | Stopped at the host |
| UI-61 | Escape after a right-click translate records the browser's `selectionText` | B-CO | Open | selection/mountSelectionPopup.ts:418-421 | The trigger pops straight back after Escape |
| UI-62 | Copy fallback replaces the page selection, fires page `copy` listeners; `body.append` outside `try` | B-CO, S-UI | Open | selection/copyText.ts:16-30 | Page can rewrite the clipboard; a null body rejects unhandled |
| UI-63 | Trigger and tooltip cover the next line; tooltip not clamped | B-CO, S-UI, FP-R6 | Closed | 90c970d | Placed off the line, clamped |
| UI-64 | Hover tooltip sticks when the page is restored while it shows (target-removed case fixed in 90c970d) | B-CO, S-UI | Open | hoverTooltip/mountHoverTooltip.ts:124-129 | After "Show original" by shortcut, mousemove finds no original and never hides |
| UI-65 | Hover tooltip detects mobile by user-agent | S-UI, FP-R3 | Closed | 92573c7 | Uses `canHover()` |
| UI-66 | Selection tap targets under 44pt (trigger 30px, × and Copy ~24px) | S-UI | Open | selection/selectionPopupStyles.ts:15-19, 84-108 | Hard to hit on the iPhone. Not in the Release 6 list |
| UI-67 | Keyboard user can't reach the trigger; focus never moves to it | B-CO | Open | selection/mountSelectionPopup.ts; SelectionPopup.tsx | A Shift+Arrow selection shows a button only reachable by tabbing the whole page |
| UI-68 | `role="alert"` nested in a `role="status"` region that also wraps the buttons | B-CO | Open | selection/SelectionPopup.tsx:55-80 | Errors may be read twice |
| UI-69 | No `dir="auto"` or `white-space: pre-wrap` on results | B-CO | Open | selectionPopupStyles.ts; hoverTooltipStyles.ts | RTL results read LTR; paragraphs run together |
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
| PL-28 | Bundle-size check measures only the Chrome total | B-PL | Open | check-bundle-size.mjs:27-37 | A one-bundle bloat or a Firefox-only bloat passes |
| PL-29 | Guard and release scripts untested; `amoVersionFor` copies the version rule | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Script tests in `npm test`; rule shared since 67580f1 |
| PL-30 | Release logic is inline bash in YAML | S-PL, FP-R4 | Closed | 19b0753 | `scripts/release-notes.mjs`, tested |
| PL-31 | The `Checked on:` gate checks the line exists, not that a check happened | S-PL | Open | release-notes.mjs | Process. The releasing session writes the line itself |

## .github

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-32 | A re-run after AMO signing silently ships the unsigned zip | S-PL, FP-R4 | Closed | 19b0753 | Fetches Mozilla's signed copy |
| PL-33 | Release checkout leaves a write token while `npm ci` runs | B-PL | Closed | c69c820 | `persist-credentials: false` (R1-12) |
| PL-34 | E2E uses live Google and asserts nothing; no early warning | S-PL, FP-R2 | Closed | 67580f1 | Daily Google canary. The e2e run itself still uses live Google |
| PL-35 | Actions pinned to movable tags | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Pinned to commit SHAs |
| PL-36 | `npx web-ext` outside the lockfile; ci.yml has no `permissions:` | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Lockfile web-ext; read-only default |
| PL-37 | fetch-signed-xpi shows "not approved yet" as red; keeps write credentials | B-PL, S-PL, FP-R4 | Closed | 19b0753 | Notice, not failure; no persisted token |
| PL-38 | fetch-signed-xpi leaves the unsigned zip next to the signed .xpi | B-PL, S-PL | Open | workflows/fetch-signed-xpi.yml:58 | Two Firefox files on the release; easy to install the wrong one |
| PL-39 | No Dependabot | S-PL, FP-R4 | Closed | 19b0753 | Weekly npm and actions updates |
| PL-40 | Safari bundle stuck at beta.70 with LLM code; `MARKETING_VERSION` never bumped; not in CI | S-PL, FP-R4 | Closed | 19b0753 | Synced, versioned, CI-checked |
| PL-41 | ci.yml comment says coverage covers only engine and shared | B-PL | Open | workflows/ci.yml:53-55 | Platform is covered too |

## Root config and tests (wxt.config.ts, vitest.config.ts, tests/, CLAUDE.md)

| ID | Finding | Source | Status | Where / commit | Note |
|---|---|---|---|---|---|
| PL-42 | Coverage is one global threshold; a new file can land at 0% | S-PL, FP-R4 | Closed | 19b0753 | Per-folder thresholds |
| PL-43 | `entrypoints/` and `components/` are outside coverage | B-EN, S-PL, FP-R4 | Open | vitest.config.ts:33 | Release 4 said they'd join once testable; they haven't |
| PL-44 | Replay harness has 3 cases, desktop Chrome only, no sangtacviet chapter | S-PL, FP-R5 | Open | tests/replay/pages (3 cases) | Needs a chapter page the owner saves |
| PL-45 | wxt.config.ts comments: "Chrome-only at launch"; `activeTab` "avoids broad host access" | B-EN | Open | wxt.config.ts:11-21, 32-39 | Firefox and Safari ship; `*://*/*` content scripts already grant all sites |
| PL-46 | No `host_permissions`, so an LLM base URL needs CORS on Firefox | B-EN | Obsolete | — | LLM provider removed (03d223a) |
| PL-47 | Comments in scripts and root config are still incident narrative | S-PL | Open | check-bundle-size.mjs:1-23; vitest.config.ts:4-21; wxt.config.ts | The Release 3 cut covered only src/, entrypoints/ and components/ |
| PL-48 | Session rules at the top of `CLAUDE.md` | FP-R2 | Closed | 67580f1 | Added |

---

## Open, by folder

The work list for Release 7. Highest severity first within each folder.

### src/engine/pageTranslator
- **Low-Med** PT-17: "Show original" skips nodes that are off the page right then, so they come back translated.
- Low PT-8: a timed-out batch re-sends text already translated.
- Low PT-9: hover shows only the first word of a word-run's source.
- Low PT-15: attributes inside shadow DOM are never translated.
- Low PT-16: attributes added during the first request are missed.
- Low PT-18: retry counters carry over to the next language.
- Low PT-19: `translate="NO"` (any case) is not respected.
- Low PT-20: a throw before the request drops the batch and spins.
- Low PT-22: `BLOCK_TAGS` misses list, table, nav and custom containers.
- Low PT-25: "Offline" lingers after reconnecting; comment is wrong.
- Low PT-28: dead `suppressNextObserverTick` can eat a title change.
- Low PT-30: prune helper copied in two files.
- Low PT-31 to PT-34: four performance hot spots (resweep, hover lookup, attribute re-walk, ancestor walk).
- Low PT-41: loop tests race the real clock.
- Design PT-39: grouping's rule stack; deferred by the fix plan.

### src/engine/providers
- **Med** PR-2: repairs drop the explicit source language. Fix together with PL-9.
- **Low-Med** PR-4: padded pieces skip the leaked-marker check.
- Low PR-5: padded piece flashes untrimmed text.
- Low PR-7: a queued repair times out and loses its "suspicious" kind.
- Low PR-8: suspicious retry ignores an explicit source, or repeats `'auto'`.
- Low PR-9: invalidated key leaves sibling requests with an empty key.
- Low PR-10: a rejected key comes back after a worker restart (needs background.ts too).
- Low PR-11: double resolve skews the suspicious window.
- Low PR-13: untrimmed `<pre>` match leaks markup.
- Low PR-14: ASCII space joins repeated CJK indices.
- Low PR-15: one piece can push a request past the wire ceiling.
- Low PR-16: doubled `application/` in Content-Type.
- Low PR-29: HTTP-date `Retry-After` ignored.
- Low PR-30: key scrape has no `response.ok` check or log.
- Design PR-31: stacked heuristics (goes with PT-39).

### src/platform
- **Med** PL-9 (not in audits): background drops the From pick on every page request.
- Low PL-6: cache retry leaks a connection.
- Low PL-8: a missed echo stays cached up to 30 days.
- Low PL-10: configStore startup race; no rollback on failed save.
- Low PL-12: dead `configStore.export()`.
- Low PL-13: language detected once per content script.

### src/shared
- **Med** PL-17: language list add/remove match exactly; the decision uses base tags.
- Low PL-18: `zh-CN` and `zh-TW` treated as the same language.
- Low PL-19: old LibreTranslate API key never deleted.
- Low PL-21: backup format version never checked.
- Low PL-24: shared imports engine, against its README.

### entrypoints/background.ts
- **Med** UI-2: right-click menus vanish after a Firefox/Orion restart.
- **Med** UI-3: frame decisions lost on worker restart.
- Low UI-4: global failure badge with racing timers.
- Low UI-5: pushState may delete the frame decision.
- Low UI-6: menu and shortcut ignore the tab they were given.

### entrypoints/content.ts
- Low UI-15: sub-frame poll can reject unhandled.
- Low UI-16: dead `SKIP_UI_PROTOCOLS`.

### entrypoints/popup
- **Low-Med** UI-18: "Restoring…" never shows.
- Low UI-20: always-from-language toggle shown when it can't fire.
- Low UI-21: language removal bypasses the shared list helpers.

### entrypoints/options
- Low UI-29: Test translation can run before the new key is saved.
- Low UI-30: `App.css` imported twice.
- Low UI-35: source-language overrides filed under "Selection & hover".

### components/bubble
- **Med** UI-42: keystrokes in the bubble trigger the page's shortcuts.
- Low UI-45: can't restore while busy.
- Low UI-46: ArrowDown focuses a disabled button.
- Low UI-47: two timers not cleared on unmount.
- Low UI-48: dead "Restoring…" label.
- Low UI-49: `aria-haspopup` without a menu; stale title.
- Low UI-50: dead `offline` class.
- Low UI-51: stale comment about `sourceLanguageByHost`.
- Low UI-55: copied font stack and spinner CSS.
- Design UI-53: hand-kept listeners and a 200-line `onMount`.

### components/selection and components/hoverTooltip
- **Med** UI-61: Escape after right-click translate doesn't stick.
- **Med** UI-67: keyboard users can't reach the trigger.
- Low UI-62: copy fallback side effects.
- Low UI-64: tooltip sticks after a restore.
- Low UI-66: selection tap targets under 44pt.
- Low UI-68: nested live regions.
- Low UI-69: no `dir="auto"` / `pre-wrap`.

### scripts
- Low PL-28: bundle-size check is Chrome-total only.
- Process PL-31: `Checked on:` gate can't tell a real check from a written line.

### .github
- Low PL-38: unsigned zip left beside the signed .xpi.
- Low PL-41: stale coverage comment in ci.yml.

### Root config and tests
- Low PL-43: `entrypoints/` and `components/` outside coverage.
- Low PL-44: replay set lacks a sangtacviet chapter (needs the owner).
- Low PL-45: stale permission comments in wxt.config.ts.
- Low PL-47: incident-narrative comments left in scripts and config.
