import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { globals: true, environment: 'node', include: ['test/**/*.test.ts'], env: { TZ: 'America/Los_Angeles' } } })
