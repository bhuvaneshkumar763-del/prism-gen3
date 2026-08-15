---
name: testing
description: Run before considering any Gen 3 change done:
---

# Testing

Run before considering any Gen 3 change done:
1. `npm run compile` (`tsc --noEmit`) — must be clean.
2. `npm run lint` (Session 9: now CI-gated) — must exit 0. Warnings are
   fine (2 pre-existing `noNonNullAssertion` ones as of this writing);
   errors are not.
3. `npm run guard:engine-purity` — must pass. If it doesn't, the fix is
   almost always "move this to `src/platform/` and inject it as a port,"
   not "add an exception to the script."
4. `npm run guard:solid-reactivity` (Session 8) — must pass. Fails if any
   `.tsx` under `entrypoints/`/`components/` reads `configStore.get(...)`
   directly inside JSX; mirror the value into a signal/store instead.
5. `npm run test:coverage` (Vitest + v8 coverage) — unit tests for
   `src/engine/`/`src/shared/` logic must pass AND meet the coverage
   thresholds in `vitest.config.ts`.
6. `npm run build` — must succeed.
7. `npm run guard:bundle-size` (Session 9) — must pass; requires step 6
   first.
8. `npm run test:e2e` (Session 9) — real-Chrome Playwright smoke test;
   requires step 6 first and a Chromium binary (`npx playwright install
   chromium` if you don't already have one cached).

All of steps 1-8 run in CI (`.github/workflows/ci.yml`) on every push to
`main` and every PR, in that order, followed by `npm run zip` and an
artifact upload. Releasing: `npm run changeset` to record a change,
`npm run version` to apply pending changesets (bumps `package.json`,
writes `CHANGELOG.md`) — once that lands on `main` and CI passes,
`.github/workflows/release.yml` takes over automatically.
