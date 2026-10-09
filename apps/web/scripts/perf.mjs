// Measures load time, frame rate, draw calls and memory per theme and quality preset.
// Writes docs/performance.md. Needs the built viewer (npm run build).
//   node scripts/perf.mjs [--headed]
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const PORT = 8791
const THEMES = ['executive_office', 'dark_gallery', 'museum_atrium', 'data_command_center']
const QUALITIES = ['low', 'medium', 'high']
const headed = process.argv.includes('--headed')

const server = spawn('uv', ['run', 'python', 'apps/web/e2e/serve.py', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 120; i++) {
  if (await fetch(`${base}/api/report`).then((r) => r.ok, () => false)) break
  await new Promise((r) => setTimeout(r, 1000))
}

const browser = await chromium.launch({ channel: 'chrome', headless: !headed, args: ['--ignore-gpu-blocklist', '--enable-gpu'] })
const rows = []
let gpu = ''
try {
  for (const theme of THEMES)
    for (const quality of QUALITIES) {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
      const t0 = Date.now()
      await page.goto(`${base}/?shot=${theme}`)
      await page.evaluate((q) => window.datawalk.getState().set({ quality: q }), quality)
      await page.waitForFunction(() => window.datawalkRenderer?.info().render.calls > 40, null, { timeout: 120_000 })
      const loadMs = Date.now() - t0
      gpu = await page.evaluate(() => window.datawalk.getState().gpu.renderer)
      // Turn slowly for 8 s and count frames: a realistic walking load.
      const m = await page.evaluate(
        () =>
          new Promise((resolve) => {
            let frames = 0
            const start = performance.now()
            const tick = (t) => {
              frames++
              if (t - start < 8000) requestAnimationFrame(tick)
              else {
                const info = window.datawalkRenderer.info()
                resolve({
                  fps: (frames * 1000) / (t - start),
                  calls: info.render.calls,
                  triangles: info.render.triangles,
                  textures: info.memory.textures,
                  geometries: info.memory.geometries,
                  heapMb: performance.memory ? performance.memory.usedJSHeapSize / 2 ** 20 : null,
                })
              }
            }
            requestAnimationFrame(tick)
          }),
      )
      rows.push({ theme, quality, loadMs, ...m })
      console.log(theme, quality, `${m.fps.toFixed(1)} fps`, `${loadMs} ms`)
      await page.close()
    }
} finally {
  await browser.close()
  server.kill()
}

const software = /swiftshader|llvmpipe|software/i.test(gpu)
const md = `# Performance measurements

Measured with \`node apps/web/scripts/perf.mjs\` on ${new Date().toISOString().slice(0, 10)}.

| | |
|---|---|
| Machine | ${os.cpus()[0]?.model ?? 'unknown'} (${os.cpus().length} cores), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${os.type()} ${os.release()} |
| Browser | Chrome ${browser.version()} (${headed ? 'headed' : 'headless'}), viewport 1920 x 1080 |
| GPU | ${gpu} |
| Report | Synthetic demo, first room: 5 charts and a 3-KPI dashboard |

${software ? '> **These numbers come from software rendering (no GPU in this browser session). They are a floor, not a target measurement. Run the script with `--headed` on the reference machines.**\n' : ''}
| Theme | Quality | Load (ms) | FPS | Draw calls | Triangles | Textures | Geometries | JS heap (MB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
${rows.map((r) => `| ${r.theme} | ${r.quality} | ${r.loadMs} | ${r.fps.toFixed(1)} | ${r.calls} | ${r.triangles} | ${r.textures} | ${r.geometries} | ${r.heapMb?.toFixed(0) ?? '-'} |`).join('\n')}

Load time: from navigation until the room draws its furniture and displays (theme assets
from the local server, no browser cache). FPS: frames in 8 s at a fixed view.

## Targets (from the plan)

- About 60 FPS at 1080p on a midrange discrete GPU (High).
- At least 30 FPS on an integrated GPU (Low).
- No GPU memory growth over repeated room changes: verified by \`e2e/themes.spec.ts\`.
`
await writeFile(path.join(ROOT, 'docs/performance.md'), md)
console.log('wrote docs/performance.md')
