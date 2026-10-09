import { expect, test } from './fixtures'
import { startIn } from './helpers'

type Win = {
  datawalkRenderer?: { info: () => { render: { calls: number } } }
  datawalkFlatReady?: boolean
  datawalk: { getState: () => { report: { visualizations: { id: string; key: string }[] }; inspect: (id: string) => void } }
}

const inspect = async (page: import('@playwright/test').Page, key: string) =>
  page.evaluate((k) => {
    const s = (window as unknown as Win).datawalk.getState()
    s.inspect(s.report.visualizations.find((v) => v.key === k)!.id)
  }, key)

// Altair (Vega-Lite), Bokeh (BokehJS from the bokeh package), Styler, files, MLflow, PDF pages.
test('other sources render on the walls and in the inspector', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && !/Pointer Lock/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto('/')
  await startIn(page, 'Libraries')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Win).datawalkRenderer?.info().render.calls ?? 0), { timeout: 90_000 })
    .toBeGreaterThan(40)

  await inspect(page, 'bokeh_latency')
  const bokeh = page.getByRole('dialog', { name: 'Response Time (Bokeh)' })
  await expect(bokeh.locator('.bokeh-host canvas, .bokeh-host .bk-Figure, .bokeh-host [class*="bk-"]').first()).toBeVisible({ timeout: 30_000 })
  await bokeh.getByRole('button', { name: 'Back to room' }).click()

  await inspect(page, 'styler')
  await expect(page.getByRole('dialog', { name: 'Regional Growth (Styler)' }).locator('table')).toContainText('North')
  await page.keyboard.press('Escape')

  // The flat view draws every source as an image (and Vega-Lite / Bokeh interactively).
  await page.goto('/?view=flat')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalkFlatReady), { timeout: 90_000 }).toBe(true)
  for (const name of ['Orders per Week (Altair)', 'Response Time (Bokeh)', 'Error distribution', 'Sales', 'bi_export – page 1', 'Loss']) {
    await expect(page.locator('main')).toContainText(name)
  }
  const broken = await page.evaluate(() => [...document.querySelectorAll('main img')].filter((i) => !(i as HTMLImageElement).naturalWidth).length)
  expect(broken).toBe(0)
  await expect(page.locator('#viz-agenda')).toContainText('Orders and latency')
  expect(errors).toEqual([])
})
