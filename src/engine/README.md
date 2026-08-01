# `src/engine/`

The core translation engine. **Zero imports of `chrome`/`browser` APIs or
any WXT/framework-specific module are allowed here** — this is enforced by
CI (`npm run guard:engine-purity`, see `scripts/check-engine-purity.mjs`),
not just a convention.

Standard Web APIs (e.g. `MutationObserver`, `fetch`, `IndexedDB`) are fine
— the boundary is specifically about browser-*extension* APIs and this
project's own UI framework, not the web platform in general. The point is
that this code should be usable, unmodified, by something that isn't this
exact WXT extension later (a different extension shell, a future mobile
app, a non-extension surface) without a rewrite.

Anything the engine needs from the browser-extension world (storage,
messaging, tab info, ...) is expressed as a TypeScript interface ("port")
here, and implemented by an adapter in `src/platform/`. The engine never
imports the adapter directly — it's injected.

See `/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md`
(Gen 3 plan, design principle #3) for the full reasoning.
