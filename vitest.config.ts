import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

// solid() compiles .tsx for tests only; the extension build gets Solid from
// @wxt-dev/module-solid. Coverage is gated per folder, a little under
// today's figures, so a folder that loses coverage fails CI.
export default defineConfig({
  plugins: [solid()],
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
      'entrypoints/**/*.test.ts',
      'entrypoints/**/*.test.tsx',
      'scripts/**/*.test.mjs',
    ],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/engine/**/*.ts',
        'src/shared/**/*.ts',
        'src/platform/**/*.ts',
        'components/**/*.{ts,tsx}',
        'entrypoints/lib/**/*.ts',
      ],
      // entrypoints/ outside lib/ is wiring checked by the e2e run, not unit tests.
      exclude: ['**/*.test.ts', '**/*.test.tsx', 'src/**/README.md', 'src/**/testing/**'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
        'src/engine/**': { statements: 95, branches: 88, functions: 95, lines: 96 },
        'src/platform/**': { statements: 94, branches: 85, functions: 90, lines: 95 },
        'src/shared/**': { statements: 95, branches: 90, functions: 95, lines: 96 },
        'components/bubble/**': { statements: 85, branches: 78, functions: 82, lines: 86 },
        'components/selection/**': { statements: 90, branches: 80, functions: 91, lines: 96 },
        'components/hoverTooltip/**': { statements: 94, branches: 79, functions: 93, lines: 97 },
        'components/options/**': { statements: 85, branches: 63, functions: 90, lines: 81 },
        'entrypoints/lib/**': { statements: 98, branches: 95, functions: 92, lines: 98 },
      },
    },
  },
});
