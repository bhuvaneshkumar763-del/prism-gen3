# Working on this repo — read this first

This is **Prism, Gen 3** — a ground-up rewrite of a browser extension that
translates web pages in place. It is a **brand-new repository**, not a
continuation of the old one at `/Users/jb/Downloads/TWP`.

**Read the plan file first, always**:
`/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md` (the
section titled "Prism Gen 3 — ground-up rewrite in a new repository" at
the top — the rest of that file is the old repo's superseded history, kept
for reference). It has the full session-by-session breakdown, the context
for why this rewrite exists, and every "keep vs. diverge" decision already
made. **Read that file's session map before starting any Gen 3 work** — it
tells you exactly which session you're in and what it depends on.

## Why this repo exists (short version)

The old repo (two rewrites deep already) still has real lineage from the
original fork it started as — not in its product, but in its code: a
config store literally named `twpConfig`, `fp*`-prefixed storage keys,
`twp-fp-bubble`-named custom elements, and a couple of legacy-key shims.
Renaming those wouldn't fix the underlying problem. Gen 3 is a genuine
from-scratch remake: new repo, new naming, new architecture — designed to
extend cleanly for years, not just replicate today's feature list under a
new name. **The old repo is reference-only** — read it for lessons learned
(it has an extensive, hard-won incident history documented in its own
`CLAUDE.md`), never build on top of it or copy code from it.

## The old repo's inventory (what Gen 3 needs to not silently drop)

A full audit of the old repo — every user-facing feature (25), every
translation provider and its real quirks (7), the page-translation engine's
module boundaries, the config/messaging architecture, every documented
"gotcha," test coverage gaps, dependencies, and CI/release infra — was done
to scope this plan. It's summarized in the plan file's session breakdown;
the old repo's own `CLAUDE.md` has the full incident-by-incident narrative
behind each gotcha if you need more depth than the summary gives.

## Repo structure (established Session 1)

```
entrypoints/         WXT entrypoints — one per browser-visible surface.
                      This IS the "extension" layer — browser/WXT-specific
                      code lives here, nowhere else.
src/
  engine/            The core translation engine. ZERO chrome/browser API
                      imports allowed — enforced by CI
                      (npm run guard:engine-purity, see
                      scripts/check-engine-purity.mjs). See its own
                      README.md for the full boundary rule.
  platform/           Browser-API adapter boundary — implements the ports
                      src/engine/ defines, using real chrome/browser APIs.
                      The seam a future non-extension surface would
                      replace. See its own README.md.
  shared/             Types/schemas usable by both engine and
                      entrypoints/platform. Same zero-chrome/browser rule
                      as src/engine/ (it's transitively depended on by the
                      engine).
docs/
  decisions/          ADRs (0001-framework.md, 0002-ui-library.md, ...) —
                      one per non-obvious "keep vs. diverge" call. Add one
                      whenever a session makes a call worth defending later.
scripts/
  check-engine-purity.mjs   The CI-enforced engine-boundary guard.
.github/workflows/ci.yml    typecheck → engine-purity guard → test+coverage
                             → build. No lint gate yet (see below), no E2E
                             yet (later session), Chrome-only (later
                             session adds Firefox build verification back).
```

## Conventions established so far

- **Framework**: WXT (kept after a real 2026 comparison against Plasmo —
  now in maintenance mode — and CRXJS — solves a narrower problem than we
  need). See `docs/decisions/0001-framework.md`.
