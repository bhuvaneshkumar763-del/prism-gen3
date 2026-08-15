---
name: conventions-established-so-far
description: now in maintenance mode — and CRXJS — solves a narrower problem than we
---

# Conventions established so far

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
