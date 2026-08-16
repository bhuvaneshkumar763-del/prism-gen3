---
name: post-launch-audit-correctness-speed-accuracy-reliability
description: Two-part post-launch audit pass — a whole-codebase correctness
---

# Post-launch audit: correctness, speed, accuracy, reliability

Two-part post-launch audit pass — a whole-codebase correctness review, then a
wider line-by-line sweep of all 117 source files focused on the free `google`
provider, speed, and reliability. Not triggered by a single user report like
the other post-launch sections above; asked for directly as a proactive
health check. Every fix below shipped with a regression test proven to fail
without the fix (verified by literally reverting the fix and re-running the
test) — the same rigor `check-solid-reactivity.mjs`'s own history argues for
below.

## Part 1: whole-codebase correctness review

An 8-angle review (correctness × 3, reuse/simplification/efficiency,
altitude, conventions) plus a dedicated test-suite audit, run via parallel
subagents and cross-verified. Findings, all fixed:

- **`htmlEscape.ts`'s `unescapeHTML` decoded entities in the wrong order** —
  `&amp;` was decoded first, so text that legitimately contained
  entity-like prose (a tutorial page's literal `&lt;br&gt;`) got corrupted
  into `<br>` on the round trip. Fixed by decoding `&amp;` last.
- **`resweep.ts`'s `stop()` never removed the `scroll`/`popstate` listeners
  `start()` registered** — every translate→restore→translate cycle (an
  ordinary language-change workflow) leaked one more listener pair on
  `window` for the tab's lifetime.
- **`translateLoop.ts`'s `nodesToRestore` grew without bound** — every node
  discovered while a page stayed translated was added and never removed,
  even after leaving the DOM; a long-lived SPA session (infinite scroll,
  chat) leaked a strong reference to every detached node it ever
  translated.
- **`translateLoop.ts`'s `missingResultAttempts` was a lifetime cap, not a
  per-episode one** — never reset after a successful translation, so a node
  that hit 3 non-consecutive transient failures over a session silently
  stopped being retranslated forever.
- **`backup.ts`'s `parseBackup` had no legacy-provider remap** — importing a
  settings backup exported before the `builtin`/`libretranslate` provider
  removals rejected the entire file, even though the equivalent
  stored-config load path (`migrations.ts`) already handled this.
- **`mountSelectionPopup.ts` had no request-generation guard** — a slower,
  earlier translation request could resolve after a newer one and overwrite
  the currently-displayed selection's translation with stale text.
- **`titleTranslator.ts` swallowed `ok:false` batch outcomes silently, with
  no backoff** — unlike `translateLoop.ts`'s hardened failure handling for
  the identical class of bug (see "Post-launch incident" above), a broken
  provider left the tab title silently re-requesting every fixed 1500ms
  forever, with no error surfaced.
- **`translationCache.ts`'s `ensureRunningTotal` had a cold-start race** —
  concurrent calls (a `Promise.all` batch of cache misses) could each
  independently scan and overwrite the running-total counter.

Plus reuse/simplification/efficiency fixes: a shared `createShadowHost()`
helper (`src/shared/ui/shadowHost.ts`) replacing three copies of hand-rolled
shadow-DOM bootstrap code; `popup/App.tsx` reusing `tabTarget.ts`'s new
`getActiveTab()` instead of hand-rolling `browser.tabs.query`;
`mutationWatcher.ts`'s O(n²) array-`includes` dedupe replaced with a `Set`;
`configStore.ts`'s `applyValidatedConfig` batched into one `backend.set()`
call.

**Also fixed, not part of the codebase review**: `.claude/hooks/pre-read.sh`
(added in the immediately-prior commit) printed its file-summary output to
stdout instead of stderr when blocking a Read — the harness only surfaces
stderr as a PreToolUse block reason, so every blocked large-file read showed
a useless "No stderr output" instead of the actual summary, breaking the
`agora-code` skill's own core workflow. Fixed by matching `pre-agent.sh`'s
existing `sys.stderr.write()` convention.

## Part 2: wide audit — Google-path focus

Asked for again, wider this time ("check more widely line by line"), with an
explicit follow-up scope: focus on the `google` (free) provider; note LLM
provider issues rather than fix them (not in active use). All 117 source
files (12,604 lines) were partitioned across eight line-by-line subagent
reviews plus a manual pass over the manifest, `tsconfig`, CI, and
dependencies — every finding re-verified by reading the code directly before
acting on it, and one partition that initially failed on a session limit was
re-read by hand rather than left uncovered.

**Google-path correctness** (`src/engine/providers/google.ts`,
`batchedHttpProvider.ts`):
- The "provider echoed the original back untranslated" safety net
  (`isSuspiciousOutcome`) was comparing the wire-format-wrapped request
  against the unwrapped response — since Google's `transformPiece` always
  wraps in `<pre>...</pre>` while real responses come back unwrapped, the
  comparison could never match. The check was silently inert for Google
  specifically, the provider most likely to sit behind a proxy that echoes.
  Fixed by comparing the decoded, post-split result instead.
- Untagged (orphan) text arriving *before* the first `<a i=N>` tag in a
  response was dropped outright — Google prepends punctuation for some
  target languages (Spanish `¿`/`¡`), so this could silently drop the
  opening character of a translated sentence.
- A `dontSortResults: true` request for a single-string piece (the normal
  shape, since markers only appear for >1-string pieces) returned `[]` as a
  *successful* outcome, silently losing the translation. Unreachable today
  (no caller sets the flag) but fully wired and already test-exercised.
- The auth-key refresh backoff's three tiers (1min/5min/20min) had two
  unreachable branches due to a check-order bug, so a failed key scrape
  always waited the full 20 minutes instead of retrying after 5.
- A tokenizer miss (an inline tag Google was never observed to emit, per
  this file's own header comment) would have spliced raw `<a i=0>...`
  markup into the page as visible text; now treated as a failed parse
  instead.

**Engine correctness affecting the Google path**
(`translateLoop.ts`,`collectTextNodes.ts`, `titleTranslator.ts`):
- `restorePage()` could restore *stale* text — `nodesToRestore` was only
  ever updated when a node was first queued, not when its content later
  legitimately changed (a live score, an edited comment), so "show
  original" could silently discard newer page content.
- No generation guard on `translationRoutine()` — a slow response from an
  abandoned cycle (switch target language mid-translation) could overwrite
  a newer translation while state still reported the newer language.
  Same pattern applied to `mountSelectionPopup.ts` in Part 1.
- `<pre>`/`<code>` were translated (breaking code samples), and neither
  `translate="no"` nor `.notranslate` — the standard cross-tool opt-out
  signals — were honored anywhere.
- A node disconnected while its translation was in flight had its result
  correctly dropped, but stayed marked as "seen" with its old content, so
  reattaching it unchanged never retriggered translation.
- `surfacedErrorStreak` (drives the 8s→30s error backoff) wasn't reset by
  `restorePage()`, so a fresh translate attempt after a restore could
  inherit a near-30s backoff instead of starting fresh at 8s.
- **My own regression, caught and fixed in the same pass**: the
  self-rescheduling poll timer I introduced in `titleTranslator.ts` during
  Part 1 could resurrect itself after `stopWatching()` if a request was
  still in flight when it ran — clearing the timer happened first, the
  re-arm happened after, leaving a zombie timer ticking harmlessly forever.
  Fixed with a generation counter, same pattern as the translateLoop fix
  above.
- Language-code comparisons (`autoTranslateDecision.ts`) were exact-string,
  so a regional variant (`pt-BR`) neither matched its base language as a
  target (translating Portuguese into Portuguese) nor matched a
  base-language never/always rule. Fixed via a shared `baseLanguageTag()`
  helper in `src/shared/languages.ts`.
- `connectivity.ts` registered its `online`/`offline` listeners on `window`,
  which doesn't exist in an MV3 service worker (it has `self`) — silently
  inert in the background realm. Fixed via `globalThis`. The module's own
  header comment also claimed the provider and the translate loop "need to
  agree on the same online/offline state," which doesn't hold — they run in
  different realms (background worker vs. content script) and were already
  separate instances; comment corrected.
- `selectionInfo.ts` anchored to only the first range of a multi-range
  selection while the displayed text already covered every range — fixed by
  unioning every range's rect.

**Reliability**:
- `configStore.onReady()` cached a *rejected* promise — a rejected promise
  is still truthy, so one transient storage failure during first load
  wedged every future `onReady()` call in that context permanently
  (including the store's own diagnostics tool). Fixed by clearing the
  cached promise on rejection so the next call retries.
- `translationCache.ts`'s `set()`/`evictUntilUnderBudget()` credited/
  decremented the byte-budget counter before the underlying write/delete
  was confirmed committed — a failed write (quota exceeded) could drift the
  counter from reality, causing valid entries to be evicted for room that
  was never actually needed. Fixed by moving both onto `tx.oncomplete`.
- `background.ts` constructed a fresh provider (and its
  `maxConcurrent`/in-flight-dedupe state) on every single message instead
  of once per worker lifetime — three tabs translating concurrently could
  fire up to 3× the intended concurrent request count at whichever provider
  was active. Worst for the free Google endpoint this pass focused on.
  Fixed by memoizing per worker lifetime, keyed on provider + config
  fingerprint.
- `background.ts` registered its context menus unconditionally at the top
  of `main()` — an MV3 service worker re-executes `main()` on every wake
  from suspension, but menu items persist independently, so every wake
  after the first successful install failed on a duplicate ID. Fixed by
  moving registration into `runtime.onInstalled`.
- An unguarded `JSON.parse` on a cached value could fail a whole
  `translatePieces` batch, contradicting the function's own stated
  invariant three lines above it.
- `configMutations.ts`'s `applyListPatch` issued one storage write per
  patched key instead of one combined write — a failure partway through a
  cross-list patch (moving a site from never- to always-translate) could
  land only one of the two writes, leaving a site on both lists at once.
  Fixed via a new `configStore.setMany()`.
- `batchedHttpProvider.ts`'s retry sequence had no overall deadline —
  `REQUEST_TIMEOUT_MS`(20s) × `MAX_ATTEMPTS`(3) plus inter-attempt delays
  was a ~62s worst case for a merely-slow (not down) provider, with
  `translationRoutine` awaiting it synchronously. Bounded to an overall
  30s budget; the first attempt still gets a real shot, later attempts get
  whatever's left.

**Speed**:
- `translationCache.get()`/`set()` opened one IndexedDB transaction per
  cache key — a tick with ~40 pieces paid for ~40 read transactions and up
  to ~80 write transactions. Added `getMany()`/`setMany()`, one transaction
  each; `get`/`set` now call through them.
- `background.ts`'s outcome-reconstruction used `missingIndices.indexOf(i)`
  inside a `.map()` — O(n²) on a cold/disabled cache. Fixed with a `Map`
  built once.
- `prioritizeByViewport` re-measured every queued node's position on every
  tick regardless of whether anything had changed since the last reorder —
  a long page paid for thousands of forced `getBoundingClientRect()` layout
  reads, repeated every ~150ms. Fixed with a dirty flag, set on scroll (via
  a new `onViewportChanged` callback on `resweep.ts`'s existing debounced
  scroll listener — not a second listener) or on newly-queued nodes, and
  cleared after a reorder actually runs. Also switched from partitioning by
  immediate parent to partitioning by nearest block ancestor (reusing
  `grouping.ts`'s `nearestBlockAncestor`, now exported) — this both
  measures one rect per block instead of per text node, and keeps a
  paragraph's own sibling nodes contiguous across the partition instead of
  letting an inline element split them apart with unrelated content
  interleaved between them.

**UI correctness and accessibility**:
- Site-list rules (`listMutations.ts`) were matched by exact string against
  `location.hostname` (always lowercase, no scheme) while the options page
  only trimmed whitespace — typing `BBC.com` or pasting `https://bbc.com/`
  created a rule that silently never fired, while still displaying as
  active. Fixed with a new `normalizeHostname()`.
- `StringListEditor.tsx` never split on comma/newline despite the options
  page's own hint text promising "one per line (or comma-separated)" — a
  pasted list became one dead entry.
- `entrypoints/popup/App.tsx` never called `getPageError` on mount (only
  after a translate click), so opening the popup for a tab already
  mid-error showed a plain "Translated" state contradicting the on-page
  bubble's error banner for the same tab.
- `options/App.tsx` had zero error handling in 541 lines — every storage
  write (`setField`, import, restore-defaults, clear-cache) updated the UI
  optimistically with no rollback and no visible failure state. Added a
  dismissible error banner and rollback-on-failure for `setField`.
- The hover tooltip's documented "follows the cursor while visible" was
  dead code — `showTimer` was cleared on hide/retarget but never by its own
  callback firing, so the cursor-follow guard (`!showTimer`) was
  permanently false after the very first tooltip shown.
- The bubble's ball button had no busy guard beyond a fixed 600ms local
  debounce — far shorter than a real translation — while the panel's
  primary button correctly disables on `props.state.busy`. Deliberately NOT
  given a native `disabled` attribute (that would also block the
  `pointerdown`/`pointermove`/`pointerup` drag handlers the same element
  uses); instead `toggleTranslate()` now also checks `props.state.busy`.
- `bubblePosition.ts`'s `resolveDockedPoint` clamped `y` to the viewport but
  never `x` — on a viewport narrower than `ballSize + 6` (an embedded
  iframe, a heavily split window), the right-docked ball's `x` went
  negative with no self-correction.

Real bugs found but left unfixed on purpose (see "Known gaps" above for the
full writeup): the LLM provider's several gaps (per the user's explicit
"note them, don't fix them" direction), and select-to-translate not
reaching shadow-DOM content plus the bubble panel's keyboard-unreachability
(both real, both scoped out for now as needing more than a guard-script-sized
change).

## Part 3: the guards and tests themselves

- `migrations.test.ts` had a genuinely vacuous test — it built a local
  `fakeMigrations` array and asserted against its own inline
  sort/reduce reimplementation, never actually calling
  `applyConfigMigrations`. A real bug in that function's ordering logic
  would have passed silently. Fixed by making `applyConfigMigrations`
  accept an injectable migrations list (defaulting to the real one) and
  rewriting the test to call it directly.
- `check-solid-reactivity.mjs`'s regex required the JSX-closing `>`/`=` and
  the `{` on the same line, so it missed this codebase's actually-dominant
  multi-line-child JSX style entirely (`>\n  {configStore.get(...)}\n`) —
  exactly the bug class the guard exists to catch, per its own header
  comment about three prior incidents. The first fix attempt (letting the
  gap span the whole file via an unbounded `[^}]*`) introduced a worse
  problem — a regex can't track nested-brace depth, so it bridged clean
  across unrelated code to a distant, legitimately-imperative
  `configStore.get()` call and false-positived. Landed on a bounded gap
  (`{0,80}` chars) plus excluding `=>` (arrow functions) specifically from
  the `>` match, verified against three synthetic cases (same-line
  attribute, multi-line child, and a legitimate reactive signal read) plus
  a clean run against the real codebase.
- `check-engine-purity.mjs` had two independent gaps: its per-line
  comment-stripper used a naive `line.indexOf('/*')`, so a literal `/*`
  sequence inside a string or regex literal (not an actual comment) could
  desync `inBlockComment` and silently disable the rest of the file's check
  — rewritten as a string-aware character scan. Its bare-global pattern was
  a fixed, unmaintained namespace allowlist (`storage`/`tabs`/`runtime`/...)
  that a new, entirely foreseeable API (`chrome.windows`, `.notifications`)
  would pass straight through — broadened to match any property access on
  `chrome`/`browser` rather than trying to keep a list in sync with
  Chrome's own growing API surface. Both fixes verified with synthetic
  reproductions of the exact scenarios that motivated them, plus a clean
  run against the real codebase (zero new false positives).

## Verification

Every fix in this pass has a dedicated regression test, and every one of
those tests was proven non-vacuous by reverting the fix and confirming the
test actually fails — not just written and trusted. Full gate run
repeatedly through the pass: `npm run compile && npm run lint && npm test
&& npm run test:coverage && npm run guard:engine-purity && npm run
guard:solid-reactivity && npm run build && npm run guard:bundle-size &&
npm run test:e2e` — all green, coverage gate held throughout.