- **UI library**: Solid (kept after comparing React/Svelte/vanilla). See
  `docs/decisions/0002-ui-library.md`. Its one known reactivity footgun
  (reading a signal/store value directly inside JSX isn't reactive) will
  get a CI guard proactively in a later session — this bit the old repo
  three separate times before it got one reactively; don't repeat that.
- **Chrome-only at launch**, but every build script accepts a browser
  target parameter (`build:firefox`/`zip:firefox` already work) — adding
  Firefox back later is a config change, not a migration.
- **No settings-sync mechanism, and won't be added casually** — the old
  repo shipped `chrome.storage.sync`, then fully removed it after a real,
  hard-to-diagnose split-brain bug on WebKit-based browsers (feature
  detection proved the API *existed*, not that it *worked* — see the old
  repo's `CLAUDE.md`, "storage.sync removed," for the full incident).
  Session 3's storage adapter (`src/platform/storage/`) is built behind a
  swappable `StorageBackend` port specifically so this doesn't require a
  redesign later — but sync itself is deferred with a concrete test
  precondition, not blindly avoided or blindly re-attempted. See
  `docs/decisions/0003-settings-sync-deferred.md`.
- **Coverage is a CI gate, not an aspiration**: `vitest.config.ts` enforces
  90%+ statement/function/line coverage (85%+ branch) on `src/engine/**`,
  `src/shared/**`, and (as of Session 3) `src/platform/**` — proven to
  actually fail (not just configured and hoped) via a throwaway violation
  during Session 1 setup. `entrypoints/`-layer UI coverage is a deliberate,
  documented carve-out (real UI test infra is a later session), not a
  silent gap.
- **Lint is not yet a CI gate** (Biome is configured, `npm run lint`
  works) — same explicit, non-oversight choice the old repo made
  repeatedly: fix meaningful findings as you touch files, don't block on
  the whole backlog before there's a reason to.
- **Version numbering restarted clean** at `0.1.0` — not continuing the old
  repo's `13.x`, which was meaningless lineage baggage from three
  rewrites.

## Current status

**Session 1 (framework/repo bootstrap) and Session 2 (first vertical
slice) are complete.** What Session 2 landed:
- `src/engine/translator.ts`: the `Translator` port every provider
  implements — deliberately minimal (no batching/retry/concurrency yet;
  those generalize once there's more than one provider, in Session 4).
- `src/engine/providers/libretranslate.ts`: a real LibreTranslate provider
  (documented JSON HTTP API — POST `{q, source, target, format}` to
  `${baseUrl}/translate`). Chosen deliberately over Google/Bing/Yandex
  (token-scraping) and the DeepL live-tab bridge (third-party UI
  automation) for this first slice — see the Gen 3 plan's Session 4 section
  for why those are deferred. Calls `fetch` directly — that's fine per the
  engine-purity rule (`fetch` is a standard Web API, not `chrome`/
  `browser`-namespaced — see `src/engine/README.md`).
- `src/platform/providerConfig.ts`: reads the provider's `{baseUrl,
  apiKey}` from `browser.storage.local` — the one genuinely
  `chrome`-namespaced capability this slice needed, kept out of
  `src/engine/` on purpose. A real config schema/store is Session 3; this
  is deliberately the smallest version of "read config from storage" that
  proves the seam.
- `entrypoints/background.ts`: one raw message type (`translateText`) —
  not the full typed messaging protocol yet (that's Session 6, once there
  are enough real message types to design well against).
- `entrypoints/content.ts` + `entrypoints/popup/App.tsx`: click "Translate"
  → background translates the page's first `<p>` via the real provider →
  content script writes the result back into the real page. Not the real
  page-translation engine (dedupe/mutationWatcher/resweep/grouping/
  translateLoop is Session 5) — just enough DOM plumbing to prove the
  pipeline end to end.
- **Verified for real, not just "the build succeeded"**: a Playwright run
  against the actual built extension, with a local mock LibreTranslate-
  shaped HTTP server and a local static test page — confirmed a genuine
  network POST, a genuine background↔content-script round trip, and a
  genuine DOM mutation on the page. No third-party API credentials were
  available to hit a real LibreTranslate instance (every public instance
  checked either requires a paid API key now or was down) — the mock
  server matches this project's own established "local mock + local test
  page" verification convention from the old repo, not a shortcut.
- **A real platform quirk found while writing that verification, not a
  product bug**: `chrome.runtime.sendMessage` never delivers back to the
  exact execution context that sent it (Chrome deliberately doesn't loop a
  message back to its own sender) — this only matters for test scripts
  that try to simulate a message send from the service worker's own
  `evaluate()` context; real popup→background calls are a genuinely
  different JS realm and are unaffected. Documented here so it isn't
  rediscovered as "the messaging is broken" in a future session's
  real-round-trip verification.

**Session 3 (config/storage layer) is complete.** What it landed:
- `src/shared/config/schema.ts` + `migrations.ts`: fresh config schema (5
  fields so far — grows incrementally as later sessions add features, not
  a guess at the eventual full list) and a versioned migration system
  (pure functions, ascending, gated on a stored version marker) — the
  *pattern* kept from the old repo on purpose (real engineering win), the
  key names and schema shape entirely fresh.
- **A real first migration, not a contrived one**: `CONFIG_SCHEMA_VERSION`
  starts at 1, and that migration adopts Session 2's ad hoc,
  un-versioned `libreTranslateBaseUrl`/`libreTranslateApiKey` storage keys
  into the real schema's `providerBaseUrl`/`providerApiKey` fields — a
  genuine need, not a demo. Verified against fake-browser (unit) and the
  real built extension via Playwright (a seeded profile with the old keys,
  loaded for real, confirms the adoption and key removal).
- `src/platform/storage/`: a `StorageBackend` port + `localStorageBackend`
  (the only implementation that ships). `configStore.ts` depends only on
  the port, never on `browser.storage` directly.
- **`docs/decisions/0003-settings-sync-deferred.md`**: no sync backend
  ships. Not "avoid it forever" — the ADR names a concrete precondition
  (`configStore.test.ts`'s cross-context consistency test) any future sync
  backend must pass before it's reconsidered, directly targeting the exact
  class of bug (a write visible in one context, invisible in another) that
  made the old repo remove `chrome.storage.sync` after a real WebKit
  incident.
- `src/platform/configStore.ts`: `get`/`set`/`onReady`/`onChanged`/
  `export`/`import` — the *shape* kept from the old repo's `twpConfig` on
  purpose (proven surface), everything else fresh. Session 2's ad hoc
  `providerConfig.ts` is deleted; `background.ts` now reads provider
  config through the real store.
- No options/backup UI wired to `export`/`import` yet (no such UI surface
  exists until Session 6/7) — the mechanism itself is fully tested (unit
  tests including the "rejects the wrong type," "ignores unknown fields"
  cases) and shares the same real-storage code path already verified by
  the migration checks above.

**Session 4 (provider ecosystem) is complete.** What it landed:
- `src/engine/translator.ts` **redesigned** from Session 2's single-text
  shape to a batch-oriented one: `TranslatePiece = string[]` (1+ related
  strings — the seam a future page-translation engine will use to group
  sibling DOM nodes for context), `Translator.translateBatch(request):
  Promise<PieceOutcome[]>`. `translateOne()` is a thin convenience wrapper
  for single-string callers (the popup, for now). This generalization
  happened at provider #2 as the plan recommended, informed by actually
  reading the old repo's `Service` class and 5 real providers to
  understand the real two-level structure needed (per-piece wire
  transform + multi-piece HTTP-request bundling) — not guessed at.
- `src/engine/providers/batchedHttpProvider.ts`: the shared machinery
  every HTTP-based provider composes — in-flight request dedupe, a soft
  per-request character budget bundling multiple pieces into fewer HTTP
  calls, retry-with-backoff honoring `Retry-After`, a concurrency cap, and
  a "short response" repair pass that retries individually-missing pieces
  once. Built on `fetch` (no XHR shim needed — unlike the old repo's MV3
  constraint, `fetch` has no `chrome`-API dependency), so it lives cleanly
  in `src/engine/` under the purity guard.
- **Five providers**: `libretranslate.ts` (rebuilt on the shared base),
  `google.ts` (free scraped `translateHtml` endpoint — response parser
  **independently re-derived from live API testing**, not templated from
  the old repo's file, per an explicit mid-session user instruction — see
  the extensive doc comment on `splitPieceResponse` for the actual
  request/response evidence this was built from), `googleCloudTranslate.ts`
  (new — the real, official, paid Google Cloud Translation API v2),
  `llm.ts` (OpenAI-compatible, numbered-segment prompt / JSON-array
  response — works against a local server, e.g. Ollama, with zero extra
  code, since "local model" support is just a different `baseUrl`),
  `builtin.ts` (on-device Chrome `Translator` API, feature-detected, not
  built on the shared HTTP base since there's no HTTP request at all).
  `bing.ts`/`yandex.ts` were **not** built this session — see
  `docs/decisions/0004-provider-scope.md`.
- **A real, live-verified finding that shaped scope**: mid-session,
  WebSearch confirmed Chrome's native "translate this page" runs on-device
  Gemini Nano, and Arc's translate uses the real paid Google Translate
  API — neither matches this project's free scraped `translateHtml`
  endpoint's quality ceiling. That finding (not assumption — the user
  explicitly required checking, not guessing) drove the decision to add
  Google Cloud Translation as a first-class paid provider and to drop
  Bing/Yandex rather than build more scraping surface at the same
  confirmed-lower quality tier. See `docs/decisions/0004-provider-scope.md`.
- `src/engine/providers/descriptors.ts` + `registry.ts`: the capability
  registry (`ProviderId`, `requiresKey`, `isAvailable`, `batchingHint`)
  and a pure `createProvider(id, config): Translator | null` factory —
  the config shape is deliberately its own small interface, not the real
  `Config` schema, so this file stays decoupled from schema shape.
- `src/shared/config/schema.ts` + `migrations.ts`: per-provider config
  fields (`libreTranslateBaseUrl`/`libreTranslateApiKey`,
  `googleCloudTranslateApiKey`, `llmBaseUrl`/`llmApiKey`/`llmModel`) and
  `pageTranslatorProvider`'s enum widened to all 5 provider IDs. A real
  second migration (`CONFIG_SCHEMA_VERSION` 1 → 2): Session 3's generic
  `providerBaseUrl`/`providerApiKey` fields turned out to be the wrong
  shape once more than one provider existed with genuinely different
  config needs — this migration renames them back to the provider-specific
  names, a real course-correction, not a contrived one.
- `entrypoints/background.ts` rewritten onto `registry.createProvider()` +
  `configStore.get('pageTranslatorProvider')`, replacing Session 2's
  hardcoded LibreTranslate call — the same seam Session 5's page-
  translation engine and the real popup UI will use.
- **`docs/decisions/0005-deepl-live-tab-bridge.md`**: DeepL is not ported
  this session, on purpose — neither the (simple, low-risk) DeepL Free API
  nor the (fragile, tab-lifecycle-dependent) live-tab bridge, since this
  session's scope was explicitly narrowed elsewhere and shipping only half
  of DeepL felt worse than deferring both together as one clean unit.
- 87 unit tests (39 at end of Session 3 → 87), coverage gate passing
  (94.65% stmt / 85.5% branch / 97.22% func / 96.76% line, against the 90/
  85/90/90 thresholds) — every new provider and the shared batching base
  have direct tests, not just indirect coverage through one provider.
- **Real end-to-end verification against the actual built extension**, not
  just unit tests: an ad hoc Playwright run (local mock OpenAI-compatible
  HTTP server + local static test page, matching the old repo's own
  established verification pattern) drove a real popup click through
  `background.ts` → `registry.createProvider('llm', ...)` →
  `batchedHttpProvider`'s real `fetch` call → the mock server → back
  through the content script → a real DOM update on the test page,
  confirming `<p>Hello world</p>` became `<p>Hola mundo</p>`. Hit the same
  "a service worker can't message its own listener" dead end documented in
  prior sessions in a new shape — here it was "`chrome.tabs.query({active:
  true})` resolves to whichever tab Playwright most recently created," not
  the intended test page — fixed by explicitly calling `testPage
  .bringToFront()` before triggering the popup click, so the real active
  tab matches what `popup/App.tsx` expects.

**Session 5 (page-translation engine) is complete.** What it landed:
- `src/engine/pageTranslator/`: `collectTextNodes.ts` (DOM walk, skips
  script/style/noscript/textarea + contenteditable), `dedupe.ts`
  (WeakSet-based O(1) identity tracking), `mutationWatcher.ts`
  (childList + characterData observation, with an own-write guard so the
  engine never re-translates its own output), `resweep.ts` (adaptive
  backoff safety re-sweep — catches shadow-DOM/detached-subtree content a
  MutationObserver structurally can't see), and `translateLoop.ts` (the
  orchestrator tying them together). All of it lives in `src/engine/`
  under the purity guard — only standard Web APIs
  (`MutationObserver`/`setTimeout`/`location`), zero `chrome`/`browser`.
- **The chunking logic (`grouping.ts`) — explicitly improved, not just
  ported, per direct user request.** Beyond simple block-ancestor grouping
  (kept from the old repo's version), this adds sentence-boundary-aware
  cutting: once a group exceeds `maxGroupChars`, it only cuts immediately
  if the group's last-added node completed a sentence; otherwise it lets
  the group grow past budget (bounded by `maxGroupChars * 1.5`) hunting for
  the real sentence end, so inline formatting (`<b>`, `<a>`, ...) splitting
  one sentence across several text nodes — e.g. `"Hello <b>world</b>."` as
  3 nodes — can't get cut mid-sentence (which would send a lone `"."` as
  its own translation piece and sever "world" from the context that would
  help translate it). A pathological node stream with no punctuation at
  all still terminates in bounded pieces via the hard cap. 8 unit tests
  covering block cuts, sentence-boundary cuts, bounded overflow, the
  hard-cap fallback, and context-carrying across a cut.
- **The chunking improvement extended to a second provider, not just kept
  at one.** `descriptors.ts`'s `batchingHint` previously only covered
  `llm`; this session added it to `google` too — its endpoint has a real
  native multi-item marker scheme (`<a i=N>`, see `google.ts`), so grouping
  sibling text nodes into one piece gives the model genuine paragraph
  context with no separator-ambiguity risk (unlike `libretranslate`/
  `googleCloudTranslate`, deliberately left ungrouped — see the descriptor
  file's inline comments for why the separator-join scheme there carries a
  real, if modest, cross-segment-translation risk that wasn't taken without
  observing it against real traffic first).
- `Translator`-port reuse across the engine/platform boundary: rather than
  inventing a separate messaging contract, `translateLoop.ts` takes a
  `Translator` (the exact same interface every provider in
  `src/engine/providers/` implements) as a constructor argument.
  `src/platform/remoteTranslator.ts` is the one adapter implementing that
  interface via `browser.runtime.sendMessage` to a new `translatePieces`
  background message (added to `entrypoints/background.ts`, reusing the
  same `registry.createProvider()`/`buildProviderConfig()` selection logic
  `translateText` already used). This makes the concrete
  cross-surface-reuse case real, not aspirational: a future non-extension
  surface would supply a different `Translator` here and reuse
  `translateLoop.ts` completely unmodified.
- `entrypoints/content.ts` rewritten from Session 2's single-hardcoded-`<p>`
  demo onto the real engine — full-page translate/restore, watching for
  new/changed content, chunking per the active provider's `batchingHint`.
  `entrypoints/popup/App.tsx` now triggers real `pageTranslate`/
  `pageRestore`/`getPageState` messages instead of the old demo flow.
- 141 unit tests (87 at end of Session 4 → 141), coverage gate passing
  (95.22% stmt / 87.35% branch / 95.88% func / 97.49% line, against the
  90/85/90/90 thresholds).
- **Real end-to-end verification against the actual built extension**: a
  Playwright run against a 3-paragraph test page (2 separate `<p>` blocks
  that must stay separate pieces, plus one paragraph with a sentence split
  across inline-formatted text nodes that must stay grouped) confirmed the
  full pipeline for real — every paragraph translated, and the mock LLM
  server's received prompt confirmed the inline-formatted sentence really
  was sent as ONE segment (`"Hello ␟world␟. This should stay grouped."`),
  not three isolated fragments — concrete proof the chunking improvement
  works against the real built extension, not just in unit tests. Restore
  was verified too, bringing back the exact original text. Also
  incidentally exercised the "short response repair" retry machinery for
  real (the throwaway mock server didn't preserve the piece-part separator
  in its fake translations, which correctly triggered the missing-result
  repair/requeue path) — not the goal of the test, but a nice confirmation
  that path also works end to end. Hit the by-now-familiar
  self-referential-active-tab Playwright gotcha a third time, in a new
  shape: reusing the *same* popup page instance for the restore click
  (rather than opening a fresh tab, which becomes the active tab itself)
  was the fix this time — noted here as the specific variant so the next
  session doesn't rediscover it from scratch.
- **Session 5 follow-up (same day): the two deferred pieces landed too** —
  `titleTranslator.ts` (tab-bar title translation) and
  `autoTranslateDecision.ts` + `originalLanguageTracker.ts` (auto-translate-
  on-load), closing out the rest of the plan's Session 5 scope.
  - `titleTranslator.ts` lives in `src/engine/pageTranslator/` (engine-pure
    — takes an injected `Translator`, same pattern as `translateLoop.ts`).
    Ported the old repo's proven design as-is: the `[[title, ' ']]`
    two-item batching workaround for Google's `arr.length > 1` quirk (see
    that file's header comment), the dual-write to both `document.title`
    and the `<title>` element, the own-write MutationObserver guard, the
    ~1.5s polling fallback, and the 50-entry cache. Wired into
    `translateLoop.ts`: `start()`/`restore()` on translate/restore,
    `catchUp()` on tab refocus and on `resweep.ts`'s `onHrefChange` (SPA
    navigation).
  - The auto-translate decision is split across the engine/platform
    boundary on purpose: `src/engine/pageTranslator/autoTranslateDecision.ts`
    is the pure `shouldAutoTranslateOnLoad()` function (no browser APIs,
    directly unit-tested), and `src/platform/originalLanguageTracker.ts` is
    the one adapter that actually calls `browser.i18n.detectLanguage()`.
    Wired into `content.ts`: on load (main-frame only — see that tracker's
    header comment for why iframes are a documented gap, not silent),
    detects the language, then calls the pure decision function against 4
    new config fields (`alwaysTranslateSites`/`neverTranslateSites`/
    `alwaysTranslateLangs`/`neverTranslateLangs`, purely additive to the
    schema — no migration needed).
  - 178 → 188 tests (net, across both the core Session 5 commit and this
    follow-up), coverage gate still passing.
  - **Real end-to-end verification caught a real bug in the test itself,
    not the product**: a Playwright run seeding `alwaysTranslateSites`
    with `localhost:<port>` (matching the test page's full origin) found
    the page never auto-translated — turned out `location.hostname`
    (what `content.ts` actually compares against) excludes the port,
    while the seeded value didn't. Fixing the test data (not the source)
    to `['localhost']` confirmed the real behavior: a fresh page load,
    zero user gesture, correctly auto-translated the body text AND the
    tab-bar title (both `document.title` and the `<title>` element)
    purely from the always-translate-sites match.
  - Element-attribute translation (placeholder/title/alt/aria-label) and
    custom-dictionary application remain the same documented phase-2 scope
    cut inherited from the plan — every text node still gets found and
    translated correctly, just without those extras.

**Session 6 (messaging, options page, content-script UI surfaces) is
complete.** What landed, across three passes in the same session:
- **Typed messaging protocol**: `src/platform/messaging/protocol.ts`
  defines every message this extension sends as one `ProtocolMap`
  interface, built on `@webext-core/messaging`'s
  `defineExtensionMessaging()` — compile-time checked at both ends (payload
  AND response shape), and unifies content-script/popup → background
  (`runtime.sendMessage`) and popup/background → a specific tab's content
  script (`tabs.sendMessage`) into one `sendMessage(type, data, tabId?)`
  call, replacing the hand-rolled `isXMessage()` type-guard-per-message-type
  pattern Sessions 2-5 used. Lives in `src/platform/` (not `src/shared/`)
  even though `ProtocolMap` is just types — `defineExtensionMessaging()`
  itself binds to `browser.runtime` at module-evaluation time, which
  belongs behind the platform boundary.
- **`src/platform/messaging/tabTarget.ts`**: the one place that knows how
  to find "the tab a page-scoped message should go to"
  (`getActiveTabId()`) — the exact duplication the plan called out in the
  old repo (hand-copied between the messaging layer and `background.ts`)
  doesn't exist here at all: `popup/App.tsx`'s translate/restore buttons
  and `background.ts`'s new context-menu/keyboard-command handlers both
  call this same function.
- `remoteTranslator.ts`, `background.ts`, `content.ts`, `popup/App.tsx` all
  rewired onto the typed protocol — behavior unchanged, verified with a
  real Playwright round trip (popup translate → mock LLM → DOM update →
  popup restore) against the rebuilt extension after the rewire.
- **New trigger surfaces**, both routed through `getActiveTabId()` +
  `sendMessage()`, no new tab-lookup logic: a right-click context menu
  ("Translate this page" / "Show original text") and a keyboard command
  (`Alt+Shift+T`, toggles translate/restore based on the tab's current
  `getPageState()` result — the only one of the three trigger paths that
  needs a toggle rather than two separate affordances, since a keyboard
  shortcut has no separate "translate" vs. "restore" button to bind to).
  `wxt.config.ts` gained the `contextMenus`/`activeTab` permissions and a
  `commands` manifest entry for this.
- **The options page** (`entrypoints/options/`) — Prism's biggest
  functional gap before this: `googleCloudTranslateApiKey`, all 3 `llm*`
  fields, and the 4 always/never-translate lists (added in Session 5) had
  zero UI anywhere to set them. Scoped to the plan's explicit "start with
  General + Translation services only" — 3 sections (General, Translation
  service, Automatic translation), not the old repo's 6-tab layout, since
  the other old-repo sections (Selection & hover, Voice, Dictionary,
  Advanced/diagnostics) don't exist as features in Gen 3 yet at all.
  Mirrors `configStore` into a local Solid store synced via
  `configStore.onChanged` (the `createStore`-mirror pattern, not direct
  `configStore.get()` reads inside JSX — a known Solid-reactivity foot-gun
  in this codebase's lineage, avoided from the start here rather than hit
  and fixed later). Verified for real against the built extension: field
  edits persist to `chrome.storage.local` correctly, and a page reload
  re-hydrates every field from storage (not just optimistic local state).
- **Custom dictionary: explicitly not built this session**, not a silent
  gap — no config keys, no UI. The plan's own guidance for this feature is
  "wire it for real or don't build the UI/config for it yet at all," and
  building it properly (exact-match substitution actually applied inside
  `translateLoop.ts`'s translate path) is real scope on top of an already
  large session; shipping a settings field with no effect would repeat the
  exact non-functional-placeholder mistake the plan explicitly warns
  against. Deferred to a dedicated follow-up, not silently dropped.
- **Follow-up pass (same session): popup polish + the floating bubble
  landed too.**
  - `src/shared/languages.ts`: a small curated `COMMON_LANGUAGES` list (~34
    entries) for quick-pick dropdowns — explicitly NOT the full generated
    language-name table Session 7 schedules (derived from what each
    provider actually supports, plus the old repo's 43 locale files'
    translated string values as a bootstrap corpus). Scoped to today's
    dropdown-instead-of-bare-text-input polish only.
  - `popup/App.tsx` gained a target-language quick-pick and a provider
    quick-switch, both writing straight to `configStore` (kept in sync
    with the options page via `configStore.onChanged`, same
    never-read-`configStore.get()`-in-JSX discipline as the options page).
  - **The floating bubble** (`components/bubble/`): `FloatingBubble.tsx`
    (the Solid component) + `mountBubble.ts` (the imperative shadow-DOM
    host adapter `content.ts` calls) + `bubbleStyles.ts` (inline CSS,
    since a shadow root on an arbitrary page can't `@import` this
    extension's own stylesheets). Appears once a page is translated
    (wired to `pageTranslator.onStateChange`), offers "Show original," and
    a close button. **Deliberately simpler than the old repo's bubble**:
    fixed bottom-right position, no drag-to-reposition or edge-docking
    math, no per-host remembered position — that old behavior is real,
    hard-won engineering documented at length in the old repo's history,
    and porting it properly deserves its own focused pass rather than a
    rushed tail-end addition here. What shipped is real and functional
    (not a placeholder): it shows, toggles, and closes, backed by 13 unit
    tests (`vitest.config.ts` gained `vite-plugin-solid` + a
    `components/**/*.test.tsx` glob so `.tsx` component tests compile
    under Vitest's own Vite instance — separate from the real extension
    build's Solid JSX support, which still comes from
    `@wxt-dev/module-solid`). Uses an **open** shadow root (not the old
    repo's closed one) — deliberate: the bubble holds no sensitive data,
    just a toggle button, so the isolation benefit of closed mode is
    marginal here and open keeps it testable from outside
    (`host.shadowRoot`).
  - **Real Playwright verification against the built extension**: a
    translated page showed the bubble with the correct "Translated" label
    and "Show original" button (read by piercing the real shadow root,
    not just asserted in unit tests), and clicking the bubble's button
    directly on the page restored the original text and removed the
    bubble — the full real-DOM round trip, not just the isolated
    component tests.
  - **Real Playwright verification against the built extension**: a
    translated page showed the bubble with the correct "Translated" label
    and "Show original" button (read by piercing the real shadow root,
    not just asserted in unit tests), and clicking the bubble's button
    directly on the page restored the original text and removed the
    bubble — the full real-DOM round trip, not just the isolated
    component tests.
- **Final pass (same session): hover tooltip + selection translation +
  the mobile trigger.** All three of what the writeup above had marked
  "still not started."
  - **Hover-to-see-original tooltip** (`components/hoverTooltip/`):
    `HoverTooltip.tsx` (presentation) + `mountHoverTooltip.ts` (hover
    detection, a 350ms show-delay debounce, cursor-follow while visible,
    desktop-only via a user-agent check matching the old repo's
    behavior). The actual "find the original text for this element" logic
    is `src/engine/pageTranslator/hoverOriginalText.ts` — a small pure
    function (engine-pure, directly unit-tested) built directly on
    `pageTranslator.getTranslatedNodes()`, the exact same live node/
    original-text list Session 5 already exposed for this. No new engine
    state needed.
  - **Translate-selected-text** (`components/selection/`):
    `SelectionPopup.tsx` (presentation) + `mountSelectionPopup.ts`
    (`mouseup`-based selection detection, positions a small trigger
    button near the selection, translates via the same injected
    `Translator`/`translateOne()` every other surface uses on click) +
    `src/engine/selection/selectionInfo.ts` (pure `Selection`→
    `{text, rect}` reader, engine-pure, unit-tested). Deliberately much
    simpler than the old repo's ~1300-line `translateSelected.js`: no
    drag-to-move, no editable replace-in-place, no listen/copy actions,
    no cross-frame focus arbitration, no per-selection service/language
    pickers — uses the page's already-configured provider/target
    language. Real and functional, not a placeholder.
  - **Mobile in-page translate trigger**: folded into the floating bubble
    (`FloatingBubble.tsx`'s new `showTranslatePrompt` prop,
    `content.ts`'s `matchMedia('(max-width: 480px)')` check) instead of
    porting the old repo's separate ~326-line `MobilePopup.tsx` — one
    component serving both "post-translate control" and "give mobile
    users an in-page way to start translating since the toolbar icon may
    be hard to reach," rather than two overlapping UI surfaces. The old
    `MobilePopup`'s always/never-translate-from-language quick shortcuts
    are not built here — the options page's Automatic Translation section
    is where those lists live now, for every viewport.
  - 22 new tests (from `hoverOriginalText.ts`, `selectionInfo.ts`, and the
    5 new component/controller files), 235 total.
  - **Real Playwright verification against the built extension, all
    three**: selecting real text on a real page and clicking the trigger
    produced a real translated result in the panel; hovering a translated
    paragraph after a real translate showed the correct original text in
    the tooltip; resizing to a 375px viewport surfaced the "Translate this
    page" prompt on the bubble, and clicking it translated the page for
    real. One real bug caught **in the verification script itself, not
    the product** (again): `element.dispatchEvent(new MouseEvent('click'))`
    intermittently didn't register with Solid's click handlers the same
    way a real click does — switching to the native `element.click()`
    method (already the established pattern from earlier sessions'
    verification scripts) fixed it immediately. Noted here so a future
    verification script reaches for `.click()` first, not `dispatchEvent`.
- **Custom dictionary remains explicitly deferred** — see the first pass's
  writeup above; nothing changed on that front in this session's later
  passes.

**Session 7 (disk cache, diagnostics, permission model, dark mode, i18n
decision) is complete.** What landed:
- **Translation cache** (`src/platform/cache/translationCache.ts`): one
  IndexedDB database/store (not the old repo's one-database-per-
  provider/language-pair-triple design — a real, documented
  simplification, see that file's header comment), byte-estimated size
  tracking, and oldest-(least-recently-used)-first eviction once over a
  configurable budget (default 5MB). `cacheKeyFor()` folds provider +
  source + target language + text into one key. Wired into
  `background.ts`'s `translatePieces` handler: pieces are checked against
  the cache first, only cache misses go to the real provider, and fresh
  results get written back. `translateText` (selection popup, title
  translator) deliberately does NOT use this cache — see that handler's
  comment for why. 10 unit tests (`fake-indexeddb`, added as a new
  dependency + wired into `tests/setup.ts`).
  - **Real Playwright verification against the built extension**:
    translating a page hit the mock LLM server exactly once; restoring
    and re-translating the same page hit it **zero** additional times —
    the cached result was served and applied correctly.
- **Diagnostics panel** (`src/platform/diagnostics.ts` +
  a new "Diagnostics" section in the options page): a real
  `chrome.storage.local` round-trip check, translation-cache size, live
  capability checks (`i18n.detectLanguage`, `scripting`, `IndexedDB`), and
  an effective-config dump with every `*ApiKey` field redacted. Built
  proactively this time (the old repo added its equivalent only after two
  separate real bug reports were each misdiagnosed more than once first —
  see `diagnostics.ts`'s header comment). A real Playwright run against
  the built extension caught a genuinely true fact, not a bug: this
  extension doesn't request the `scripting` permission (nothing uses
  `browser.scripting` anywhere in this codebase yet), and the panel
  correctly reports that as unavailable rather than assuming it's there —
  exactly the kind of "what actually works, not what's assumed" check
  this panel exists for.
- **Permission model** (`docs/decisions/0006-permission-model.md`):
  confirmed, not changed. Gen 3's content script has used a *static*
  `matches: ['*://*/*']` registration since Session 2 — the same
  mechanism the old repo's Session 4 found grants injection independent
  of `host_permissions`, and exactly the "broad access, no optional-grant
  runtime-registration API with browser support gaps" state the old repo
  reverted to after a real Orion/WebKit failure. Verified by inspecting
  the real built `manifest.json`: no `host_permissions` key at all, and
  the content script still runs on every page (already proven repeatedly
  in Sessions 5-7's own Playwright verification runs). No code changes
  were needed — Session 7 is where this got checked against the plan's
  explicit requirement and written down as a real ADR, not left as an
  unstated assumption.
- **Dark mode**: `entrypoints/popup/` had a real, previously-unnoticed bug
  — the WXT template's leftover `style.css` (dark-background-by-default,
  light-mode-only override) was still being imported alongside the
  Session 5/6-written `App.css` (light-only, no dark handling at all),
  producing an inconsistent, half-styled result depending on system theme.
  Deleted the unused template file and gave `App.css` real
  `prefers-color-scheme: dark` handling, matching the pattern already
  established in `entrypoints/options/App.css`. The bubble/hover-tooltip/
  selection-popup shadow-DOM surfaces intentionally stay a fixed dark
  theme regardless of system preference (same as this project's
  established pattern for those small floating overlays — not a gap).
- **i18n** (`docs/decisions/0007-i18n-corpus-deferred.md`): explicitly not
  started. No `@wxt-dev/i18n` setup, no `_locales/`, every UI string
  across every surface built in Sessions 2-7 is hardcoded English. Porting
  the old repo's 43-language corpus (translated *values* only, fresh key
  names, per the plan's Round 3 scoping) is real, substantial, mechanical
  work deserving its own dedicated session — see that ADR for the concrete
  handoff steps.
- 251 tests (235 → 251), coverage gate still passing.

**Session 8 (hardening pass — structural guards for old-repo gotchas) is
complete.** The point of this session, per the plan: every "fixed once and
remembered" lesson from the old repo becomes a CI-enforced guard here, not
a comment someone has to recall. Four items from the plan's list, worked
through in order:

- **Headers-object copying** — audited, not built. The old repo's incident
  was `Object.assign({}, headersObject)` silently copying nothing (a
  `Headers` instance's fields aren't own-enumerable properties), breaking
  `Retry-After` handling. `grep -rn "Object.assign.*[Hh]eaders\|\.headers\b"`
  across `src/`, `entrypoints/`, `components/` (excluding tests) turns up
  exactly one hit: `src/engine/providers/batchedHttpProvider.ts`'s
  `response.headers.get('retry-after')` — a direct `.get()` read, never a
  copy. This codebase doesn't have the bug class, confirmed by reading the
  code rather than assumed from the old repo's history — so no
  `copyHeaders()` utility was built for a problem that doesn't occur here;
  adding one anyway would be exactly the kind of speculative abstraction
  this project's conventions rule out.
- **Solid-reactivity CI guard** (`scripts/check-solid-reactivity.mjs`,
  wired into `package.json` as `guard:solid-reactivity` and into
  `.github/workflows/ci.yml` right after the engine-purity guard): fails
  the build if any `.tsx` file under `entrypoints/`/`components/` reads
  `configStore.get(...)` directly inside a JSX interpolation — the exact
  non-reactive-read bug class the old repo shipped three separate times
  (see that repo's Session 5/Phase 2 writeups) before a guard existed.
  Deliberately narrow (matches only `configStore.get(` in a JSX
  interpolation prefix, not a general "no property reads in JSX" rule) —
  `configStore` is the one non-reactive store this codebase has, and a
  broader regex-based rule risks false positives on legitimate reactive
  signal calls without a real JSX/TSX parser. **Proven to actually catch
  the bug, not just configured and trusted**: temporarily injected
  `configStore.get('targetLanguage')` into a JSX expression in
  `entrypoints/popup/App.tsx`, confirmed the guard failed with the correct
  file/line/message, then restored the original file and re-confirmed a
  clean pass — same "prove the guard fails" bar `check-engine-purity.mjs`
  was held to in Session 1.
- **MV3 service-worker keepalive via `chrome.alarms`**
  (`entrypoints/background.ts`'s `setupKeepalive()`, called once at the top
  of `defineBackground()`): the old repo's `background.ts` had no keepalive
  at all until one was added as a deliberate improvement over the
  pre-rewrite fork; Gen 3 hadn't rebuilt it yet. A service worker with no
  pending listener callback is eligible for suspension by Chrome after
  roughly 30s of idle time — a `translatePieces` call that hits several
  provider round trips (retry/backoff in `batchedHttpProvider.ts`) can run
  long enough to lose the worker mid-request with no error surfaced to the
  page. `browser.alarms.create('prism-keepalive', { periodInMinutes: 0.4
  })` (24s — deliberately under the ~30s idle threshold, since a longer
  period would let the worker suspend in the gap anyway) plus a live
  `alarms.onAlarm` listener; `"alarms"` added to `wxt.config.ts`'s
  manifest permissions. The listener body is intentionally a no-op — the
  mechanism is Chrome waking a suspended worker to deliver the alarm event
  and the listener's mere existence keeping the worker classified active
  in between, not anything the handler needs to compute.
  **Verified against the real built extension**, not just "the code
  compiles": loaded `.output/chrome-mv3` in real Chrome (via
  `playwright-core` pointed at a cached Chromium binary, installed
  ad hoc with `--no-save` and removed after — this repo doesn't have a
  Playwright dependency yet, that's Session 9's job) and called
  `chrome.alarms.getAll()` directly against the live service worker;
  confirmed `[{"name":"prism-keepalive","periodInMinutes":0.4}]` is
  actually registered. A full "survives a simulated suspension" test needs
  the real E2E harness Session 9 builds (this session had no persistent
  Playwright setup to build that into) — noted honestly as scoped to
  registration-is-correct verification, not the full suspension-survival
  claim.
- **`chrome-headless-shell` has zero extension support** — the guard for
  this is "the E2E runner launches full Chrome with `--headless=new`,
  verified by a positive assertion." This repo has no E2E harness yet
  (Session 5's plan reference to Playwright was about ad hoc scratch
  verification scripts, not a committed suite — unlike the old repo, which
  had already formalized `tests/e2e/run.mjs` by its own Session 1). Building
  that harness is explicitly Session 9's task; the guard lands there, not
  here, so it isn't invented against a harness that doesn't exist yet.
- 251 tests, unchanged — this session added guard scripts and a background
  keepalive, no new unit-testable pure logic. Full verification chain
  (`compile`, `guard:engine-purity`, `guard:solid-reactivity`,
  `test:coverage`, `build`, `lint`, `npm audit`) run clean; manifest of the
  real build inspected directly to confirm `"alarms"` actually landed in
  `permissions`.

## Testing

Run before considering any Gen 3 change done:
1. `npm run compile` (`tsc --noEmit`) — must be clean.
2. `npm run guard:engine-purity` — must pass. If it doesn't, the fix is
   almost always "move this to `src/platform/` and inject it as a port,"
   not "add an exception to the script."
3. `npm run guard:solid-reactivity` (Session 8) — must pass. Fails if any
   `.tsx` under `entrypoints/`/`components/` reads `configStore.get(...)`
   directly inside JSX; mirror the value into a signal/store instead.
4. `npm run test:coverage` (Vitest + v8 coverage) — unit tests for
   `src/engine/`/`src/shared/` logic must pass AND meet the coverage
   thresholds in `vitest.config.ts`.
5. `npm run build` — must succeed.
6. `npm run lint` — not CI-gated yet, but run it and fix genuine findings
   in files you're touching.

All of steps 1-5 run in CI (`.github/workflows/ci.yml`) on every push to
`main` and every PR.

## Known gaps (expected at this stage, not oversights)

- No DeepL provider (neither the Free API nor the live-tab bridge) — a
  deliberate Session 4 deferral, see
  `docs/decisions/0005-deepl-live-tab-bridge.md`.
- No iframe support for auto-translate-on-load — main-frame only, see
  `originalLanguageTracker.ts`'s header comment. The typed messaging layer
  this needs now exists (Session 6); relaying a main frame's detected
  language into same-origin iframes is still unbuilt.
- No element-attribute translation (placeholder/title/alt/aria-label) or
  custom-dictionary application — every text node still gets found and
  translated correctly, this is the same documented phase-2 scope cut the
  plan calls out, not a regression. Custom dictionary specifically:
  deliberately not started in Session 6 either, see that session's writeup.
- The floating bubble has no drag-to-reposition or edge-docking — fixed
  bottom-right only, a deliberate scope cut (see Session 6's writeup),
  not an oversight.
- The selection-translation popup has no drag-to-move, editable
  replace-in-place, listen/copy actions, cross-frame focus arbitration,
  or per-selection service/language pickers — a deliberate scope cut
  (see Session 6's writeup), not an oversight. It also only mounts in the
  main frame, same as every other UI surface in this list.
- The mobile in-page translate trigger is folded into the floating bubble
  rather than a separate mobile-specific menu — no always/never-
  translate-from-language quick shortcuts on it specifically (those live
  in the options page's Automatic Translation section for every
  viewport). See Session 6's writeup for the reasoning.
- No i18n — every UI string is hardcoded English, see
  `docs/decisions/0007-i18n-corpus-deferred.md` for the deferred corpus
  port and the concrete handoff steps.
- No options/backup UI wired to `configStore.export()`/`import()` yet —
  the storage mechanism itself is fully tested (see the Session 3
  writeup above); Session 6's options page covers General/Translation
  service/Automatic-translation only, not backup/export.
- No E2E test harness committed yet (the old repo's Playwright pattern —
  full Chrome with `--headless=new`, since `chrome-headless-shell` silently
  doesn't support extensions at all — is the reference to follow when this
  gets built, likely Session 9). Session 2's real-network verification was
  done ad hoc, matching the old repo's own established pattern for this
  kind of check, not committed as a permanent test yet.
- No release/changesets infra yet (Session 9).
- Icons/branding are still the WXT template defaults
  (`public/icon/*.png`) — real Prism branding work isn't scoped to a
  specific session yet in the plan; revisit when it becomes a blocker
  (likely alongside UI-surface sessions).
