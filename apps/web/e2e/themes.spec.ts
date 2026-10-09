import { expect, type Page, test } from './fixtures'

const THEMES = ['executive_office', 'home_office', 'light_gallery', 'dark_gallery', 'industrial_loft', 'minimalist_studio', 'museum_atrium', 'futuristic_lab', 'metaverse_pavilion', 'data_command_center']

type Memory = { geometries: number; textures: number }
type Info = { render: { calls: number }; memory: Memory }
type Win = {
  datawalkRenderer: { info: () => Info }
  datawalk: { getState: () => { report: { rooms: { id: string }[] }; enterRoom: (r: string) => void } }
}
const info = (page: Page) => page.evaluate(() => (window as unknown as Win).datawalkRenderer.info())

test('every theme loads and renders without errors', async ({ page }) => {
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && !/Pointer Lock/.test(m.text()) && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  for (const id of THEMES) {
    await page.goto(`/?shot=${id}`)
    await page.waitForFunction(() => 'datawalkRenderer' in window, null, { timeout: 60_000 })
    // Models and textures arrive: draw calls grow well beyond the bare shell.
    await expect.poll(async () => (await info(page)).render.calls, { timeout: 60_000 }).toBeGreaterThan(40)
  }
  expect(errors).toEqual([])
})

test('repeated room changes do not leak GPU memory', async ({ page }) => {
  test.setTimeout(400_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await page.waitForFunction(() => 'datawalkRenderer' in window)
  const rooms = await page.evaluate(() => (window as unknown as Win).datawalk.getState().report.rooms.map((r) => r.id))
  const laps: Memory[][] = []
  for (let lap = 0; lap < 4; lap++) {
    laps.push([])
    for (const id of rooms) {
      await page.evaluate((r) => (window as unknown as Win).datawalk.getState().enterRoom(r), id)
      await page.waitForTimeout(5000)
      laps[lap].push({ ...(await info(page)).memory })
    }
  }
  // Lap 1 fills the caches. A leak grows from lap to lap: compare the warm laps 2 and 4.
  const max = (xs: Memory[], k: keyof Memory) => Math.max(...xs.map((x) => x[k]))
  expect(max(laps[3], 'geometries')).toBeLessThanOrEqual(max(laps[1], 'geometries'))
  expect(max(laps[3], 'textures')).toBeLessThanOrEqual(max(laps[1], 'textures'))
})
