import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  return t
}

// Seeded so that the floor looks the same on every load.
function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

/** Oak plank floor; one texture tile covers 2 m x 2 m (8 planks of 0.25 m). */
export function plankTexture() {
  const rand = rng(7)
  const t = canvasTexture(1024, 1024, (ctx) => {
    const plank = 128
    for (let row = 0; row < 8; row++) {
      let x = -rand() * 600
      while (x < 1024) {
        const len = 380 + rand() * 420
        const l = 34 + rand() * 9
        ctx.fillStyle = `hsl(28 ${36 + rand() * 10}% ${l}%)`
        ctx.fillRect(x, row * plank, len, plank)
        for (let g = 0; g < 14; g++) {
          ctx.strokeStyle = `hsla(28 40% ${l - 12}% / ${0.08 + rand() * 0.12})`
          ctx.lineWidth = 1 + rand() * 2
          const y = row * plank + rand() * plank
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.bezierCurveTo(x + len / 3, y + rand() * 8 - 4, x + (2 * len) / 3, y + rand() * 8 - 4, x + len, y)
          ctx.stroke()
        }
        ctx.fillStyle = 'rgba(40,25,15,0.55)'
        ctx.fillRect(x, row * plank, 2, plank)
        x += len
      }
      ctx.fillStyle = 'rgba(40,25,15,0.5)'
      ctx.fillRect(0, row * plank, 1024, 2)
    }
  })
  t.wrapS = t.wrapT = RepeatWrapping
  return t
}

/** Name plaque under a display. */
export function labelTexture(text: string, background = '#f4f1ea', color = '#222222') {
  return canvasTexture(1024, 128, (ctx) => {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, 1024, 128)
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    let size = 56
    do ctx.font = `600 ${size--}px system-ui, -apple-system, "Segoe UI", sans-serif`
    while (ctx.measureText(text).width > 960 && size > 20)
    ctx.fillText(text, 512, 66, 980)
  })
}
