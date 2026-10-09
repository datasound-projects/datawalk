import { type Browser, type Page } from '@playwright/test'
import { expect, test } from './fixtures'

type Win = { datawalk: { getState: () => { stopIndex: number; presenting: boolean; live: { following: boolean; followers: { name: string; following: boolean }[] } | null } } }
const state = (p: Page) => page_(p, () => (window as unknown as Win).datawalk.getState())
const page_ = <T,>(p: Page, f: () => T) => p.evaluate(f)

async function signIn(browser: Browser, who: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 }, locale: 'en-US' })
  await context.addInitScript(() => localStorage.setItem('datawalk.view', '3d'))
  const page = await context.newPage()
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(`${who}@example.org`)
  await page.getByLabel('Password').fill(`${who}-password-123`)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible()
  await page.getByRole('link', { name: 'Open' }).first().click()
  await expect(page.getByRole('button', { name: 'Enter room' })).toBeVisible({ timeout: 60_000 })
  return page
}

// Phase 15 exit criterion: two browsers, one presenter, one attendee.
test('live follow: the attendee follows, breaks away, and snaps back', async ({ browser }) => {
  test.setTimeout(240_000)
  const ana = await signIn(browser, 'ana') // owner: presents
  const ben = await signIn(browser, 'ben') // viewer: follows
  await expect(ben.getByRole('button', { name: 'Present live' })).toHaveCount(0) // viewers do not present
  await ben.getByRole('button', { name: 'Enter room' }).click()

  await ana.getByRole('button', { name: 'Present live' }).click()
  await expect(ana.getByText(/Live · 1 of 1 follow/)).toBeVisible({ timeout: 20_000 })
  await expect(ben.getByText('Ana presents · you follow')).toBeVisible()
  for (let i = 1; i <= 3; i++) {
    await ana.keyboard.press('PageDown')
    await expect.poll(async () => (await state(ben)).stopIndex, { timeout: 15_000 }).toBe(i)
  }
  expect((await state(ben)).presenting).toBe(true) // ben's browser renders the stop itself

  // Break away: walking leaves the presenter; the presenter sees it.
  await ben.keyboard.press('KeyW')
  await expect(ben.getByRole('button', { name: 'Follow Ana' })).toBeVisible()
  await expect(ana.getByText('(Ben (away))')).toBeVisible()
  await ana.keyboard.press('PageDown')
  await ana.keyboard.press('PageDown')
  await expect.poll(async () => (await state(ana)).stopIndex).toBe(5)
  expect((await state(ben)).stopIndex).toBe(3)

  // Snap back to where the presenter is now (F works while the mouse walks).
  await ben.keyboard.press('KeyF')
  await expect.poll(async () => (await state(ben)).stopIndex, { timeout: 15_000 }).toBe(5)
  await expect(ana.getByText(/Live · 1 of 1 follow/)).toBeVisible()

  // A question during the meeting is saved as a comment on the chart.
  await ben.keyboard.press('Escape')
  await ben.evaluate(() => {
    const s = (window as unknown as { datawalk: { getState: () => { report: { visualizations: { id: string; key: string }[] }; inspect: (id: string) => void } } }).datawalk.getState()
    s.inspect(s.report.visualizations.find((v) => v.key === 'price')!.id)
  })
  const dialog = ben.getByRole('dialog', { name: 'Historical Price' })
  await dialog.getByLabel(/New comment/).fill('Why the drop in 2023?')
  await dialog.getByRole('button', { name: 'Ask a question' }).click()
  await expect(dialog.getByText('Why the drop in 2023?')).toBeVisible()
})
