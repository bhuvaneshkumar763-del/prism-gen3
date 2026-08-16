---
"prism-gen3": minor
---

Post-launch audit pass covering correctness, speed, accuracy, and reliability across the whole codebase, with particular focus on the free Google provider:

- **Translation correctness**: fixed several Google-provider bugs — a "did the provider actually translate this?" safety check that was silently disabled specifically for Google, punctuation that could be dropped at the start of a translated sentence, and an auth-key refresh delay that was 4x longer than intended on failure.
- **Code samples and opt-outs**: `<pre>`/`<code>` blocks are no longer sent to the translation provider (they were coming back reworded and broken), and the standard `translate="no"`/`.notranslate` opt-out attributes are now honored, matching every other translation tool.
- **Reliability**: fixed a bug where a single momentary settings-load failure could permanently disable the extension until restart; fixed the translation cache's size tracking so it can't drift and evict valid entries; fixed context-menu re-registration errors that were silently spamming the extension's error log on every background wake-up; capped a slow (not down) translation provider's retry sequence to ~30 seconds instead of a possible ~62-second worst case.
- **Speed**: batched the translation cache's per-tick reads/writes into single database transactions instead of one per piece; made the "translate what's visible first" reordering only re-measure the page when something actually changed (scrolling, new content) instead of every single tick on long pages.
- **UI fixes**: site rules typed with mixed case or pasted as a full URL (e.g. "BBC.com") now correctly match; pasting a comma-separated list of sites now adds them all instead of one broken entry; the settings page now shows a real error if a setting fails to save instead of silently reverting; the popup no longer shows a stale "Translated" status when a translation actually failed in the background; the hover-to-see-original tooltip now actually follows the cursor as documented.

Also hardened both CI guard scripts (the Solid-reactivity and engine-purity checks) to close real gaps that let the exact bug classes they exist to catch slip through undetected.
