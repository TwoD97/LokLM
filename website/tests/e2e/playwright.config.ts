import { defineConfig, devices } from '@playwright/test'

// e2e config for the marketing site. astro preview is started automatically
// before tests run; reused if it is already up.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: '.playwright-report' }]]
    : [['list']],
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  // astro preview serves dist/ as-is; we build first so the server reflects
  // current src. on CI the ci script builds explicitly and we skip rebuilding
  // here to keep test runs fast.
  webServer: {
    command: process.env.CI
      ? 'pnpm preview --host 127.0.0.1 --port 4321'
      : 'pnpm build && pnpm preview --host 127.0.0.1 --port 4321',
    url: 'http://127.0.0.1:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  outputDir: 'test-results',
})
