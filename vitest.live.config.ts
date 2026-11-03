import { defineConfig } from 'vitest/config';

// Live tests call real services; kept out of the normal test run.
export default defineConfig({
  test: {
    include: ['tests/live/**/*.live.test.ts'],
    environment: 'node',
  },
});
