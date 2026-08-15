---
name: post-launch-pass-speed-dynamic-content-correctness-tag-cluster-accuracy
description: A separate pass from the UI-depth work above, prompted by a real user
---

# Post-launch pass: speed, dynamic-content correctness, tag-cluster accuracy

A separate pass from the UI-depth work above, prompted by a real user
report: the extension felt noticeably slower than the pre-rewrite fork,
struggled with slowly-loading/constantly-loading pages (translates the
page but content that loads later doesn't reliably get caught), and
mistranslated tag-like tokens (their example: `#go#be`) instead of
recognizing them as tags — a complaint that predates this rewrite
entirely.

**Investigation, not guesswork**: three parallel deep-dives confirmed the
core translate loop, resweep backoff, and provider retry/batch constants
are an essentially byte-for-byte port of the fork — not the source of the
speed gap. Two real regressions were the actual cause (below). For the tag
complaint, exhaustive grep confirmed **neither this repo nor the Gen 2 TWP
rewrite has any tag-recognition logic at all** — but the *original*
pre-rewrite vanilla-JS codebase (a zip the user had archived, distinct
from the Gen 2 TWP repo, with commits made *after* the Gen 2 fork point)
turned out to have real, three-round-debugged logic for exactly this. This
distinction matters: **if you go looking for "the fork's tag logic" in the
TWP Gen 2 repo, you will not find it** — it only ever existed in that
separate, later-updated original-fork archive.

### Speed

- **`src/platform/cache/translationCache.ts`**: used to open and close a
  fresh IndexedDB connection on *every* `get()`/`set()` call, and `set()`
  unconditionally ran a full cursor-scan eviction sweep on *every write* —
  on the critical path of every translated piece, every tick, cache
  enabled by default. With `MAX_PIECES_PER_TICK = 100`, a first-time page
  translation could do up to 100 concurrent IDB opens for reads, then 100
  more opens + 100 full cursor scans for writes, per tick. Fixed: the
  connection now opens once, lazily, and is reused for the life of the
  cache instance. Eviction no longer re-scans the store — an in-memory
  running-total byte count is seeded once (lazily, from a real scan, the
  first time any method is called — needed to account for whatever's
  already persisted from a prior service-worker lifetime) and then kept
  accurate incrementally on every write/eviction, so `evictUntilUnderBudget`
  is an O(1) check in the common case instead of an O(store size) scan.
  Deliberately did **not** implement the "gate the on-hit `lastUsed`
  touch-write behind a staleness check" idea from the original plan
  sketch — the existing recency-eviction test operates on a 5ms timescale,
  and a staleness gate (the fork's own 6h cutoff) would have broken that
  test's real, deliberate behavior for a marginal I/O saving the
  connection-reuse fix already captures the bulk of. **Verified for real**:
  a Playwright round trip against the built extension confirms
  `indexedDB.open` is called at most once across a whole real translate.
- **`entrypoints/content.ts`**: had no explicit `runAt`, defaulting to
  `document_idle` (~page `load`) — the fork explicitly uses `document_end`
  (fires right after DOM parsing, before subresources finish). Added
  `runAt: 'document_end'`, matching the fork — starts config load, the
  auto-translate decision, and mutation-observer attachment meaningfully
  earlier on pages with slow images/ads/trackers, exactly the "slowly
  loading pages" case reported. Confirmed in the built manifest.json.
- **`src/platform/configStore.ts`**: `migrateIfNeeded()` and `initConfig()`
  each did their own full `browser.storage.local.get(null)` — two round
  trips on every fresh content-script load and background service-worker
  wake, even when no migration ran (the common case).
  `applyConfigMigrations()` already returns the complete post-migration key
  set, not a patch, so `migrateIfNeeded()` now returns the snapshot it
  already fetched (post-migration if one ran, the original otherwise) for
  `initConfig()` to reuse directly. One storage read instead of two,
  verified by a real `indexedDB.open`-style spy-count test.
- **`src/engine/pageTranslator/mutationWatcher.ts`**: the periodic
  interval driving `resweep.bump()` (previously every 500ms,
  *unconditionally*) forced resweep's own full-`document.body` re-walk to
  run every ~500-750ms indefinitely on any translated+visible page — its
  documented backoff toward `RESWEEP_MAX_MS = 10000` on a static page could
  never actually engage, since `bump()`'s 250ms timer always beat
  `resweep.run()`'s own ≥1500ms backoff schedule. Real, continuous CPU cost
  that scales with page size — worst exactly on "constantly loading" pages
  (large, growing DOM). Fixed: the periodic tick now only calls
  `resweep.bump()` when the MutationObserver has been silent since the
  last check (a `mutatedSinceLastCheck` flag, reset each interval) — if
  the observer is firing normally (the common case), resweep's own
  schedule and real backoff govern cadence instead of being overridden
  every tick. The observer-silent case (mutations resweep exists to
  catch — inside a shadow root, or a subtree built detached and
  reattached) still bumps every interval exactly as before, so the
  backstop's actual purpose is unaffected.
- **Considered and deliberately NOT done**: skipping
  `originalLanguageTracker.ts`'s unconditional 150ms sleep when the tab is
  already visible. On reflection the sleep isn't really about visibility —
  it gives the page's own script a moment to populate `document.body
  .innerText` before language detection samples it, which visibility
  doesn't guarantee. Removing it, especially now that `content.ts` attaches
  earlier via `document_end` (less content settled at attach time than
  before), risked reducing detection accuracy on exactly the modern SPA
  pages this whole pass is meant to help. Not worth the risk for a
  150ms, one-time-per-load saving.

### Dynamic/slowly-loading page correctness

- **`src/engine/pageTranslator/mutationWatcher.ts`**: `MAX_CHANGED_NODES
  _PER_TICK = 25` silently dropped any `characterData` change past the
  25th distinct node in one MutationObserver callback — a real
  content-loss bug (not just delay) for a chat/dashboard app re-rendering
  30+ live rows in one synchronous batch, since dropped nodes are
  already-tracked identities that neither the resweep backstop nor
  `dedupe.ts` could ever rescue afterward. Removed — recording a changed
  node is cheap (an array push, then a `queue.push` in
  `requeueChangedTextNode`), so there's no real cost to processing a whole
  batch; the actual translate-request rate stays governed separately by
  `MAX_PIECES_PER_TICK` in `translateLoop.ts`, untouched.
- **`src/engine/pageTranslator/translateLoop.ts`**: a text node that's
  tracked, detached, has its `.data` changed *while off-DOM* (a
  disconnected node generates no mutation record at all — per spec, only
  nodes connected to the observed subtree are reported), and later
  reattached with the new content already set, used to be silently skipped
  **forever** — `queueNode()`'s `dedupe.isTracked(node)` check was still
  `true` from before detachment (the `WeakSet` entry survives as long as
  anything, e.g. a virtualized-list node pool, holds a live reference).
  This is the concrete mechanism behind "translates the page but some text
  loads later" on feed/chat-style UIs that recycle DOM nodes. Fixed: a new
  `lastSeenText: WeakMap<Text, string>` (in `translateLoop.ts`, not
  `dedupe.ts` — this is about *content* identity, a different concern than
  what `dedupe.ts` owns) tracks the last content this engine actually
  processed for each node, updated on every queue/requeue and every
  successful translation write. A new `queueOrRequeueIfChanged()` (used by
  both `onNewRoot` and `onResweep`'s node collection, replacing a bare
  `queueNode()` call) treats a reappearing already-tracked node whose
  current content no longer matches `lastSeenText` as a real change and
  requeues it, instead of silently ignoring it. New nodes (the overwhelming
  common case) are unaffected. Verified with two new tests: one confirming
  a detach→mutate-while-off-DOM→reattach node *does* get (re)translated,
  and a negative test confirming a detach→reattach-with-unchanged-content
  node does *not* trigger a spurious extra translate request.
- **Visibility-based pause/resume** (mutation observer fully disabled
  while `document.visibilityState !== 'visible'`, resumed + backstopped
  within ~250ms of regaining visibility): verified unchanged, still
  intentional, matches the fork. No code change.

### Tag-cluster translation accuracy

Ported from the *original* pre-rewrite vanilla-JS codebase's
`contentScript/pageTranslator.js` (`getPiecesToTranslate()`'s
`isStandaloneTagAnchor`) — three real bug-fix rounds against live traffic
went into the exact token pattern (`TAG_TOKEN`/`PURE_TAGS_RE`) this was
ported from, not reinvented: the boundary charset was widened for
real-world tags (`#sci-fi`, `#C++`, `#anime_2024`), and CJK-aware
delimiters were added for multi-tag clusters written in one text run
(`#动作，#冒险`).

Tracing this codebase's own provider wire formats confirmed the *exact*
mechanism the fork's fix addresses: Google's `translate-pa` endpoint can
reorder/merge the `<a i=N>` index markers it uses to map translated
fragments back to source pieces when several short tag tokens sit
together in one **multi-string piece** (`google.ts`'s
`transformPiece`) — but pieces themselves never cross-contaminate (Google's
response is array-indexed positionally per piece; the LLM provider's
numbered-segment prompt already separates pieces cleanly). So the fix is a
**grouping/piece-boundary** fix, not a find/replace or
placeholder-substitution one.

- **New `src/engine/pageTranslator/tagText.ts`**: `isPureTagText(text)` —
  true if the *entire* (already-trimmed) string is one or more `#tag`/
  `@mention` tokens with no other content, matching on `^...$` so a tag
  embedded inside real prose (a footnote marker like "#1" mid-sentence) is
  correctly left alone.
- **`src/engine/pageTranslator/grouping.ts`**: `groupNodesForBatching` now
  isolates any node whose trimmed content is pure tag text into its own
  singleton group — flushed before and after, nothing else can join it.
  A size-1 piece never triggers Google's `<a i=N>` wrapping
  (`transformPiece`'s `if (arr.length > 1)` guard) or the LLM provider's
  `␟`-join (`llm.ts`) — structurally nothing left to scramble. Only
  changes behavior when `hint.groupByBlock` is true (`google`/`llm`
  today); providers without a `batchingHint` already send one node per
  piece, already isolated, unaffected.
- **Explicitly out of scope**: the fork's later refinement round
  (isolating short standalone links and nav-row/chapter-title clusters,
  with real DOM-sibling prose-vs-non-prose awareness) needs tree-walk
  context this engine's flat `Text[]` grouping pipeline doesn't have.
  Attempting a partial port risked exactly the over-eager-isolation
  regression the fork's own later round had to correct in the other
  direction. Documented as a clear follow-up, not built here.
- **Verified for real** against the built extension (mock OpenAI-compatible
  LLM server, real Playwright translate round trip): a paragraph
  containing `check out #go#be for updates` translates its prose while
  `#go#be` survives byte-for-byte in the output, and inspecting the actual
  request the mock server received confirms the tag was sent as its own
  isolated numbered segment, never merged with the surrounding sentence.

### Full verification

`compile`, `lint` (0 errors), both CI guards, `test:coverage` (all new
pure logic — `tagText.ts`, `grouping.ts`'s isolation branch,
`translateLoop.ts`'s reattach-gap fix, `mutationWatcher.ts`'s bump-gating,
`translationCache.ts`'s connection reuse — lands in coverage-gated paths,
verified per-file, not just the aggregate, per this repo's own established
"check per-file" lesson from a prior incident), `build` ×2 browsers,
`guard:bundle-size`, `test:e2e`, `npm audit` — all clean. Plus a combined
real-browser Playwright check covering all three areas at once against the
actual built extension: tag isolation (above), a continuously-appending
"chat" test page confirming content added well after the initial translate
still gets translated, and an IndexedDB open-count assertion for the cache
fix.
