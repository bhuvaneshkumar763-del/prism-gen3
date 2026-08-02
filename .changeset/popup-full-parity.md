---
"prism-gen3": minor
---

The toolbar popup gained the pre-rewrite fork's per-site/per-language quick actions — always/never translate this site, always translate from the detected language, and a per-site floating-bubble toggle — plus a "More settings" section for the hover-tooltip and selection-popup toggles (both previously hardcoded on with no config at all). Also closes a real gap: a translate that later fails is now surfaced in the popup itself, not just the bubble. Second of the three-phase pass (bubble, popup, settings) restoring UI depth the ground-up rewrite had scoped down.
