# Prism (Gen 3)

A browser extension that translates web pages in place (Chrome, Firefox,
Safari on Mac and iPhone). A ground-up rewrite of the Prism AI Page
Translator, built in a new repository with zero code/naming reuse from its
predecessors.

- What's next and the rules for changes: [docs/reports/fix-plan.md](docs/reports/fix-plan.md) ("The plan from here")
- Plain-language overview: [docs/reports/where-prism-stands.md](docs/reports/where-prism-stands.md)
- How the repo is organized: `CLAUDE.md`

## Development

```sh
npm install
npm run dev            # Chrome, with hot reload
npm run dev:firefox    # Firefox
```

## Testing

These are the checks CI runs, in order:

```sh
npm run compile                 # tsc --noEmit
npm run lint                    # Biome
npm run guard:engine-purity     # fails if src/engine/ or src/shared/ import chrome/browser/WXT
npm run guard:solid-reactivity  # fails on non-reactive configStore reads inside JSX
npm run test:coverage           # vitest + coverage gate
npm run build                   # production build (Chrome)
npm run guard:bundle-size       # fails if the build grows past the size limit
npm run test:e2e                # loads the built extension in real Chromium
npm run test:replay             # replays saved real pages with recorded Google answers
```

## Releasing

Every merge to `main` with a new version in `package.json` publishes a
GitHub Release with the Chrome zip and the Firefox add-on. The release is
refused unless that version's changelog entry has a
`Checked on: <page>, <browser>, <date>` line, recording the real-page check.
