---
name: explicitly-out-of-scope-for-v1
description: Compiled Session 10, per the plan's Session 10 requirement — a visible
---

# Explicitly out of scope for v1

Compiled Session 10, per the plan's Session 10 requirement — a visible
"not yet" list, not a silent gap. Everything here has a reason above (its
ADR, its session writeup, or the "Known gaps" entries) — this is the
compiled summary, not new information:

- **Firefox as a shipped target** — build-validated in CI (Session 9) but
  never manually run/verified as a real Firefox install; Chrome-only at
  launch per the plan's Round 2 scoping.
- **Bing and Yandex providers** — deliberately dropped, `docs/decisions/0004-provider-scope.md`.
- **DeepL** (both the Free API and the live-tab bridge) — deliberately
  deferred, `docs/decisions/0005-deepl-live-tab-bridge.md`.
- ~~Shadow-DOM page content~~ **Resolved** post-launch, see the Known gaps
  entry above.
- **Iframe support** for auto-translate/hover/selection — main-frame only.
- **Element-attribute translation** (placeholder/title/alt/aria-label) and
  **custom dictionary** — neither built.
- **`chrome.storage.sync` / cross-device settings sync** — deliberately
  deferred with a concrete reconsideration test, `docs/decisions/0003-settings-sync-deferred.md`.
- **i18n / UI-string translation** — every surface is hardcoded English,
  `docs/decisions/0007-i18n-corpus-deferred.md`.
- **Standalone auxiliary windows** (improve-translation, translate-text,
  translate-document), **text-to-speech**, **backup export/import UI**,
  **release-notes page**, **toolbar icon state swap** — never scoped into
  any Gen 3 session.
- **Selection-popup drag/replace-in-place/listen-copy/per-selection
  pickers** — deliberate Session 6 scope cut, not part of the post-launch
  UI-depth pass (that pass's scope was limited to the bubble, popup, and
  settings surfaces — see that section above).
- ~~Floating-bubble drag-to-reposition/edge-docking~~ **Resolved** by the
  post-launch UI-depth pass's Phase 1, see that section above.
