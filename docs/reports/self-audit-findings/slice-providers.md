Files read in full: providers/batchedHttpProvider.ts (816), providers/google.ts (660), providers/outputSanityCheck.ts (248), providers/reflowIntegrity.ts (129), providers/llm.ts (114), providers/descriptors.ts (87), providers/googleCloudTranslate.ts (65), providers/htmlEscape.ts (41), providers/registry.ts (40), translator.ts (114), connectivity.ts (77), networkQuality.ts (43), selection/selectionInfo.ts (65). Cross-checked: translateLoop.ts:745-840,960-1000, titleTranslator.ts:85-130, background.ts:240-270, languages.ts, provider *.test.ts case lists.

## Bugs

- [SEVERITY med][HIGH] google.ts:511-516 — `repair()` re-calls `translator.translateBatch` without forwarding `sourceLanguageIsExplicit`, so line 558 computes `autoDetect = true` for the repair. Trigger: the user picks From = `vi` in the bubble, and a grouped piece reflows (count mismatch, a leaked marker, or `hasBoundaryReflow`). Outcome: the repaired nodes go out with `'auto'`, ignoring the explicit choice. That is the misdetection the picker exists to fix (translator.ts:51-60 says a provider "must honour an explicit choice"). No test covers it.

- [SEVERITY med][HIGH] llm.ts:92-111 — `parseResponse` ignores `pieceCount`, and the LLM path has no count or reflow check (only google.ts has `needsRepair`). Two triggers. (a) The model merges or splits a segment and returns N-1 or N+1 array entries. Every later piece is then shifted one slot, and the result is written to the page as a success; only the trailing piece is "missing". (b) The model drops or moves the `␟` inside a grouped piece (`batchingHint.groupByBlock: true`, descriptors.ts:71). `splitPieceResponse` returns fewer parts, node 0 shows the whole translation, and node 1 is `undefined`, so translateLoop.ts:983-986 `noteMissingResult` re-translates it alone. The page shows the clause twice: the same duplication bug google.ts:466-484 fixed for Google. The sanity check can't catch either case because the text differs from the source. Fix: return `[]` when `parsed.length !== pieceCount`, and add a per-piece part-count check.

- [SEVERITY med][MED] outputSanityCheck.ts:242 — the raw comparison `result.detectedLanguage !== targetLanguage` doesn't normalise regions or aliases. The picker targets are bare (`zh`, `he`, `no`; languages.ts:16-50), while Google's auto-detect reports `zh-CN`/`zh-TW` and legacy `iw` for Hebrew. Trigger: target `zh` (or `he`) on a mixed page with a >40-char paragraph already in that language. Outcome: it is flagged suspicious, retried with the page guess (google.ts:566), still identical, and ends up `'suspicious'`. On a mostly-target-language page this feeds the shared 30-sample window (batchedHttpProvider.ts:371-387). Past 90% it fires `onSuspiciousStreak` → `invalidateAuth()`, and every echo is reclassified as `'network'`, which translateLoop retries indefinitely. Fix: compare `baseLanguageTag(...)` with an `iw→he` alias.

- [SEVERITY med][MED] googleCloudTranslate.ts:46-52 + batchedHttpProvider.ts:753 — batches are capped only by characters, not by segment count. Cloud Translation v2 rejects more than 128 `q` segments per request (HTTP 400; docs limit, not verified live here). Trigger: a nav or facet page with many text nodes under ~15 chars. Up to 2000 content chars per batch gives ~150-300 segments (MAX_PIECES_PER_TICK=300). Outcome: `NonRetryableHttpError` fails the whole sub-batch, and the same pieces re-batch the same way next tick, so the failure repeats. Needs a `maxPiecesPerBatch` option.

- [SEVERITY low][HIGH] google.ts:577-584 — `onPieceComplete` forwards `rawOutcome` unmodified for padded single-string pieces. The padding-overflow merge only happens in the final loop (609-643). Trigger: a padding reflow ("Apple iPhone 15 Pro " / "Max"). Outcome: translateLoop.ts:825-833 first writes the truncated `value[0]`, then the end-of-tick loop overwrites it with the correct text, so the user sees a brief flash of wrong text. This contradicts the guarantee at google.ts:571-576. The existing test (google.test.ts:352) covers grouped pieces only.

- [SEVERITY low][HIGH] google.ts:102-105 + background.ts:254-268 — the auth snapshot is persisted only once, at service-worker startup. Neither `invalidateAuth()` nor later re-scrapes update `storage.session`. Trigger: a 401/403 invalidates key K, then the service worker restarts within 20 min of K's scrape. Outcome: `hydrateAuthKey` restores the known-bad K with its old timestamp. `findAuth` treats it as fresh, so K is resent until another 401 or a 30-sample suspicious streak.

- [SEVERITY low][HIGH] batchedHttpProvider.ts:517-518,526 — when the inherited deadline has already passed before attempt 0 (a repair retry that queued behind the shared gate after a slow parent), the loop exits with `lastError === undefined` and runs `throw undefined`. Outcome: `console.error(..., undefined)`, and a piece that was *suspicious* is reported as generic `'network'` ("no result for this piece"). The `'suspicious'` classification is lost, so translateLoop retries it as an outage.

- [SEVERITY low][HIGH] selectionInfo.ts:63-65 — `text.length >= 2` rejects single-character CJK words (猫, 水, 雨), so no selection trigger appears for a common Chinese/Japanese lookup.

## Risks

