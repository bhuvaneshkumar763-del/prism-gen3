---
"prism-gen3": minor
---

The options page is now a 5-tab layout (General, Page translation, Bubble, Selection & hover, Advanced) restored toward the pre-rewrite fork's depth — no Voice or Dictionary tab, since those engine subsystems don't exist in Gen 3. Adds theme selection, backup export/import, restore-defaults, per-site bubble and source-language override tables, and a translation-cache toggle that actually skips both the cache read and write when off. Also fixes a real fork inconsistency: adding a site to "always translate" now correctly removes it from "never translate" on the options page too, not just the popup. Final phase of the three-phase pass (bubble, popup, settings) restoring UI depth the ground-up rewrite had scoped down.
