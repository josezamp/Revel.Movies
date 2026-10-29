import { defineConfig } from '@playwright/test'

const apiPort = process.env.REVEL_BROWSER_API_PORT || '65180'
const webPort = process.env.REVEL_BROWSER_WEB_PORT || '5175'

export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  use: { baseURL: `http://localhost:${webPort}`, headless: true, viewport: { width: 1280, height: 720 } },
  webServer: [
    { command: 'dotnet run --project ../api/RevelMovies.BrowserTests', url: `http://localhost:${apiPort}/health`, timeout: 120000 },
    { command: `npm run dev -- --host localhost --port ${webPort} --strictPort`, url: `http://localhost:${webPort}`, env: { VITE_API_PROXY_TARGET: `http://localhost:${apiPort}` } },
  ],
})
