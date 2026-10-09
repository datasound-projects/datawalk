import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, type Page, test } from './fixtures'

// Exports must work for a recipient without Python and without network: the single HTML
// file opens from disk with zero requests, the static site loads only its own files.
const ROOT = path.resolve(import.meta.dirname, '../../..')
let out = ''

test.beforeAll(() => {
  out = mkdtempSync(path.join(tmpdir(), 'datawalk-export-'))
  execFileSync('uv', ['run', 'python', 'apps/web/e2e/export.py', out], { cwd: ROOT, stdio: 'inherit' })
})

type Win = {
  datawalkRenderer?: { info: () => { render: { calls: number } } }
  datawalk: {
    getState: () => {
      gpu: { webgl: boolean }
      report: { visualizations: { id: string; key: string; source: { has_payload: boolean } }[] }
      inspect: (id: string) => void
    }
  }
}

/** Track every request; problems are console errors and anything that leaves `allowed`. */
function watch(page: Page, allowed: (url: string) => boolean) {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', (r) => !allowed(r.url()) && requests.push(r.url()))
  page.on('console', (m) => m.type() === 'error' && !/Pointer Lock/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return { requests, errors }
}

/** Enter the 3D room; a browser without WebGL (Firefox on Linux CI) shows the page view. */
async function enterOrRead(page: Page) {
  const webgl = await page.evaluate(() => (window as unknown as Win).datawalk.getState().gpu.webgl)
  if (!webgl) return expect(page.locator('.flat .flat-chart').first()).toBeVisible({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Enter room' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).datawalkRenderer?.info().render.calls ?? 0), { timeout: 90_000 })
    .toBeGreaterThan(40)
}

async function walkThrough(page: Page) {
  await expect(page.getByText('Exported copy · revision')).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.watermark').first()).toContainText('E2E copy')
  await enterOrRead(page)
  // The interactive chart renders with Plotly; the reduced chart has no data.
  const viz = await page.evaluate(() => (window as unknown as Win).datawalk.getState().report.visualizations)
  expect(viz.find((v) => v.key === 'returns_dist')?.source.has_payload).toBe(false)
  await page.evaluate((id) => (window as unknown as Win).datawalk.getState().inspect(id), viz.find((v) => v.key === 'price')!.id)
  await expect(page.locator('.inspector .js-plotly-plot')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Daily market data' })).toHaveAttribute('download', 'market_daily.csv')
}

test('single HTML file opens offline without any request', async ({ page }) => {
  test.setTimeout(240_000)
  const file = pathToFileURL(path.join(out, 'report.html')).href
  const { requests, errors } = watch(page, (u) => u.startsWith(file) || u.startsWith('data:') || u.startsWith('blob:'))
  await page.route(/^https?:/, (r) => r.abort())
  await page.goto(`${file}?view=3d`) // 3D also on a software GPU (CI)
  await walkThrough(page)
  const csv = await page.getByRole('link', { name: 'Daily market data' }).getAttribute('href')
  expect(csv).toMatch(/^data:text\/csv;base64,/)
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})

test('lite single file (no chart libraries) opens offline and draws the room', async ({ page }) => {
  test.setTimeout(180_000)
  const file = pathToFileURL(path.join(out, 'lite.html')).href
  const { requests, errors } = watch(page, (u) => u.startsWith(file) || u.startsWith('data:') || u.startsWith('blob:'))
  await page.route(/^https?:/, (r) => r.abort())
  await page.goto(`${file}?view=3d`) // 3D also on a software GPU (CI)
  await page.waitForFunction(() => !!(window as unknown as Win).datawalk?.getState().report, null, { timeout: 60_000 })
  await enterOrRead(page)
  const html = readFileSync(path.join(out, 'lite.html'), 'utf8')
  expect(html.length).toBeLessThan(15 * 2 ** 20)
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})

test('static site loads only its own files', async ({ page }) => {
  test.setTimeout(240_000)
  const host = 'http://export.test/'
  const { requests, errors } = watch(page, (u) => u.startsWith(host) || u.startsWith('data:') || u.startsWith('blob:'))
  // A stand-in static host: serve files from the export folder, refuse everything else.
  await page.route('**/*', async (r) => {
    const url = new URL(r.request().url())
    // WebKit routes blob: URLs too (textures, workers): they never leave the browser.
    if (/^(blob|data):/.test(r.request().url())) return r.continue()
    if (!r.request().url().startsWith(host)) return r.abort()
    const rel = decodeURIComponent(url.pathname.slice(1)) || 'index.html'
    try {
      await r.fulfill({ body: readFileSync(path.join(out, 'site', rel)), contentType: type(rel) })
    } catch {
      await r.fulfill({ status: 404 })
    }
  })
  await page.goto(`${host}?view=3d`)
  await walkThrough(page)
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})

function type(rel: string) {
  const ext = path.extname(rel)
  return (
    { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.csv': 'text/csv' }[ext] ??
    'application/octet-stream'
  )
}
