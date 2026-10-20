import { defineConfig, devices } from '@playwright/test'
import { repositoryRoot } from './e2e/database'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/setup.ts',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm dev:api',
      cwd: repositoryRoot,
      url: 'http://localhost:8080',
      reuseExistingServer: true,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGINT', timeout: 5_000 },
    },
    {
      command: 'pnpm dev:web',
      cwd: repositoryRoot,
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGINT', timeout: 5_000 },
    },
  ],
})
