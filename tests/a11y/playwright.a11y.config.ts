import { defineConfig, devices } from '@playwright/test'

/**
 * Accessibility audit: WCAG AA compliance at mobile (320, 768, 1024) and desktop (1440).
 * Run: pnpm exec playwright test --config=tests/a11y/playwright.a11y.config.ts
 * Requires app running at http://localhost:3000
 */
export default defineConfig({
  testDir: '.', // Current directory (tests/a11y)
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: 'test-results/a11y-results.json' }]],
  use: {
    baseURL: 'http://localhost:3000',
    locale: 'fr-FR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-320', use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 812 }, hasTouch: true } },
    { name: 'tablet-768', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'tablet-1024', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
})
