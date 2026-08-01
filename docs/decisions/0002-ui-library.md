# 0002 — UI library choice: Solid

## Status
Accepted — 2026-08-01

## Context
Separate from the bundler/framework choice (`0001-framework.md`), WXT
supports several UI library integrations (React, Vue, Svelte, Solid,
vanilla). The prior codebase used Solid.js. Re-evaluated on its own merits.

## Candidates considered
- **React**: largest ecosystem, most hiring familiarity, but heavier
  runtime and a virtual-DOM re-render model that's more bytes for a UI
  surface that (per the closed-shadow-DOM constraint from the old
  codebase) ships its CSS/JS inline per component, where every KB matters
  more than in a typical web app.
- **Svelte 5** (runes): compiles away most runtime, small output, but its
  fine-grained-reactivity model has an equivalent class of footgun to
  Solid's (see below) — switching wouldn't avoid the risk, just relearn it.
- **Vanilla** (no library): maximum control, minimum bytes, but every
  interactive surface (popup, options, floating bubble, tooltips) would
  need hand-rolled state/render wiring — real, avoidable cost for a project
  with many small interactive UI surfaces.
- **Solid**: fine-grained reactivity (no virtual DOM diffing), genuinely
  small runtime, and no new unknowns — its exact reactivity footgun (reading
  a plain signal/store value directly inside a JSX expression outside a
  tracked scope isn't reactive) is already documented from real, repeated
  incidents in the prior codebase.

## Decision
**Keep Solid.** The deciding factor isn't inertia — it's that Solid's one
known footgun class is exactly the kind of thing this project's stated
goal (CI-enforced guards over convention/memory, see the main plan's design
principle #3) is built to catch proactively this time, per Session 8 of the
plan. Switching to Svelte would trade a known, guardable risk for an
unknown one of similar shape; switching to React trades bundle size (a real
cost given every content-script UI surface inlines its own CSS/JS across a
closed shadow-DOM boundary) for ecosystem breadth this project doesn't
need (no hiring, no third-party component library dependency).

## Consequences
- A CI lint/grep guard against the "config read directly in JSX" pattern is
  planned from Session 1 (not added reactively after it ships broken, which
  is what happened three times in the prior codebase).
- `@wxt-dev/module-solid` is a reasonable dependency to bring back — it's a
  tool choice, not TWP lineage.
