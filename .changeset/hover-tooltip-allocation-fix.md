---
"prism-gen3": patch
---

Speed fix (round-4 audit, item 10, the last item in this round): the hover-to-see-original tooltip allocated a fresh N-object array on every single `mousemove` event while visible. `mountHoverTooltip.ts`'s `onMouseMove` called `pageTranslator.getTranslatedNodes()` — `Array.from(nodesToRestore, ([node, original]) => ({ node, original }))`, one new object per currently-translated node — then linear-scanned the result to find the node under the cursor. On a page with a few thousand translated nodes at ~120 mousemove events/s while hovering, that's on the order of 100k+ short-lived allocations per second: real, measurable jank while hovering translated text.

Added `findOriginalTextForElement(target)` directly to `PageTranslator`, doing the identical scan over `nodesToRestore` in place — no array, no per-entry wrapper object, just the Map's own iteration. `onMouseMove` now calls this instead. `getTranslatedNodes()` itself is unchanged and still used by `onMouseOver`, which only fires once per hovered element — negligible frequency by comparison, not worth touching.
