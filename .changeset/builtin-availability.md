---
"prism-gen3": patch
---

Fixed a real bug where picking "Built-in AI (on-device)" produced a bare "[builtin] not configured or unavailable" error with no way to tell why. `createProvider('builtin', ...)` only ever runs in the background service worker, and `globalThis.Translator` presence is per-context — so the Options page now asks the background directly (a new `checkBuiltinAvailability` message) instead of guessing, and shows a real status next to the provider picker: not available in this browser/profile (with a pointer to `chrome://on-device-translation-internals`), model needs to download on first use, unsupported for this target language, or ready. The background error message itself is also more actionable now for this specific provider.
