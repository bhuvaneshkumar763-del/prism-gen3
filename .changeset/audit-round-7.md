---
"prism-gen3": patch
---

Audit round 7: triage of an external audit report against beta.64. Every claim was re-verified against source before any code was touched — the report was accurate about the code but wrong about severity in two places and wrong about one of the fixes.

**Real defects fixed:**

- **A paragraph straddling the 300-node per-tick boundary was translated as two context-free fragments — on the default provider.** The tick slices the queue *before* grouping runs, and grouping keeps no state across calls, so a block split across that cut lost exactly the sentence context grouping exists to preserve. Reproduced directly (`[['Alpha '], ['beta', ' gamma']]`). The straddling block's trailing nodes are now pushed back to the next tick. Guarded so a single block larger than one tick still splits rather than trimming the batch to empty and translating nothing forever — verified by removing the guard and watching a page hang.
- **Hover-to-see-original was blind to every open shadow root** — the exact content shadow support was added for. The browser retargets `event.target` to the shadow host, while the lookup matches on `parentElement`, so a Bilibili-style comment widget translated fine and then showed nothing on hover. Both hover handlers now resolve through `composedPath()`. Fixing only `mouseover` (as the report suggested) introduces a new bug: the tooltip never hides again.
- **`aria-label` was never translated**, leaving screen-reader users with source-language chrome on an otherwise translated page. Added — and the MutationObserver's attribute filter now derives from a single shared tuple, closing a silent-drift hazard where adding an attribute and forgetting that filter compiled cleanly while ignoring every later change to it.
- **An always/never-translate rule silently never fired on the other of `www.`/apex.** A rule saved as `example.com` did nothing on `www.example.com`, while the options page kept showing it as active. Three separate copies of that comparison existed — the decision and both per-site toggles — so all three now share one helper; fixing only the decision would have left the toggles reading OFF while auto-translate fired. Scoped to `www.` only: an apex rule deliberately does not cover `docs.example.com`.

**Speed:**

- The hover tooltip rebuilt its entire Solid root on every `mousemove` while visible. Now rendered once and updated through a signal.

**Documentation (the report's lowest-ranked item, and the most valuable):**

- Three files that this project's own instructions point every contributor at first had drifted into contradicting the code: the page-translation loop's header claimed attributes were untranslated (28 lines below its own attribute-translator import); the known-gaps doc claimed the same-origin iframe language relay was unbuilt and described the tick-grouping gap with the wrong number and the wrong provider; the status doc described five translation providers, two of which were deleted post-launch. All corrected.
- Found alongside it: 14 of 16 internal skill descriptions were truncated mid-sentence fragments left by an earlier extraction, which is the signal used to decide whether to load them at all.

**Deliberately not treated as a defect:** the selection popup's close button lacking a synthetic-click guard. A page can dismiss a popup; it owns the document anyway. The equivalent guard on *translate* exists because a synthetic click there spends the user's API quota. Landed as a one-line consistency tidy, labelled as such in the code.

**Still open, unchanged:** the LLM provider's CORS/prompt-injection round, and the DOM double-walk. Newly logged for a live probe rather than a blind fix: the Google provider sends a doubled `application/application/json+protobuf` content type, which the endpoint evidently tolerates today.
