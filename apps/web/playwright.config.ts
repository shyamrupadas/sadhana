import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command:
      'VITE_API_BASE_URL=/test-api pnpm exec vite --mode test --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
})
