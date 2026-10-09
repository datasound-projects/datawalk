import { expect, test } from './fixtures'

type Stop = { roomId: string; targetId: string | null; kind: string; title: string }
type Win = {
  datawalkTourMoving?: boolean
  datawalk: {
    getState: () => {
      presenting: boolean
      stopIndex: number
      roomId: string
      focusedId: string | null
      overlay: string | null
      report: { dashboards: { id: string; items: string[] }[] }
    }
  }
  datawalkTour: { tourStops: () => Stop[] }
  datawalkPose: { x: number; z: number; yaw: number }
  datawalkLayout: () => { exhibits: { id: string; position: [number, number, number] }[]; displays: { id: string; position: [number, number, number] }[] } | null
}

// Phase 11 exit criterion: present the complete demo report with Page Down and Page Up only.
test('present the whole demo with a clicker (Page Down / Page Up only)', async ({ page }) => {
  test.setTimeout(600_000)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Present' })).toBeVisible({ timeout: 60_000 })
  const stops = await page.evaluate(() => (window as unknown as Win).datawalkTour.tourStops())
  expect(stops.length).toBeGreaterThan(20)
  expect(stops[0]).toMatchObject({ kind: 'room', title: 'Summary' }) // the summary room comes first

  const settle = async (index: number) => {
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalk.getState().stopIndex)).toBe(index)
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Win).datawalkTourMoving === false), { timeout: 30_000 })
      .toBe(true)
  }
  for (let i = 0; i < stops.length; i++) {
    await page.keyboard.press('PageDown') // from the lobby, the first press starts the tour
    await settle(i)
    const s = await page.evaluate(() => (window as unknown as Win).datawalk.getState())
    expect(s.presenting).toBe(true)
    expect(s.roomId).toBe(stops[i].roomId)
    // A framed display is under the crosshair: the stop itself, or a chart of its dashboard.
    if (stops[i].targetId && stops[i].kind !== 'room') {
      const target = stops[i].targetId!
      const members = s.report.dashboards.find((d) => d.id === target)?.items ?? []
      const framed = async () => {
        const id = await page.evaluate(() => (window as unknown as Win).datawalk.getState().focusedId)
        if (id === target || members.includes(id ?? '')) return 'framed'
        // A 3D exhibit, or a dashboard with a gap at its center: the camera looks straight at it.
        const look = await page.evaluate((t) => {
          const w = window as unknown as Win
          const l = w.datawalkLayout()
          const e = l?.exhibits.find((x) => x.id === t) ?? l?.displays.find((x) => x.id === t)
          if (!e) return null
          const [dx, dz] = [e.position[0] - w.datawalkPose.x, e.position[2] - w.datawalkPose.z]
          const yaw = Math.atan2(-dx, -dz)
          return { off: Math.abs(Math.atan2(Math.sin(yaw - w.datawalkPose.yaw), Math.cos(yaw - w.datawalkPose.yaw))), dist: Math.hypot(dx, dz) }
        }, target)
        if (look && look.off < 0.1 && look.dist < 5) return 'framed'
        return `focused ${id} at stop ${i} (${stops[i].title}) ${JSON.stringify(look)}`
      }
      await expect.poll(framed, { timeout: 20_000 }).toBe('framed')
    }
  }
  // The last stop stays the last stop; Page Up goes back through the rooms.
  await page.keyboard.press('PageDown')
  await settle(stops.length - 1)
  for (let i = stops.length - 2; i >= stops.length - 6; i--) {
    await page.keyboard.press('PageUp')
    await settle(i)
  }
  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalk.getState().presenting)).toBe(false)
})

test('presenter view: notes, next stop, and control from the second window', async ({ page, context }) => {
  test.setTimeout(180_000)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Present' })).toBeVisible({ timeout: 60_000 })
  await page.keyboard.press('PageDown')
  const [presenter] = await Promise.all([context.waitForEvent('page'), page.keyboard.press('KeyP')])
  await expect(presenter.getByRole('region', { name: 'Current stop' })).toContainText('1 / 27 · Summary', { timeout: 60_000 })
  await expect(presenter.getByRole('region', { name: 'Next stop' })).toContainText('Next: Key figures')
  await expect(presenter.getByLabel('Elapsed time')).toHaveText(/^\d+:\d\d$/)
  // The clicker is often connected to the presenter's screen: its keys drive the audience window.
  await presenter.keyboard.press('PageDown')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalk.getState().stopIndex)).toBe(1)
  await expect(presenter.getByRole('region', { name: 'Current stop' })).toContainText('2 / 27 · Key figures')
  await page.keyboard.press('PageDown') // and the audience window updates the presenter view
  await expect(presenter.getByRole('region', { name: 'Current stop' })).toContainText('3 / 27 · Finding 1')
  await expect(presenter.getByRole('region', { name: 'Speaker notes' })).toContainText('No notes for this stop.')
})

test('kiosk mode advances by itself', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?kiosk')
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalk.getState().presenting), { timeout: 60_000 }).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as unknown as Win).datawalk.getState().stopIndex), { timeout: 25_000 }).toBe(1)
})
