---
"prism-gen3": patch
---

Speed and reliability fix (round-4 audit, item 6): `attributeTranslator.ts` (added in beta.38 to translate `placeholder`/`alt`/`value`/`title`) never inherited the lifecycle discipline the rest of the page translator already has. Three related fixes, all in one file:

- The mutation observer called `translateTargets()` once per callback with no debounce, coalescing, or cap — on a virtualized/infinite-scroll feed (diagnosed live on X.com) this could fire many unthrottled, fully concurrent HTTP requests at once. Mutations arriving while a translate is already in flight are now coalesced into a pending batch and drained by that same in-flight call finishing, so at most one attribute-translate request from this module is ever in flight at a time.
- `originals` (needed for `restore()`, so it must stay enumerable) and `lastWritten` (a pure loop-guard lookup, never enumerated) both pinned every translated element — and its whole detached subtree — for the rest of the page's life, growing monotonically with scroll distance on a long-lived page. `lastWritten` is now a `WeakMap`; `originals` gets the same two-consecutive-resweep-tick pruning `translateLoop.ts` already uses for its own `nodesToRestore`, wired into the same `onResweep` call.
- `start()` awaited its initial translate request before installing the mutation observer unconditionally — a `restore()` (or a fast re-translate) landing during that await was silently undone the instant the network call resolved, and the observer kept shipping attribute text to the provider after the user had already asked for the original page back. Now guarded by a generation counter, the same pattern `translateLoop.ts` already uses for its own async races.
