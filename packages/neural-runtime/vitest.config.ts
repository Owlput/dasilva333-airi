import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Heavyweight model loads: strictly sequential, generous timeouts.
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 1_200_000,
    hookTimeout: 300_000,
  },
})
