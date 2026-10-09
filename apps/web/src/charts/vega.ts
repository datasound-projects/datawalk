// Vega-Lite charts (Altair, notebooks): rendered with Vega in the browser, loaded on demand.
// The viewer loads no external data: a specification must carry its data inline.

type Spec = Record<string, unknown>

const libs = () => Promise.all([import('vega'), import('vega-lite')])

/** A Vega loader that refuses every URL (no requests from charts; exports stay offline). */
async function offlineLoader() {
  const [vega] = await libs()
  const loader = vega.loader()
  loader.load = async (uri: string) => {
    throw new Error(`This chart wants to load ${uri}. The viewer loads no external data.`)
  }
  return loader
}

/** PNG data URL of a Vega-Lite chart, `width` pixels wide. */
export async function vegaImage(spec: Spec, width = 1600): Promise<string> {
  const [vega, vl] = await libs()
  const compiled = vl.compile(spec as never).spec
  const view = new vega.View(vega.parse(compiled), { renderer: 'none', loader: await offlineLoader() })
  await view.runAsync()
  const scale = Math.max(1, Math.min(4, width / Math.max(1, view.width() + 60)))
  const url = await view.toImageURL('png', scale)
  view.finalize()
  return url
}

/** Interactive chart in a DOM element. Returns a function that removes it. */
export async function embedVega(el: HTMLElement, spec: Spec): Promise<() => void> {
  const { default: embed } = await import('vega-embed')
  const result = await embed(el, spec as never, { actions: false, renderer: 'svg', loader: await offlineLoader() })
  return () => result.finalize()
}

/** PNG data URL of an SVG image, `width` pixels wide (crisp wall textures from vector images). */
export async function svgImage(svg: string, width = 1600): Promise<string> {
  const img = new Image()
  img.src = svgUrl(svg)
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.round((width * img.naturalHeight) / Math.max(1, img.naturalWidth))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/png')
}

export const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
