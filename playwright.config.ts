import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './browser-tests',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3000', viewport: {width:390,height:844}, trace: 'retain-on-failure' },
  reporter: 'list',
  outputDir: 'test-results',
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI },
});
