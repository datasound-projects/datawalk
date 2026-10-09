import { expect, test } from './fixtures'
import { hold, sceneReady, startIn, state } from './helpers'

const yaw = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as unknown as { datawalkPose: { yaw: number } }).datawalkPose.yaw)

// Regression: walking through a door keeps the pointer locked; mouse look must still work.
test('mouse look keeps working after walking through a door', async ({ page }) => {
  await page.goto('/')
  await startIn(page, 'Market Overview')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await sceneReady(page)
  const locked = () => page.evaluate(() => document.pointerLockElement?.tagName ?? null)
  await expect.poll(locked, { timeout: 5_000 }).toBe('CANVAS').catch(() => {})
  test.skip((await locked()) !== 'CANVAS', 'This browser has no Pointer Lock (headless Chrome on Linux)')

  // Facing north, the door to the next room is 1.8 m to the left of the spawn point.
  // Headless WebGL runs at a low frame rate: move until a position is reached, not for a time.
  const x = () => page.evaluate(() => (window as unknown as { datawalkPose: { x: number } }).datawalkPose.x)
  await expect.poll(async () => (await hold(page, 'a', 100), x()), { timeout: 60_000 }).toBeLessThan(-1.6)
  await expect
    .poll(async () => (await hold(page, 's', 200), (await state(page)).room), { timeout: 60_000 })
    .toBe('Feature Engineering')
  expect(await page.evaluate(() => document.pointerLockElement?.tagName ?? null)).toBe('CANVAS')
  // The new room mounts after the state change; on mount it turns the view into the room.
  await page.waitForTimeout(1500)

  const before = await yaw(page)
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 300 })))
  await expect.poll(() => yaw(page)).not.toBeCloseTo(before, 2)
})
