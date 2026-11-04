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
      include: ['src/engine/**/*.ts', 'src/shared/**/*.ts', 'src/platform/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/README.md', 'src/**/testing/**'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
        'src/engine/**': { statements: 95, branches: 88, functions: 95, lines: 96 },
        'src/platform/**': { statements: 94, branches: 85, functions: 90, lines: 95 },
        'src/shared/**': { statements: 95, branches: 90, functions: 95, lines: 96 },
      },
    },
  },
});
