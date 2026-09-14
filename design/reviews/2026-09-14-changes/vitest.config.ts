import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['design/reviews/2026-09-14-changes/*.probe.test.ts'],
    environment: 'node',
  },
})
