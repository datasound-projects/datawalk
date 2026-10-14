import { expect, type Page, test } from './fixtures'
import { sceneReady } from './helpers'

// The AI guide (opt-in, --guide) with stand-ins that answer at once (e2e/guide_serve.py):
// the plan, the camera, the narration, questions, interruptions, and the fallbacks.

type Win = {
  datawalk: {
    getState: () => {
      presenting: boolean
      stopIndex: number
      tourArrived: string | null
      overlay: string | null
      inspectId: string | null
      guideTour: { id: string; ref: string; notes: string }[] | null
      report: { visualizations: { id: string; key: string }[] }
    }
  }
}
const viewer = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as Win).datawalk.getState()
    return {
      presenting: s.presenting,
      index: s.stopIndex,
      arrived: !!s.guideTour && s.tourArrived === s.guideTour[s.stopIndex]?.id,
      overlay: s.overlay,
      inspecting: s.report.visualizations.find((v) => v.id === s.inspectId)?.key ?? null,
      plan: s.guideTour?.map((t) => t.notes) ?? null,
    }
  })
const phase = (page: Page) => page.locator('.guide').getAttribute('data-phase')

/** Fail on any uncaught error: a crash unmounts the whole viewer. */
function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

test('the guide presents the demo: plan, camera, narration, questions, and interruptions', async ({ page }) => {
  test.setTimeout(360_000) // a whole presentation; CI renders at about one frame per second
  const errors = watchErrors(page)
  const clips: { face: { names: string[]; frames: number[][] } | null; seconds: number }[] = []
  page.on('response', (r) => {
    // A body can be gone by the time it is read (a slow machine): such a clip is not counted.
    if (r.url().endsWith('/api/guide/speech') && r.ok()) r.json().then((c) => clips.push(c), () => {})
  })
  await page.goto('/')
  const avatar = page.getByRole('button', { name: /^(Open the AI guide|Close the AI guide panel) \(/ })
  await expect(avatar).toBeVisible({ timeout: 60_000 })
  await avatar.click()
  const panel = page.locator('.guide-panel')
  await expect(panel.getByText('Local model: scripted-test-model')).toBeVisible()

  // The plan: room by room, and without the sentence that the data does not support.
  await panel.getByRole('tab', { name: 'Plan' }).click()
  await panel.getByRole('button', { name: 'Make a plan' }).click()
  const narration = panel.getByRole('textbox', { name: /Narration for/ })
  // Each room is entered with its own stop: the guide names the room and what comes there.
  await expect(narration).toHaveCount(8) // enough stops that the tour cannot end during the test
  await expect(narration.first()).toHaveValue(/^Let's begin with “Summary”: .+\. Welcome to the summary\. All data is synthetic\.$/)
  await expect(narration.nth(1)).toHaveValue(/^And now let's take a look at “Market Overview”: Historical Price, Rolling Volatility, and Drawdown from Peak\.$/)
  await expect(narration.nth(2)).toHaveValue('The price moves from 100.4 to 87.5 USD.')
  await expect(panel.getByText(/1 statement\(s\) removed/)).toBeVisible()

  // Every caption, with the stop on screen and whether the camera stood still at that moment.
  await page.evaluate(() => {
    const w = window as unknown as Win & { captions: { text: string; index: number; arrived: boolean }[] }
    w.captions = []
    new MutationObserver(() => {
      const text = document.querySelector('.guide-caption, .guide-now')?.textContent
      if (!text || w.captions.at(-1)?.text === text) return
      const s = w.datawalk.getState()
      w.captions.push({ text, index: s.stopIndex, arrived: s.tourArrived === s.guideTour?.[s.stopIndex]?.id })
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  const captions = () => page.evaluate(() => (window as unknown as { captions: { text: string; index: number; arrived: boolean }[] }).captions)

  // Present: the camera arrives first, then the guide speaks, then it moves on by itself.
  await panel.getByRole('button', { name: 'Present', exact: true }).click()
  await expect.poll(async () => (await viewer(page)).presenting).toBe(true)
  await expect(page.locator('.tour-title')).toContainText('/ 8')
  await expect(panel).toHaveCount(0) // the room is the stage: captions and compact controls only
  const mini = page.getByRole('toolbar', { name: 'AI guide controls' })
  await expect(mini.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect.poll(async () => (await captions()).map((c) => c.text), { timeout: 90_000 }).toContain('The price moves from 100.4 to 87.5 USD.')
  const seen = await captions()
  expect(seen[0]).toMatchObject({ index: 0, arrived: true })
  expect(seen[0].text).toMatch(/^Let's begin with “Summary”/)
  expect(seen.slice(1, 3)).toEqual([
    { text: 'Welcome to the summary.', index: 0, arrived: true },
    { text: 'All data is synthetic.', index: 0, arrived: true },
  ])
  // Through the door into the next room: the guide names it, then speaks about the chart.
  expect(seen[3]).toMatchObject({ index: 1, arrived: true })
  expect(seen[3].text).toMatch(/^And now let's take a look at “Market Overview”/)
  expect(seen[4]).toEqual({ text: 'The price moves from 100.4 to 87.5 USD.', index: 2, arrived: true })
  expect(seen.every((c) => c.arrived)).toBe(true) // it speaks only where the camera stands still
  expect(clips.length).toBeGreaterThanOrEqual(3) // the Kokoro path: one clip per sentence
  expect(clips[0].face?.names).toContain('jawOpen') // Audio2Face frames come with the audio
  expect(clips[0].face!.frames.length).toBe(Math.floor(clips[0].seconds * 30))

  // A clicker press interrupts at once; the guide narrates a later stop. (On a slow machine the
  // tour can also move on by itself just before the press: the checks allow for that.)
  const plan = (await viewer(page)).plan!
  const before = (await viewer(page)).index
  await page.keyboard.press('PageDown')
  await expect.poll(async () => (await viewer(page)).index).toBeGreaterThan(before)
  const now = (await viewer(page)).index
  const sentences = plan[now].split(/(?<=\.)\s+/).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  await expect(page.locator('.guide-caption, .guide-now')).toHaveText(new RegExp(`^(${sentences.join('|')})$`), { timeout: 60_000 })
  const models = plan.findIndex((n) => n.startsWith('The models are close to chance.'))

  // A question pauses; "show me the model comparison" goes to that stop and keeps the pause.
  await mini.getByRole('button', { name: 'Ask' }).click()
  await expect(panel.getByRole('tab', { name: 'Questions' })).toHaveAttribute('aria-selected', 'true')
  const input = panel.getByRole('textbox', { name: 'Question for the AI guide' })
  await input.fill('Show me the model comparison')
  await input.press('Enter')
  await expect(panel.locator('.guide-log li.guide-answer')).toContainText('Gradient boosting has the highest AUC.')
  await expect(panel.locator('.guide-evidence')).toContainText('Model Comparison')
  await expect.poll(async () => (await viewer(page)).index).toBe(models)
  await expect(panel.getByRole('button', { name: 'Resume' })).toBeVisible()
  // the answer is spoken with its interpretation (several sentences) before the pause shows
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe('paused')

  // Resume: the narration of the stop on screen. A plain answer then goes on by itself.
  await panel.getByRole('button', { name: 'Resume' }).click()
  // (the camera may still walk to that room: the guide speaks once it stands at the chart)
  await expect(page.locator('.guide-caption, .guide-now')).toHaveText('The models are close to chance.', { timeout: 60_000 })
  await input.fill('Is the data real?')
  await input.press('Enter')
  await expect(panel.locator('.guide-log li.guide-answer').last()).toContainText('synthetic')
  // Nothing more to click: the narration goes on by itself, and the last stop ends the
  // presentation. The report's own tour is back.
  await expect.poll(async () => (await viewer(page)).presenting, { timeout: 120_000 }).toBe(false)
  expect((await viewer(page)).plan).toBeNull()

  // Evidence opens the chart in the inspector; panel and inspector open and close safely.
  await panel.locator('.guide-evidence button').first().click()
  await expect.poll(async () => (await viewer(page)).overlay).toBe('inspector')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await viewer(page)).overlay).not.toBe('inspector')
  await panel.getByRole('button', { name: 'Close the AI guide panel', exact: true }).click()
  await expect(panel).toHaveCount(0)
  await avatar.click()
  await expect(panel).toBeVisible()
  expect(errors).toEqual([])
})

test('without a model and a voice the guide presents with the report text and captions', async ({ page }) => {
  test.setTimeout(180_000)
  const errors = watchErrors(page)
  await page.goto('http://127.0.0.1:8773/')
  const avatar = page.getByRole('button', { name: /^(Open the AI guide|Close the AI guide panel) \(/ })
  await expect(avatar).toBeVisible({ timeout: 60_000 })
  await avatar.click()
  const panel = page.locator('.guide-panel')
  await expect(panel.getByText('No local model. The guide uses the report text.')).toBeVisible()
  await panel.locator('summary', { hasText: 'Components' }).click()
  await expect(panel.locator('.guide-health')).toContainText('Cannot reach Ollama at http://127.0.0.1:9')
  await expect(panel.locator('.guide-health')).toContainText('lip sync follows the audio')
  await panel.getByRole('button', { name: 'Present', exact: true }).click()
  await expect.poll(async () => (await viewer(page)).presenting, { timeout: 30_000 }).toBe(true)
  await expect(page.locator('.guide-caption, .guide-now')).toBeVisible({ timeout: 60_000 }) // browser voice or captions
  await avatar.click() // the panel closed for the presentation
  await panel.getByRole('tab', { name: 'Plan' }).click()
  await expect(panel.getByText(/Plan from the report text/)).toBeVisible()
  await expect(panel.getByText(/No AI model: Cannot reach Ollama/)).toBeVisible()
  // A question without a model: the report's facts answer, and the viewer keeps working.
  await panel.getByRole('tab', { name: 'Questions' }).click()
  const input = panel.getByRole('textbox', { name: 'Question for the AI guide' })
  await input.fill('What changed?')
  await input.press('Enter')
  await expect(panel.locator('.guide-log li.guide-answer')).toContainText('straight from the report facts')
  await panel.getByRole('button', { name: 'Stop' }).click()
  await expect.poll(async () => (await viewer(page)).presenting).toBe(false)
  expect(errors).toEqual([])
})

test('X opens the guide while walking, without the pause menu, and closes it back to walking', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByRole('button', { name: 'Enter room' }).click()
  await sceneReady(page)
  const locked = () => page.evaluate(() => document.pointerLockElement?.tagName ?? null)
  await expect.poll(locked, { timeout: 5_000 }).toBe('CANVAS').catch(() => {}) // none on headless Linux
  const walking = (await locked()) === 'CANVAS'
  const panel = page.locator('.guide-panel')

  // X: the panel opens and the mouse is free for it; the room stays (no pause menu).
  await page.keyboard.press('x')
  await expect(panel).toBeVisible()
  expect(await locked()).toBeNull()
  expect((await viewer(page)).overlay).toBeNull()

  // A question typed into the panel is text: W does not walk, X does not close.
  const pose = () => page.evaluate(() => (window as unknown as { datawalkPose: { x: number; z: number } }).datawalkPose)
  const before = await pose()
  const input = panel.getByRole('textbox', { name: 'Question for the AI guide' })
  await input.pressSequentially('wwwx')
  await expect(input).toHaveValue('wwwx')
  await page.waitForTimeout(500)
  expect(await pose()).toEqual(before)
  await expect(panel).toBeVisible()

  // X again (outside the text field): the panel closes, and the walk gets the mouse back.
  await input.blur()
  await page.keyboard.press('x')
  await expect(panel).toHaveCount(0)
  if (walking) await expect.poll(locked).toBe('CANVAS')
  expect(errors).toEqual([])
})

test('without --guide there is no guide and no guide request', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => r.url().includes('/api/guide') && requests.push(r.url()))
  await page.goto('http://127.0.0.1:8766/')
  await expect(page.getByRole('button', { name: 'Enter room' })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('.guide')).toHaveCount(0)
  expect(requests).toEqual([])
})
