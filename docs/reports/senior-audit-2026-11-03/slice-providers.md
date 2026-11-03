# Slice: providers and engine core (0.3.1)

_Reviewer: outside senior engineer. Read every non-test line of `src/engine/providers/*.ts`, `src/engine/{translator,connectivity,networkQuality}.ts` and `src/engine/selection/selectionInfo.ts`, plus the call sites in `translateLoop.ts:893–1085, 1174–1192` and `background.ts:250–268`. The slice's 152 tests pass. No edits, no network._

**Grade: B−**

## Findings

| Sev | file:line | What's wrong | Failure scenario | Confidence | Status |
|---|---|---|---|---|---|
| Med | outputSanityCheck.ts:237 (pinned by outputSanityCheck.test.ts:74) | The ≤40-char length gate runs before the `detectedLanguage` check. Now that Google gets `'auto'` and returns a detected language for each piece, the gate throws away the one signal that catches short Latin-script echoes | Vietnamese→English chapter: Google echoes short dialogue lines unchanged with `detected='vi'`. Every line ≤40 chars is accepted, and the streak detector (batchedHttpProvider.ts:384–400) never fires, so the page says translated but nothing changed. Trade-off: Sino-Vietnamese names kept as-is would cost extra retries | reasoned | NEW |
| Med | google.ts:543–548 (flag read at :590) | `repair()` re-enters `translateBatch` without `sourceLanguageIsExplicit`, so `autoDetect` becomes true. `sourceLanguage` is passed; the explicit flag is dropped | The user sets From = zh in the bubble, a grouped piece reflows, and its repaired nodes are sent as `'auto'` | read-verified | KNOWN |
| Med-Low | batchedHttpProvider.ts:678–686; google.ts:395–398 | Only `NonRetryableHttpError` keeps its cause. Exhausted 429/5xx retries, timeouts, and a response the unchecked `as [string[], …]` cast can't read (`texts.map` throws) all become "no result", shown as "Couldn't reach the translation service" (translateLoop.ts:1178) | Google changes the response shape, the likeliest way a scraped endpoint breaks, or rate-limits the IP. The bubble says the network is down and retries forever | read-verified | NEW |
| Low-Med | google.ts:495 | `needsRepair` returns false for padded single-string pieces, the most common shape, before the `RAW_MARKER_LEAK` check | Google breaks one tag in `<a i=0>…<b>…</a><a i=1> </a>`. The raw markup becomes leading orphan text (google.ts:356–360) and `hasRealOverflow` (:673) writes literal `<a i=0>…` onto the page | reasoned | NEW |
| Low | google.ts:609–617 | The incremental `onPieceComplete` path forwards a padded piece's raw `value[0]`, skipping the overflow join (:671–674) | The page briefly shows "…Pro " until the end-of-tick rewrite (translateLoop.ts:1072–1082). Breaks the "never flash intermediate" promise (:600–608) | read-verified | KNOWN |
| Low | batchedHttpProvider.ts:540, 664–676 | `throw lastError` can throw `undefined`. Repairs inherit the parent's deadline, which keeps running while they wait in the shared gate | On a long page a queued repair is dead on arrival, and a suspicious piece is reported and retried as a network failure | read-verified | KNOWN |
| Low | batchedHttpProvider.ts:668 | The suspicious-retry fallback overrides an explicit source with `'auto'`; when the source is already `'auto'` it resends the identical request | From = vi is ignored on retry; on `'auto'` pages every suspicious retry is wasted | read-verified | NEW |
| Low | google.ts:102–105, 393 | `invalidateAuth()` nulls the key while sibling batches are queued; they send `translateAuth ?? ''` | One 403 or streak sends the rest of the tick with an empty key, and all of it fails | read-verified | KNOWN |
| Low | background.ts:262–265 + google.ts:75–85 | The key snapshot is saved only at service-worker startup | A restart within 20 min rehydrates a dead key; one tick fails before re-scrape | read-verified | KNOWN |
| Low | batchedHttpProvider.ts:734–757, 684–686 | `resolveFn` isn't idempotent; a throw midway through `forEach` re-resolves pieces that already succeeded | Skews the suspicious window, not the text | reasoned | NEW |
| Low | selectionInfo.ts:64 | `text.length >= 2` | Selecting a single hanzi (龙, 剑) shows no translate trigger | read-verified | KNOWN |
| Low | google.ts:307 | The `^<pre…>…</pre>$` match isn't trimmed | A trailing newline leaks `</pre>` as overflow text | reasoned | KNOWN |
| Low | google.ts:360 | Repeated indices joined with an ASCII space | Spurious spaces in zh/ja output (not the owner's en/vi targets) | read-verified | KNOWN |
| Low | batchedHttpProvider.ts:772–783 | Budgets checked after the piece is appended | A batch can exceed the 6000-char wire ceiling (:240) by one piece | read-verified | KNOWN |
| Low | google.ts:392 | `application/application/json+protobuf` | Works only because Google tolerates it | read-verified | KNOWN |

## Previously known, now fixed
- Language comparisons use `baseLanguageTag` (outputSanityCheck.ts:243, 249).
- The key regex is `[\w-]{39}` (google.ts:221).
- Google Cloud has a 128-segment cap and sends its key in a header (googleCloudTranslate.ts:45, :57).
- A count mismatch is treated as all-missing (batchedHttpProvider.ts:576).
- All LLM findings are moot: the provider was removed.

## Techniques and design
- **Praise:** the engine is pure (CI-enforced), with a small `Translator` port, `Result` types and a shared batching base. The concurrency gate dispatches repairs instead of awaiting them, so there's no deadlock. Deadlines are inherited, and `Promise.race` backstops make permits and `authPromise` settle even on WebKit. `reflowIntegrity.ts` is the best file: structural invariants, where a false positive costs one request, never wrong text.
- **Comments are about 50% of the code** (google.ts 354/692 lines, batchedHttpProvider.ts 422/841). They are mostly incident history, and they've drifted: they mention `runWithConcurrencyLimit`, Yandex, the LLM, a titleTranslator note, and leave a stranded JSDoc (translator.ts:43–51).
- **Errors are passed as strings and re-parsed with regex** in three places (google.ts:118, translateLoop.ts:1175–1185, the `failureMessages` WeakMap). The `'http'` kind is never produced. A structured `{kind, status, reason, cause}` would end the "couldn't reach" mislabels.
- **Auth state lives in module-level globals** (google.ts:23–26), with no stale-while-revalidate. The scrape URL is a pinned bundle with no `response.ok` check and no log on a miss. Re-scraping usually returns the same public key, so the "self-heal" is mostly theatre.
- **Heuristics are stacked as patches:** padding, grouping, three repair signals, the sanity check, streak reclassification and suspicious-retry language switching. Each is defensible; together they're hard to reason about.
- **Retry design is reasonable:** three attempts, jitter, Retry-After capped at 6 s, a 30 s deadline, 4xx not retried. Gaps: JSON parse errors are retried; an HTTP-date Retry-After is ignored.
- **Dead code:** `getQueryString` and the GET branch, the `dontSortResults` mode (google.ts:311–334), `ProviderDescriptor.isAvailable`, the `'http'` kind, `ProviderConfig.google`, and networkQuality.ts:40–41.

## Test quality
- 152 fast, deterministic tests named after real incidents; their regression value is high.
- Mocks encode the *assumed* Google wire format, with no recorded responses in this slice, and module-level auth state leaks between tests.
- Gaps: repair with an explicit source; a padded piece's `onPieceComplete` during reflow; a deadline expiring before the first attempt; a malformed response; a padded piece with a leaked marker. One test (outputSanityCheck.test.ts:74) locks in finding 1.

## Verdict
Better than expected from an AI-directed amateur project. The hard problems (scraping an undocumented endpoint, Google reflowing text across markers, WebKit fetches that never settle) were each met with real, mostly correct engineering, and the module boundaries are clean. The weaknesses come from how it was built: each incident added a heuristic and an essay of a comment instead of a simpler model. Error causes are carried as strings and get mislabeled, and stale comments are a maintenance hazard. No high-severity bug. The remaining risk to daily reading is that short Latin-script Vietnamese echoes are still waved through.
