import sharp from 'sharp'
import { expect, test } from './fixtures'

type Win = {
  datawalkTourMoving?: boolean
  datawalkTour: { tourStops: () => { title: string }[]; goTo: (i: number) => void }
}

// ADR-7: wall screens are unlit and not tone-mapped, so a chart keeps its exact colors.
// Plotly's default plot background is #E5ECF6 (229, 236, 246).
test('wall displays keep the exact chart colors', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Enter room' })).toBeVisible({ timeout: 60_000 })
  const index = await page.evaluate(() => (window as unknown as Win).datawalkTour.tourStops().findIndex((s) => s.title === 'Historical Price'))
  await page.evaluate((i) => (window as unknown as Win).datawalkTour.goTo(i), index)
  await page.waitForTimeout(500)
  await page.waitForFunction(() => (window as unknown as Win).datawalkTourMoving === false, null, { timeout: 60_000 })
  const { width, height } = page.viewportSize()!
  // The plot area is right of center (the y-axis labels are on the left); sample a band of it.
  // The most frequent color in the band is the plot background, once the chart texture loaded.
  const dominant = async () => {
    const png = await page.screenshot({ clip: { x: width * 0.55, y: height * 0.35, width: width * 0.2, height: height * 0.08 } })
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    const counts = new Map<string, number>()
    for (let i = 0; i < data.length; i += info.channels) {
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
  }
  const near = (rgb: number[]) => rgb.every((v, i) => Math.abs(v - [229, 236, 246][i]) <= 3)
  await expect.poll(async () => { const rgb = await dominant(); return near(rgb) ? 'exact' : rgb.join(',') }, { timeout: 90_000 }).toBe('exact')
})
