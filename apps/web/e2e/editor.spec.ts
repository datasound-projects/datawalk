import { expect, test } from './fixtures'
import { aimAt, sceneReady, startIn, state } from './helpers'

test('editor: rename, undo, arrange, save, reload, stakeholder preview', async ({ page }) => {
  await page.goto('/#edit=e2e-token')
  await expect(page).toHaveURL(/\/$/) // the token leaves the address bar
  await startIn(page, 'Market Overview')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await aimAt(page, 'price')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Edit report' }).click()
  const editor = page.getByRole('dialog', { name: 'Report editor' })

  // Rename a room; undo and redo it.
  const roomName = editor.getByRole('textbox', { name: 'Room 2 name' }) // room 1 is the summary
  await roomName.fill('Markets')
  await roomName.press('Enter')
  await expect(editor.getByRole('status')).toHaveText('Unsaved changes')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(roomName).toHaveValue('Market Overview')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(editor.getByRole('textbox', { name: 'Room 2 name' })).toHaveValue('Markets')

  // Rename a visualization.
  await editor.getByRole('tab', { name: 'Visualizations' }).click()
  await editor.locator('summary', { hasText: 'Historical Price' }).click()
  const vizName = editor.getByRole('textbox', { name: 'Name', exact: true }).first()
  await vizName.fill('BTC Price')
  await vizName.press('Enter')

  // Arrange: drag the chart in the crosshair along the north wall.
  await editor.getByRole('tab', { name: 'Rooms' }).click()
  await editor.getByRole('button', { name: 'Arrange displays' }).nth(1).click() // room 2: Market Overview
  const box = (await page.locator('#scene canvas').boundingBox())!
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2]
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await state(page)).selected).toBe('price')
  await expect.poll(async () => (await state(page)).placements).toEqual({ price: 'north' })
  await page.getByRole('toolbar', { name: 'Arrange displays' }).getByRole('button', { name: 'Done' }).click()

  // Save, reload: everything persists (the server wrote the archive).
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor.getByRole('status')).toHaveText('All changes saved to e2e.dwk')
  await page.reload()
  await startIn(page, 'Markets') // a reload starts in the first room, the summary
  await expect(page.getByText('now in')).toContainText('Markets')
  expect((await state(page)).placements).toEqual({ price: 'north' })
  // In the lobby, Tab moves the focus; while walking, Tab opens the rooms list.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('dialog', { name: 'Report navigator' })).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { datawalk: { getState: () => { setOverlay: (o: null) => void } } }).datawalk.getState().setOverlay(null))
  await page.keyboard.press('Tab')
  await expect(page.getByRole('dialog', { name: 'Report navigator' }).getByRole('button', { name: 'BTC Price' })).toBeVisible()
  await page.keyboard.press('Escape')

  // Stakeholder preview hides editing.
  await page.getByRole('button', { name: 'Edit report' }).click()
  await editor.getByRole('button', { name: 'Preview as stakeholder' }).click()
  await expect(page.getByRole('button', { name: 'Edit report' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Exit stakeholder preview' }).click()
  await expect(page.getByRole('button', { name: 'Edit report' })).toBeVisible()
})

test('themes: preview, cancel, apply, persist; keyboard arrange', async ({ page }) => {
  page.on('dialog', (d) => d.accept()) // placement warnings when a theme moves displays
  await page.goto('/#edit=e2e-token')
  await page.getByRole('button', { name: /Enter room|Resume/ }).click()
  await sceneReady(page)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Edit report' }).click()
  const editor = page.getByRole('dialog', { name: 'Report editor' })
  await editor.getByRole('tab', { name: 'Themes' }).click()
  await expect(editor.locator('article.theme img')).toHaveCount(10)

  // Preview shows the theme without saving it; Cancel returns to the editor.
  await editor.getByRole('article', { name: 'Museum Atrium' }).getByRole('button', { name: 'Preview' }).click()
  const bar = page.getByRole('toolbar', { name: 'Theme preview' })
  await expect(bar).toContainText('Museum Atrium')
  await bar.getByRole('button', { name: 'Cancel' }).click()
  const theme = () => page.evaluate(() => (window as unknown as { datawalk: { getState: () => { report: { theme: string } | null } } }).datawalk.getState().report?.theme ?? null)
  expect(await theme()).toBe('executive_office')

  // Apply, save, reload.
  await editor.getByRole('article', { name: 'Dark Gallery' }).getByRole('button', { name: 'Apply' }).click()
  await expect.poll(theme).toBe('dark_gallery')
  await editor.getByRole('button', { name: 'Save' }).click()
  // Headless software WebGL keeps the main thread busy behind the editor: allow time.
  await expect(editor.getByRole('status')).toHaveText(/All changes saved/, { timeout: 30_000 })
  await page.reload()
  await expect.poll(theme, { timeout: 30_000 }).toBe('dark_gallery')

  // Keyboard arrange: select with ], move with Alt+arrow.
  await page.getByRole('button', { name: 'Edit report' }).click()
  await editor.getByRole('button', { name: 'Arrange displays' }).nth(1).click() // room 2: Market Overview
  await sceneReady(page)
  await page.keyboard.press(']')
  await expect.poll(async () => (await state(page)).selected).not.toBeNull()
  const selected = (await state(page)).selected
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(async () => (await state(page)).placements[selected!]).toBeTruthy()
})

test('editor: export review, then download a single HTML file', async ({ page }) => {
  await page.goto('/#edit=e2e-token')
  await page.getByRole('button', { name: 'Edit report' }).click()
  const editor = page.getByRole('dialog', { name: 'Report editor' })
  await editor.getByRole('tab', { name: 'Export' }).click()
  const review = editor.locator('table.review')
  await expect(review.getByRole('row', { name: /Rolling Volatility/ })).toContainText('Chart data')
  // Reduce a chart to its preview image: its data points leave the review.
  await editor.getByRole('combobox', { name: 'Data in the export: Rolling Volatility' }).selectOption('preview')
  await expect(review.getByRole('row', { name: /Rolling Volatility/ }).getByRole('cell').nth(2)).toHaveText('0')
  await editor.getByLabel('Include the attached datasets').check()
  await editor.getByRole('textbox', { name: 'Recipient watermark' }).fill('Board copy')
  // No download before the author confirms the review.
  const button = editor.getByRole('button', { name: 'Download HTML file' })
  await expect(button).toBeDisabled()
  await editor.getByLabel('I reviewed this list').check()
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()])
  expect(download.suggestedFilename()).toBe('Financial_Market_Research.html')
  const html = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString())
  expect(html).toContain("default-src 'none'")
  expect(html).toContain('"watermark":"Board copy"')
  expect(html).toContain('data:text/csv;base64,')
})

test('tour tab: notes and order are saved and drive the presentation', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/#edit=e2e-token')
  await page.getByRole('button', { name: 'Edit report' }).click()
  const editor = page.getByRole('dialog', { name: 'Report editor' })
  await editor.getByRole('tab', { name: 'Tour' }).click()
  await expect(editor.getByText('Key figures').first()).toBeVisible()
  // Stop 2 (Key figures) moves after stop 3 (Finding 1), and gets notes.
  await editor.getByRole('button', { name: 'Move stop 2 down' }).click()
  const notes = editor.getByRole('textbox', { name: 'Speaker notes for stop 3' })
  await notes.fill('Read the three numbers aloud.')
  await notes.blur()
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor.getByRole('status')).toContainText('All changes saved')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Present' })).toBeVisible({ timeout: 60_000 })
  const titles = await page.evaluate(() =>
    (window as unknown as { datawalkTour: { tourStops: () => { title: string; stop: { notes: string } }[] } }).datawalkTour
      .tourStops()
      .slice(0, 3)
      .map((s) => [s.title, s.stop.notes]),
  )
  expect(titles).toEqual([
    ['Summary', ''],
    ['Finding 1', ''],
    ['Key figures', 'Read the three numbers aloud.'],
  ])
})
