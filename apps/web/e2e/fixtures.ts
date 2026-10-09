import { test as base } from '@playwright/test'

export { expect } from '@playwright/test'

// Headless browsers on CI render with a software GPU, where the viewer opens the flat view
// first. The 3D tests choose 3D the way a visitor would: the saved view preference.
export const test = base.extend({
  page: async ({ page }, provide) => {
    // ?view=flat still wins: flat view tests use it.
    await page.addInitScript(() => localStorage.setItem('datawalk.view', '3d'))
    await provide(page) // Playwright's fixture callback (not a React hook)
  },
})
export type { Page } from '@playwright/test'
