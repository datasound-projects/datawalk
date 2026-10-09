import { expect, test } from './fixtures'
import { startIn } from './helpers'

type Win = {
  datawalkRenderer?: { info: () => { render: { calls: number } } }
  datawalk: { getState: () => { report: { visualizations: { id: string; source: { library: string } }[] }; inspect: (id: string) => void } }
}

// A report imported from a notebook: Vega-Lite, SVG, Markdown, and the cell provenance.
test('imported notebook: rooms, Vega-Lite and SVG charts, provenance', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && !/Pointer Lock/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Retail Sales Analysis' })).toBeVisible({ timeout: 60_000 })
  await startIn(page, 'Forecast')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).datawalkRenderer?.info().render.calls ?? 0), { timeout: 90_000 })
    .toBeGreaterThan(40)
  const id = (lib: string) =>
    page.evaluate((l) => (window as unknown as Win).datawalk.getState().report.visualizations.find((v) => v.source.library === l)!.id, lib)

  await page.evaluate((v) => (window as unknown as Win).datawalk.getState().inspect(v), await id('vega-lite'))
  const inspector = page.getByRole('dialog', { name: 'Revenue Forecast' })
  await expect(inspector.locator('.vega-host svg').first()).toBeVisible({ timeout: 30_000 })
  await expect(inspector.getByText('Interactive: original Vega-Lite chart')).toBeVisible()
  await inspector.getByText('Show source').click()
  await expect(inspector.locator('.source-code')).toContainText('np.polyfit')
  await expect(inspector).toContainText(/Notebook: .*retail_analysis\.ipynb/)
  await inspector.getByRole('button', { name: 'Back to room' }).click()

  await page.evaluate((v) => (window as unknown as Win).datawalk.getState().inspect(v), await id('svg'))
  const svg = page.locator('.inspector img[src^="data:image/svg+xml"]')
  await expect(svg).toBeVisible()
  expect(await svg.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
