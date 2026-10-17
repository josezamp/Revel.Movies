import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: 'http://localhost:5175', headless: true, viewport: { width: 1280, height: 720 } },
  webServer: [
    { command: 'dotnet run --project ../api/RevelMovies.BrowserTests', url: 'http://localhost:65180/health', timeout: 120000 },
    { command: 'npm run dev -- --host localhost --port 5175 --strictPort', url: 'http://localhost:5175', env: { VITE_API_PROXY_TARGET: 'http://localhost:65180' } },
  ],
})
