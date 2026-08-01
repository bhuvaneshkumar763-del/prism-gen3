import { defineConfig } from 'vitest/config';

// Gen 3 plan, design principle #2: coverage is a CI gate from Session 1,
// not backfilled after the fact. Scoped to src/engine/, src/shared/, and
// (as of Session 3, once there was real logic in it) src/platform/ —
// extension-UI coverage (entrypoints/) is allowed to lag legitimately
// (documented carve-out, not a silent gap; see the plan). src/platform/ is
// where the old repo's own shipped config-store bug lived — worth the same
// bar as the engine, even though it's allowed real chrome/browser imports.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/shared/**/*.ts', 'src/platform/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/README.md'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
