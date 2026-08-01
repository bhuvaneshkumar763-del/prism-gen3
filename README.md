# Prism (Gen 3)

A ground-up rewrite of the Prism AI Page Translator browser extension —
built in a new repository with zero code/naming reuse from its
predecessors. See `CLAUDE.md` for how this repo is organized and why, and
the plan file referenced there for the full multi-session build-out.

## Development

```sh
npm install
npm run dev            # Chrome, with hot reload
```

## Testing

```sh
npm run compile          # tsc --noEmit
npm run guard:engine-purity   # fails if src/engine/ or src/shared/ import chrome/browser/WXT
npm run test:coverage    # vitest + coverage gate (90%+ on src/engine/, src/shared/)
npm run build            # production build
npm run lint              # Biome — not yet a CI gate, see CLAUDE.md
```
