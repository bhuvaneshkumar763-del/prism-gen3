import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// Gen 3 plan, design principle #2: coverage is a CI gate from Session 1,
// not backfilled after the fact. Scoped to src/engine/, src/shared/, and
// (as of Session 3, once there was real logic in it) src/platform/ —
// extension-UI coverage (entrypoints/) is allowed to lag legitimately
// (documented carve-out, not a silent gap; see the plan). src/platform/ is
// where the old repo's own shipped config-store bug lived — worth the same
// bar as the engine, even though it's allowed real chrome/browser imports.
//
// The `solid()` plugin (Session 6) is needed only so .tsx test/component
// files compile under Vitest's own Vite instance — the real extension
// build gets Solid JSX support from `@wxt-dev/module-solid` instead
// (a separate Vite pipeline), so this is purely a test-time addition.
export default defineConfig({
  plugins: [solid()],
  test: {
    // components/ (Session 6: FloatingBubble.tsx) has real render/
    // interaction tests too, per the plan's Session 6 verification bar —
    // just not coverage-gated, same carve-out as entrypoints/.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'components/**/*.test.ts', 'components/**/*.test.tsx'],
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
