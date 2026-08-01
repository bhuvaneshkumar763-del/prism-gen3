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

- No real feature code yet — Session 1 only bootstraps the repo/tooling.
  Session 2 is the first session that gets a real translated word on a
  real page.
- No E2E test harness yet (the old repo's Playwright pattern — full Chrome
  with `--headless=new`, since `chrome-headless-shell` silently doesn't
  support extensions at all — is the reference to follow when this gets
  built, likely Session 9).
- No release/changesets infra yet (Session 9).
- Icons/branding are still the WXT template defaults
  (`assets/solid.svg`, `public/wxt.svg`, `public/icon/*.png`) — real Prism
  branding work isn't scoped to a specific session yet in the plan; revisit
  when it becomes a blocker (likely alongside UI-surface sessions).
