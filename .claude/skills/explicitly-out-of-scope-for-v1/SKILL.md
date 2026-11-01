---
name: explicitly-out-of-scope-for-v1
description: The compiled "not yet" list for v1 — features deliberately excluded, each with a pointer to the ADR or session writeup holding the reason. Check before proposing or building something that may have already been ruled out.
---

# Explicitly out of scope for v1

Compiled Session 10, per the plan's Session 10 requirement — a visible
"not yet" list, not a silent gap. Everything here has a reason above (its
ADR, its session writeup, or the "Known gaps" entries) — this is the
compiled summary, not new information:

- ~~Firefox as a shipped target~~ **Resolved**: `release.yml` builds the
  Firefox add-on, signs it through AMO and attaches it to every release.
  CI still only build-checks it; no automated test runs the Firefox build.
- **Bing and Yandex providers** — deliberately dropped, `docs/decisions/0004-provider-scope.md`.
- **DeepL** (both the Free API and the live-tab bridge) — deliberately
  deferred, `docs/decisions/0005-deepl-live-tab-bridge.md`.
- ~~Shadow-DOM page content~~ **Resolved** post-launch, see the Known gaps
  entry above.
- **Iframe support**, partly: same-origin frames auto-translate with the
  main frame's language (beta.37) and restore with it, but manual translate
  (the `pageTranslate` handler) and every UI surface (bubble, hover,
  selection) are main-frame only. Cross-origin frames get nothing (beta.53).
- ~~Element-attribute translation~~ **Resolved**: `attributeTranslator.ts`
  translates `placeholder`, `alt`, a button's `value`, `title` and
  `aria-label`. A **custom dictionary** is still not built.
- **`chrome.storage.sync` / cross-device settings sync** — deliberately
  deferred with a concrete reconsideration test, `docs/decisions/0003-settings-sync-deferred.md`.
- **i18n / UI-string translation** — every surface is hardcoded English,
  `docs/decisions/0007-i18n-corpus-deferred.md`.
- **Standalone auxiliary windows** (improve-translation, translate-text,
  translate-document), **text-to-speech**, **release-notes page**,
  **toolbar icon state swap** — never scoped into any Gen 3 session.
  (Backup export/import was on this list; it shipped in the UI-depth
  pass's Phase 3, on the settings page's General tab.)
- **Selection-popup drag/replace-in-place/listen/per-selection pickers**
  — deliberate Session 6 scope cut, not part of the post-launch UI-depth
  pass (that pass's scope was limited to the bubble, popup, and settings
  surfaces — see that section above). **Copy is no longer on this list:**
  a UI audit added it (beta.70) as the most useful missing action on a
  translated snippet; the rest of this cut still stands.
- ~~Floating-bubble drag-to-reposition/edge-docking~~ **Resolved** by the
  post-launch UI-depth pass's Phase 1, see that section above.
