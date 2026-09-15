---
"prism-gen3": patch
---

Speed/size fix (round-5 bloat audit): removed the `zod` runtime dependency, replacing it with a small hand-written validator (`src/shared/config/validate.ts`) scoped exactly to what the 23-key config schema actually needs — no transforms, coercion, defaults, or refinements. Measured directly: `zod` was 51% of the shipped extension's bytes (202KB of a 393KB build), landing three separate times because content scripts can't share a chunk with the background graph — once each in `content-scripts/content.js`, `background.js`, and the options page's own chunk. Combined with the content script's `allFrames: true`, that meant ~67KB of validation-library code was parsed in every iframe of every page visited, to do exactly three things: validate one stored value on load, validate a partial object on import/restore, and the same on a settings-file import.

The new validator preserves both of zod's behaviors the real call sites depend on: unknown keys are silently dropped rather than rejected (so a settings file exported by a newer build still imports cleanly on an older one), and the nullable `bubblePosition` object strips its own unknown keys the same way. `Config` is now a hand-written interface rather than `z.infer`'d; `configValidators` is a mapped type over it, so an added config field with no matching validator is still a compile error — the same static coupling `z.infer` gave for free.

Total build size: 393.17KB → 194.04KB. Every pre-existing config test (`configStore.test.ts`, `migrations.test.ts`, `backup.test.ts`) passes unchanged.
