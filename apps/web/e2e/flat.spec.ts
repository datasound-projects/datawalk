import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './fixtures'

type Win = { datawalkFlatReady?: boolean; datawalk: { getState: () => { roomId: string; report: { rooms: { id: string; name: string }[] } } } }

test('flat view: contents, deep links, keyboard, and the way back to 3D', async ({ page }) => {
  await page.goto('/?view=flat#viz-roc')
  await expect(page.getByRole('heading', { level: 1, name: 'Financial Market Research' })).toBeVisible()
  const toc = page.getByRole('navigation', { name: 'Contents' })
  await expect(toc.getByRole('link', { name: 'Market Overview' })).toBeVisible()
  // The deep link lands on its chart, in its room.
  await expect(page.locator('#viz-roc')).toBeInViewport()
  const roomName = () => page.evaluate(() => {
    const s = (window as unknown as Win).datawalk.getState()
    return s.report.rooms.find((r) => r.id === s.roomId)?.name
  })
  expect(await roomName()).toBe('Model Evaluation')
  // Exact values as text, not only as pictures.
  await expect(page.locator('#viz-kpi_dd')).toContainText('-41.2%')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalkFlatReady), { timeout: 60_000 }).toBe(true)
  // Back to 3D in the room that was in view.
  await toc.getByRole('link', { name: 'Feature Engineering' }).click()
  await expect.poll(roomName).toBe('Feature Engineering')
  await page.getByRole('button', { name: 'Walk in 3D' }).click()
  await expect(page.getByRole('button', { name: 'Enter room' })).toBeVisible()
  await expect(page.getByText('now in Feature Engineering')).toBeVisible()
  await page.getByRole('button', { name: 'Flat view' }).click()
  await expect(page.locator('#room-feature-engineering, [data-room]').first()).toBeVisible()
})

test('flat view meets WCAG 2.2 AA (axe) and works from the keyboard', async ({ page }) => {
  await page.goto('/?view=flat')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  // The first Tab reaches the skip link, which moves focus to the content.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#flat-main')).toBeFocused()
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalkFlatReady), { timeout: 60_000 }).toBe(true)
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(result.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
})

test('without WebGL the viewer opens the flat view', async ({ page }) => {
  await page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      return /webgl/.test(type) ? null : get.call(this, type as '2d', ...(rest as []))
    } as typeof get
  })
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Contents' })).toBeVisible()
  await expect(page.getByText('3D rooms need WebGL')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Walk in 3D' })).toHaveCount(0)
})
