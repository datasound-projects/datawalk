import { expect, test } from './fixtures'
import { aimAt, startIn, state } from './helpers'

test('stakeholder walkthrough: enter, walk, inspect, map, navigate rooms', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Financial Market Research' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit report' })).toHaveCount(0) // no token: read-only
  await startIn(page, 'Market Overview')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await expect.poll(async () => (await state(page)).overlay).toBe(null)
  await expect(page.locator('.hud-title')).toContainText('Market Overview')

  await aimAt(page, 'price')
  await expect(page.locator('.hud-hint')).toContainText('Historical Price')

  // Inspect the interactive Plotly figure and return.
  await page.keyboard.press('e')
  const inspector = page.getByRole('dialog', { name: 'Historical Price' })
  await expect(inspector.locator('.plotly-host .main-svg').first()).toBeVisible()
  await expect(inspector.getByText('✓ Zoom and pan')).toBeVisible()
  // Linked view: the three time series that share dates, zoom one and all follow.
  await inspector.getByRole('tab', { name: /Linked view/ }).click()
  const linked = inspector.locator('.linked-chart')
  await expect(linked).toHaveCount(3)
  await expect(linked.nth(2).locator('.main-svg').first()).toBeVisible({ timeout: 30_000 })
  await expect(inspector.getByText('(extracted data)').first()).toBeVisible()
  // Drag-zoom an x range on the first chart: the others take the same range.
  const drag = linked.nth(0).locator('.nsewdrag').first()
  const box = (await drag.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 })
  await page.mouse.up()
  const ranges = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.linked-chart')].map((el) => String((el as unknown as { _fullLayout: { xaxis: { range: unknown[] } } })._fullLayout.xaxis.range)),
    )
  await expect.poll(async () => new Set(await ranges()).size, { timeout: 15_000 }).toBe(1)
  await inspector.getByRole('button', { name: 'Back to room' }).click()
  await expect.poll(async () => (await state(page)).overlay).toBe(null)

  // Map: teleport in front of a chart.
  await page.keyboard.press('m')
  await page.getByRole('dialog', { name: 'Room map' }).getByRole('button', { name: 'Rolling Volatility' }).click()
  await expect.poll(async () => (await state(page)).focused, { timeout: 10_000 }).toBe('volatility')

  // Native 3D exhibit: aim at points and read exact values.
  await page.keyboard.press('Tab')
  await page.getByRole('dialog', { name: 'Report navigator' }).getByRole('button', { name: 'Feature Engineering' }).click()
  await page.keyboard.press('m')
  await page.getByRole('dialog', { name: 'Room map' }).getByRole('button', { name: 'PCA of Features (3D)' }).click()
  await expect.poll(async () => (await state(page)).focused, { timeout: 10_000 }).toBe('pca_3d')
  // The teleport faces the exhibit's center; the readout uses the original units and names.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { datawalk: { getState: () => { pointInfo: string | null } } }).datawalk.getState().pointInfo), {
      timeout: 10_000,
    })
    .toMatch(/^next_day_up = [01] · PC1 = -?[\d.e+-]+, PC2 = -?[\d.e+-]+, PC3 = -?[\d.e+-]+$/)
  await expect(page.locator('.point-info')).toBeVisible()

  // Navigator: change room, then open a chart directly.
  await page.keyboard.press('Tab')
  const nav = page.getByRole('dialog', { name: 'Report navigator' })
  await nav.getByRole('button', { name: 'Feature Engineering' }).click()
  await expect.poll(async () => (await state(page)).room).toBe('Feature Engineering')
  await page.keyboard.press('Tab')
  await nav.getByRole('button', { name: 'Feature Correlations' }).click()
  const heatmap = page.getByRole('dialog', { name: 'Feature Correlations' })
  await expect(heatmap.getByText('Image only: data values are not available')).toBeVisible()
  await expect(heatmap.getByText(/Not extracted, see the preview image/)).toBeVisible()
  await expect(heatmap.locator('img')).toHaveJSProperty('naturalWidth', 1800)

  // KPI and table inspectors show exact values. Esc from the inspector pauses (the lobby,
  // where Tab moves the focus); Resume walks again, and Tab opens the navigator.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(nav).toHaveCount(0)
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.keyboard.press('Tab')
  await nav.getByRole('button', { name: 'Final Price' }).first().click() // also on the summary KPI wall
  await expect(page.getByRole('dialog', { name: 'Final Price' }).getByText(/Exact value:/)).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Resume' }).click()
  await page.keyboard.press('Tab')
  await nav.getByRole('button', { name: 'Model Metrics' }).click()
  await expect(page.getByRole('dialog', { name: 'Model Metrics' }).getByRole('cell', { name: 'Gradient boosting' })).toBeVisible()

  // Esc from the inspector pauses; Resume continues walking.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect.poll(async () => (await state(page)).overlay).toBe(null)
})
