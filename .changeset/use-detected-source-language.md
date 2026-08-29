---
"prism-gen3": patch
---

Fixed the real, dominant cause of pages translating only partially with no error shown (novel543.com and similarly-structured pages): Prism always sent the literal string `'auto'` as the source language to the translation provider, and Google's own auto-detection turns out to be unreliable for a lot of real content — it silently echoes text back unchanged (a real `200` response, no error) for a large, inconsistent fraction of pieces on some pages, which is why nothing already in place caught it.

Verified directly against the live endpoint: identical text sent with `sourceLanguage: 'auto'` came back untranslated; the same text with an explicit source language translated correctly every time. Prism already detects each page's real language via `tabs.detectLanguage` (built for the auto-translate-on-load decision) — that detected language is now what actually gets sent to the provider, instead of the literal `'auto'`, falling back to `'auto'` only when detection is unavailable. This is layered on top of the previous release's single-item-piece padding fix, which addressed a real but different part of the same symptom — on a real repro page, this closed the majority of what padding alone left broken (291/293 sampled text nodes translated, up from 130/322).

Not a repeat of an earlier fixed bug where a manually-picked source language got persisted and forced onto every future request forever: this uses a language freshly redetected from the current page's own real content on every load, never persisted across page loads or sessions, and a manual "From" picker choice still takes precedence when set.

Known residual risk, not addressed here: Google's endpoint can reflow translated content across piece boundaries for some inputs (already documented), which combined with the previous release's padding-trim logic can occasionally drop a trailing word from a short mixed-language string (e.g. a product name). This existed before this change; it's simply exercised more often now that more pieces actually attempt translation instead of silently no-op'ing. Tracked as a separate follow-up, not fixed in this release.
