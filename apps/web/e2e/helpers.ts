import { expect, type Page } from '@playwright/test'

type Store = {
  getState: () => {
    overlay: string | null
    focusedId: string | null
    selectedId: string | null
    roomId: string
    report: {
      rooms: { id: string; name: string; placements: Record<string, { wall: string }> }[]
      visualizations: { id: string; key: string }[]
    }
  }
}

export const state = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { datawalk: Store }).datawalk.getState()
    const room = s.report.rooms.find((r) => r.id === s.roomId)
    const key = (id: string | null) => s.report.visualizations.find((v) => v.id === id)?.key ?? null
    return {
      overlay: s.overlay,
      room: room?.name,
      focused: key(s.focusedId),
      selected: key(s.selectedId),
      placements: Object.fromEntries(Object.entries(room?.placements ?? {}).map(([id, p]) => [key(id), p.wall])),
    }
  })

export async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

/** Walk forward, then strafe left until `key` is under the crosshair. */
export async function aimAt(page: Page, key: string) {
  await sceneReady(page)
  // Walk forward until about 5 m from the north wall, then strafe.
  const north = () =>
    page.evaluate(() => {
      const w = window as unknown as { datawalkPose: { z: number }; datawalkLayout: () => { depth: number } }
      return w.datawalkPose.z + w.datawalkLayout().depth / 2
    })
  await expect.poll(async () => (await hold(page, 'w', 250), north()), { timeout: 60_000 }).toBeLessThan(5)
  await expect
    .poll(
      async () => {
        await hold(page, 'a', 250)
        return (await state(page)).focused
      },
      { timeout: 60_000 }, // themed rooms grow around windows: the chart can be several meters away
    )
    .toBe(key)
}

/** The room is loaded and drawn: furniture, displays and textures are in place. */
export async function sceneReady(page: Page) {
  await page.waitForFunction(
    () => {
      const r = (window as unknown as { datawalkRenderer?: { info: () => { render: { calls: number } } } }).datawalkRenderer
      return !!r && r.info().render.calls > 40
    },
    null,
    { timeout: 90_000 },
  )
}

/** Choose the room to enter from the lobby (the demo's first room is the summary). */
export async function startIn(page: Page, roomName: string) {
  await page.waitForFunction(() => !!(window as unknown as { datawalk: Store }).datawalk.getState().report)
  await page.evaluate((name) => {
    const s = (window as unknown as { datawalk: Store & { getState: () => { enterRoom: (id: string) => void } } }).datawalk.getState()
    s.enterRoom(s.report.rooms.find((r) => r.name === name)!.id)
  }, roomName)
}
