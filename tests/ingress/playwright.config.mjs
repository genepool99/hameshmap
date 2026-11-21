// SIMULATED Ingress browser tests. See run.sh and docs/testing/test-plan.md.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs/,
  // One application instance with one account database is shared by all tests.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: process.env.PW_OUTPUT_DIR || '/artifacts/playwright',
  reporter: [['list'], ['json', { outputFile: (process.env.PW_OUTPUT_DIR || '/artifacts/playwright') + '/report.json' }]],
  use: {
    baseURL: process.env.GATEWAY_URL || 'http://ha:8123',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'en-GB',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
