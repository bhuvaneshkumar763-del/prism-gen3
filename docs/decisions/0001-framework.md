# 0001 — Framework choice: WXT

## Status
Accepted — 2026-08-01

## Context
Gen 3 is a from-scratch rewrite of a Chrome (later Firefox) translation
extension, explicitly not inheriting anything from its two prior
codebases — not even a re-picked tool without re-justifying it. The
previous generation used [WXT](https://wxt.dev) + TypeScript + Solid.js.
Before carrying that forward, we compared it against the current (2026)
alternatives rather than assuming it still wins.

Hard constraints from the project plan that any candidate had to satisfy:
- The core translation engine must be able to live with **zero** imports of
  `chrome`/`browser` APIs or framework-specific modules, so it can be
  extracted into its own package later without a rewrite.
- Needs a credible path back to Firefox (MV2) later, without that being a
  second framework migration.
- Must work cleanly with `vitest` + `happy-dom` for engine unit tests.
- Chrome-only at launch is fine, but the manifest/build tooling shouldn't
  make that assumption load-bearing.

## Candidates considered
1. **WXT** — the incumbent choice from the prior generation.
2. **Plasmo** — a competing full-featured extension framework, React-first.
3. **CRXJS (`@crxjs/vite-plugin`)** — a lower-level Vite plugin for MV3
   extensions, not a full framework (no built-in i18n module, no
   `wxt.config.ts`-style unified manifest abstraction, no auto MV2/MV3
   dual-target).
4. **Hand-rolled Vite + a custom manifest-generation script** — maximum
   control, but means personally re-solving every MV2/MV3 manifest-shape
   difference (host_permissions placement, `service_worker` vs.
   `background.scripts`, `action` vs. `browser_action`, the Chrome-only
   `version_name` field for carrying a prerelease version string) that WXT
   already has solved and tested against real Chrome/Firefox releases.

## What we found (checked live, not from memory)
- **WXT**: actively developed, the most commonly recommended choice for
  new extension projects as of 2026. Handles Manifest V2/V3 generation for
  Chrome/Firefox/Safari/Edge from one config. Smaller output bundles than
  Plasmo in head-to-head comparisons. Built on Vite, so `vitest` tooling
  composes naturally. Has a documented (if occasionally surprising —
  closed-shadow-DOM UI injection, a `:host` CSS-cascade quirk, WXT folding
  a runtime-registered content script's `matches` back into mandatory
  `host_permissions`) but *known* set of gotchas from direct prior
  experience — a real advantage: "devil we know" has actual value when the
  alternative's gotchas are undiscovered.
- **Plasmo**: shows clear signs of maintenance-mode status — feature
  development has visibly slowed through 2025-2026, with commentary
  suggesting the team's focus has shifted to commercial products rather
  than the open-source framework. Its content-script-UI system (CSUI) is
  well-regarded, but that alone doesn't outweigh the maintenance-trajectory
  risk for a project meant to be extended for years.
- **CRXJS**: still actively maintained (confirmed recent releases, current
  Vite 8 compatibility), but it solves a narrower problem (Vite ↔ MV3
  manifest bridging) than what we need — no built-in Firefox MV2 output, no
  i18n tooling, no dev-server content-script reload story out of the box.
  Choosing it means building WXT's other functionality ourselves.
- **Hand-rolled**: rejected specifically because the "MV2 vs MV3 manifest
  shape" gotchas are exactly the kind of already-solved-elsewhere problem
  this project doesn't need to re-litigate. The old codebase's CLAUDE.md
  documents real hours lost to WXT-specific manifest-generation surprises;
  hand-rolling would mean discovering an equivalent (or worse — untested)
  set of surprises from scratch.

## Decision
**Keep WXT.** Not because it's the incumbent, but because a live 2026
comparison confirms it against the stated constraints: it's the most
actively maintained option, it satisfies the browser-API-free-engine
constraint just as well as any bundler would (that constraint is about
*our* code organization, not the framework), it has a credible Firefox
path already built in for when that's needed post-launch, and its rough
edges are already known and documented rather than being a fresh set of
unknowns to discover.

## Consequences
- `wxt.config.ts` remains the manifest source of truth; Chrome-only target
  configured explicitly (not "the only option available"), so re-adding
  Firefox later is a config change, not a rewrite.
- The known WXT gotchas from the prior codebase (closed-shadow-DOM UI,
  `:host` CSS cascade, static `content_scripts.matches` implying
  `host_permissions`) are treated as known risks to design around from the
  start in later sessions, not rediscovered.
- We do **not** get Plasmo's CSUI ergonomics — content-script UI mounting
  will be built by hand on top of WXT's shadow-root UI primitives, same
  starting point the prior codebase had.