- [med][HIGH] google.ts:189 — `(\w{39})` doesn't match `-`, but Google API keys use `[A-Za-z0-9_-]`. A rotated key containing `-` would silently never match, and Prism would run on the hard-coded fallback with `authNotFound = true` (a re-scrape every 5 minutes, always failing).
- [med][MED] llm.ts:85 — `temperature: 0` is always sent. OpenAI reasoning models (o-series, gpt-5 family) reject non-default temperature with HTTP 400, which becomes a non-retryable failure for every piece. Also: `<think>…</think>` preambles from local reasoning models (or any prose before the JSON) make `extractJsonArrayText` (llm.ts:54-58) fail, which fans out into up to N single-piece repair requests (batchedHttpProvider.ts:648) inside the remaining deadline. `finish_reason: 'length'` truncation causes the same storm.
- [low][MED] llm.ts:42 — segments are interpolated raw into `[i]: text` lines. A segment containing newlines or `[5]: …`, or a page-authored "ignore previous instructions", can shift numbering or rewrite output. The output lands as text (node.data), so no XSS, but alignment is page-steerable. Sending the segments as a JSON array would be more robust.
- [low][MED] google.ts:374-376,382 + 361 — `invalidateAuth()` clears the key while sibling sub-batches, retries, and generic repairs are still in flight. They read `translateAuth ?? ''` at send time, so a single 401 or 403 (Google sometimes returns 403 for quota or rate limits) fails the rest of the tick with an empty key.
- [low][LOW] google.ts:275 — the `^<pre…>…</pre>$` match isn't trimmed. A response with trailing whitespace or a newline would leak a literal `<pre>` / `</pre>` as orphan text. For padded pieces, `hasRealOverflow` would append `</pre>` to the visible text, and `RAW_MARKER_LEAK` doesn't cover `pre`.
- [low][LOW] google.ts:328 — repeated indices are joined with an ASCII space, which inserts spurious spaces for CJK/Thai targets when no repair fires (padded or ungrouped pieces).
- [low][HIGH] google.ts:360 — `Content-Type: application/application/json+protobuf` is inherited verbatim from TWP (modules/providers/google.ts:201). It works only because the server is lenient.
- [low][HIGH] googleCloudTranslate.ts:42 — the user's paid API key is sent in the URL query string, where it ends up in proxy and devtools logs. The `X-goog-api-key` header is supported.
- [low][MED] networkQuality.ts:40-41 — the "adaptive" cap can *raise* a configured `maxConcurrent` below 2 or 4 (it returns a hard-coded 2 or 4). It should be `Math.min`.

## Comment/code drift

- batchedHttpProvider.ts:226-230 claims a request's wire size "can never exceed" 6000. The check at 753 runs *after* the piece is appended, so a batch can exceed both budgets by one piece (a 2000-char google group with `&`/`"` escaping alone can exceed 6000).
- batchedHttpProvider.ts:599-606 still refers to `runWithConcurrencyLimit` and "`pump()`'s `inFlight` accounting … only ever counts TOP-LEVEL batches". Both were superseded by `createConcurrencyGate` (286).
- batchedHttpProvider.ts:35 cites "e.g. Yandex". No GET provider exists.
- google.ts:17-20 says titleTranslator "will need a throwaway-second-string workaround". google.ts now pads every caller itself (403-410), and titleTranslator.ts:85-90 removed its own padding.
- translator.ts:43-50: the `dontSortResults` JSDoc is stranded above `sourceLanguageIsExplicit` (51-61), so the field gets two doc blocks and `dontSortResults` (72) gets none. translator.ts:10-11 still names Bing, Yandex, and LibreTranslate.
- descriptors.ts:46-50 describes the repair trigger as only "fewer decoded entries". There are now three signals (count, marker leak, `hasBoundaryReflow`).

## Dead / duplicated code

- `getQueryString` and the `method: 'GET'` branch (batchedHttpProvider.ts:36,395,437) are used only by tests.
- `dontSortResults` mode (google.ts:279-302 plus the plumbing) has no production caller, as google.ts:430-433 admits.
- `ProviderDescriptor.isAvailable` (descriptors.ts:31,83-87) is never set, so `isProviderAvailable` always returns true for known ids.
- The separator escape helpers are copy-pasted in llm.ts:21-38 and googleCloudTranslate.ts:16-26.

## Test gaps

No tests for: repair with an explicit source; an LLM array-length mismatch or a dropped `␟` in a grouped piece; region or alias mismatch on `detectedLanguage` (`zh-CN` vs `zh`, `iw` vs `he`); padded-piece `onPieceComplete` content in the reflow case; a deadline expiring before the first attempt (`throw undefined`); GCT segment-count overflow; the auth regex against a key containing `-`; persistence after `invalidateAuth`.

## Strengths worth keeping

- The backstop `Promise.race` timers on both fetch paths (sendOnce, auth scrape) guarantee that gate permits and `authPromise` always settle.
- One provider-wide concurrency gate, with repairs dispatched rather than awaited, so there is no slot deadlock.
- Deadline inheritance for repairs.
- `readRejectionReason` refuses to show HTML error pages.
- `unescapeHTML` decodes `&amp;` last, so text that was legitimately double-escaped round-trips correctly.
- Translated text is written via `node.data`, so provider or LLM output can't inject markup.
- `hasBoundaryReflow`'s invariants are well bounded: a false positive costs one extra request, never wrong text.
- Separator escaping in the LLM and GCT providers.
