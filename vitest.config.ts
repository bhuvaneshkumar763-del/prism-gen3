import { defineConfig } from 'vitest/config';

// Gen 3 plan, design principle #2: coverage is a CI gate from Session 1,
// not backfilled after the fact. Scoped to src/engine/ and src/shared/ on
// purpose — extension-UI coverage (entrypoints/) is allowed to lag
// legitimately (documented carve-out, not a silent gap; see the plan).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts', 'src/shared/**/*.ts'],
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
