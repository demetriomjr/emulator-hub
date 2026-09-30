import { defineConfig } from '@playwright/test'
import { join } from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  testIgnore: process.env.E2E_FAULT_FLUSH_PROFILE ? [] : ['fault-recovery.spec.mjs'],
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  outputDir: process.env.E2E_ARTIFACT_DIR ? join(process.env.E2E_ARTIFACT_DIR, 'playwright') : 'test-results/artifacts',
  use: {
    baseURL: process.env.E2E_BASE_URL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
