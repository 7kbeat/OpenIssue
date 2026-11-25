import { defineConfig } from '@playwright/test';

const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    trace: 'retain-on-failure',
    ...(channel ? { channel } : {}),
  },
});
