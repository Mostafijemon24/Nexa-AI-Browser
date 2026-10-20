import { defineConfig } from 'vitest/config'

/**
 * RC-1 runtime harness only. Deliberately not the default vitest include
 * (`tests/unit/**`), so `npm test` keeps the existing 746-test count.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rc1/**/*.test.ts'],
    fileParallelism: false
  }
})
