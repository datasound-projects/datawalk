import { defineConfig } from '@playwright/test'

// Each spec gets its own demo server (e2e/serve.py), so editor saves never leak into
// the read-only walkthrough. Build the viewer first: npm run build.
const server = (port: number, report = '') => ({
  command: `uv run python apps/web/e2e/serve.py ${port} ${report}`,
  cwd: '../..',
  url: `http://127.0.0.1:${port}/api/report`,
  timeout: 120_000,
  reuseExistingServer: false,
})

// Local runs use the installed Chrome; CI installs Playwright's Chromium.
const chrome = process.env.CI ? {} : { channel: 'chrome' }

// CI runners have no GPU: WebGL renders in software, at a few frames per second.
const slow = !!process.env.CI

export default defineConfig({
  testDir: 'e2e',
  timeout: slow ? 300_000 : 120_000,
  expect: { timeout: slow ? 20_000 : 5_000 },
  workers: 1, // headless WebGL is software-rendered; parallel runs starve each other
  use: {
    viewport: { width: 1280, height: 800 },
    locale: 'en-US', // the viewer follows the browser language; the tests read English text
  },
  webServer: [
    server(8766),
    server(8767),
    server(8768, 'notebook'),
    server(8769, 'sources'),
    { command: 'uv run python apps/web/e2e/hub_serve.py 8770', cwd: '../..', url: 'http://127.0.0.1:8770/login', timeout: 120_000, reuseExistingServer: false },
  ],
  projects: [
    { name: 'viewer', testMatch: ['walkthrough.spec.ts', 'doors.spec.ts', 'themes.spec.ts', 'flat.spec.ts', 'tour.spec.ts', 'fidelity.spec.ts'], use: { ...chrome, baseURL: 'http://127.0.0.1:8766' } },
    { name: 'editor', testMatch: 'editor.spec.ts', use: { ...chrome, baseURL: 'http://127.0.0.1:8767' } },
    { name: 'export', testMatch: 'export.spec.ts', use: chrome }, // file:// and a routed stand-in host
    // The exports must open in every current browser engine: Firefox, and WebKit (Safari).
    { name: 'export-firefox', testMatch: 'export.spec.ts', use: { browserName: 'firefox' } },
    { name: 'export-webkit', testMatch: 'export.spec.ts', use: { browserName: 'webkit' } },
    { name: 'notebook', testMatch: 'notebook.spec.ts', use: { ...chrome, baseURL: 'http://127.0.0.1:8768' } },
    { name: 'sources', testMatch: 'sources.spec.ts', use: { ...chrome, baseURL: 'http://127.0.0.1:8769' } },
    { name: 'hub', testMatch: 'hub.spec.ts', use: { ...chrome, baseURL: 'http://127.0.0.1:8770' } },
  ],
})
