# `src/shared/`

Types and schemas usable by both `src/engine/` and `entrypoints/` (and by
`src/platform/` adapters). Same purity rule as `src/engine/` — no
`chrome`/`browser` imports here either, since `src/engine/` depends on this
directory and must stay clean transitively.
