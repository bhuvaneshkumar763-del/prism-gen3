---
"prism-gen3": patch
---

Removed the "Built-in AI (on-device)" translation provider entirely. Real investigation traced the reported failure to a hard, unfixable platform limitation rather than a bug: Chrome's on-device Translator API is Google's own proprietary service, gated to actual Google Chrome — it never works in any other Chromium-based browser (Vivaldi, Brave, Opera, Edge, and others), even though they share the same underlying engine and even show the same internal language-package manager page. Since this provider could only ever work for a subset of Chrome users and produced a confusing dead end for everyone else, it's gone rather than half-supported. Anyone with it previously selected is migrated back to the default (Google) provider automatically.
