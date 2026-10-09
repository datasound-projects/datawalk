// Renders a thumbnail of every theme with the demo report: assets/themes/<id>/preview.jpg.
// Needs the built viewer (npm run build). Starts its own demo server on port 8790.
//   node scripts/theme-previews.mjs [theme ...]
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const THEMES = ['executive_office', 'home_office', 'light_gallery', 'dark_gallery', 'industrial_loft', 'minimalist_studio', 'museum_atrium', 'futuristic_lab', 'metaverse_pavilion', 'data_command_center']
const PORT = 8790
const only = process.argv.slice(2)

const server = spawn('uv', ['run', 'python', 'apps/web/e2e/serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 120; i++) {
  if (await fetch(`${base}/api/report`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 1000))
}

// GPU rendering where available (ANGLE on Metal / D3D / GL); falls back to software.
const browser = await chromium.launch({ channel: 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu'] })
try {
  for (const id of only.length ? only : THEMES) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(`${base}/?shot=${id}`)
    await page.waitForFunction(() => window.datawalkLayout?.() && window.datawalkRenderer, null, { timeout: 120_000 })
    // The theme's own viewpoint (theme.json "preview"), as fractions of the room.
    const theme = JSON.parse(await (await fetch(`${base}/themes/${id}/theme.json`)).text())
    const view = theme.preview ?? { from: [0.7, 0.85], to: [0.25, 0.2] }
    await page.evaluate((v) => {
      const l = window.datawalkLayout()
      const at = ([fx, fz]) => [-l.width / 2 + fx * l.width, -l.depth / 2 + fz * l.depth]
      const [x, z] = at(v.from)
      const [tx, tz] = at(v.to)
      window.datawalkTeleport({ x, z, yaw: Math.atan2(-(tx - x), -(tz - z)) })
    }, view)
    await page.waitForTimeout(12_000) // models, textures, chart previews
    const png = await page.screenshot()
    const out = path.join(ROOT, 'assets/themes', id, 'preview.jpg')
    await sharp(png).resize(800, 500).jpeg({ quality: 82, mozjpeg: true }).toFile(out)
    const gpu = await page.evaluate(() => window.datawalkRenderer.gpu())
    console.log(`${id}: ${path.relative(ROOT, out)} (${gpu})`)
    await page.close()
  }
} finally {
  await browser.close()
  server.kill()
}
