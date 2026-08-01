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
- **No settings-sync mechanism yet, and won't be added casually** — the old
  repo shipped `chrome.storage.sync`, then fully removed it after a real,
  hard-to-diagnose split-brain bug on WebKit-based browsers (feature
  detection proved the API *existed*, not that it *worked* — see the old
  repo's `CLAUDE.md`, "storage.sync removed," for the full incident). When
  Session 3 builds the storage adapter, sync is deferred with a concrete
  test precondition for reconsidering it later, not blindly avoided or
  blindly re-attempted.
- **Coverage is a CI gate, not an aspiration**: `vitest.config.ts` enforces
  90%+ statement/function/line coverage (85%+ branch) on `src/engine/**`
  and `src/shared/**` specifically — proven to actually fail (not just
  configured and hoped) via a throwaway violation during Session 1 setup.
  `entrypoints/`-layer UI coverage is a deliberate, documented carve-out
  (real UI test infra is a later session), not a silent gap.
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

## Testing

Run before considering any Gen 3 change done:
1. `npm run compile` (`tsc --noEmit`) — must be clean.
2. `npm run guard:engine-purity` — must pass. If it doesn't, the fix is
   almost always "move this to `src/platform/` and inject it as a port,"
   not "add an exception to the script."
3. `npm run test:coverage` (Vitest + v8 coverage) — unit tests for
   `src/engine/`/`src/shared/` logic must pass AND meet the coverage
   thresholds in `vitest.config.ts`.
4. `npm run build` — must succeed.
5. `npm run lint` — not CI-gated yet, but run it and fix genuine findings
   in files you're touching.

All of steps 1-4 run in CI (`.github/workflows/ci.yml`) on every push to
`main` and every PR.

## Known gaps (expected at this stage, not oversights)

- Only one provider (LibreTranslate) and one message type exist. Google/
  Bing/Yandex/LLM/Builtin providers, the shared retry/batching/concurrency
  machinery, and the DeepL-live-tab-bridge decision are Session 4.
- No real config schema/store yet — `src/platform/providerConfig.ts` is a
  deliberately minimal placeholder. Session 3 builds the real thing
  (versioned migrations, the settings-sync deferral decision, export/
  import).
- No real page-translation engine yet — `entrypoints/content.ts` only
  handles one hardcoded `<p>`. Session 5 builds dedupe/mutationWatcher/
  resweep/grouping/translateLoop.
- No permission-model decision made yet — `wxt.config.ts` only requests
  `"storage"` so far (needed for `providerConfig.ts`). Broad `<all_urls>`-
  style access (matching the old repo's final, reverted-to state) is a
  deliberate Session 7 decision, not decided by omission.
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
