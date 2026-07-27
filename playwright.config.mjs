import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './scripts/__tests__/browser',
  outputDir: '.playwright/test-results',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: 'line',
  use: {
    headless: true,
    locale: 'en-US',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
    },
  ],
});
