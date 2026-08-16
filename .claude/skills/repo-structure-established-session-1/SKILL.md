---
name: repo-structure-established-session-1
description: entrypoints/         WXT entrypoints — one per browser-visible surface.
---

# Repo structure (established Session 1)

```
entrypoints/         WXT entrypoints — one per browser-visible surface.
                      This IS the "extension" layer — browser/WXT-specific
                      code lives here, nowhere else.
components/          Injected UI surfaces mounted from entrypoints/content.ts
                      (bubble/, hoverTooltip/, selection/) plus the options
                      page's own components (options/). Each mount* module
                      (mountBubble.ts, mountHoverTooltip.ts,
                      mountSelectionPopup.ts) builds its own shadow-DOM host
                      via src/shared/ui/shadowHost.ts.
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
  check-engine-purity.mjs      The CI-enforced engine-boundary guard.
  check-solid-reactivity.mjs   The CI-enforced Solid-reactivity guard (see
                                its own header comment).
  check-bundle-size.mjs        The CI-enforced bundle-size guardrail.
.github/workflows/ci.yml    typecheck → lint → engine-purity guard →
                             Solid-reactivity guard → test+coverage → build
                             → bundle-size guardrail → E2E smoke test → zip
                             artifact, plus a parallel Firefox build-only job.
```
