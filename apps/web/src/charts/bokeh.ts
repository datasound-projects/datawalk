// Bokeh charts: BokehJS of the chart's own version, loaded on demand. It comes from the bokeh
// package of the machine that serves the report (api/vendor/...), from the static site
// (vendor/...), or is already inline in a single-file export (window.Bokeh).
import { exported } from '../app/api'
import { t } from '../i18n'

type View = { export: (type: string, hidpi: boolean) => { to_blob: () => Promise<Blob> }; remove: () => void; ready?: Promise<void> }
type BokehApi = { version: string; embed: { embed_item: (item: unknown, el: HTMLElement) => Promise<{ roots: Iterable<View> }> } }
type Item = Record<string, unknown>

const FILES = ['bokeh', 'bokeh-gl', 'bokeh-widgets', 'bokeh-tables']
const loading = new Map<string, Promise<BokehApi>>()
const bokehGlobal = () => (globalThis as { Bokeh?: BokehApi }).Bokeh

function script(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => resolve()
    s.onerror = () => reject(new Error(t('bokeh.unavailable', { src })))
    document.head.append(s)
  })
}

export function loadBokeh(version: string): Promise<BokehApi> {
  let p = loading.get(version)
  if (!p) {
    p = (async () => {
      const ready = bokehGlobal()
      if (ready) {
        if (ready.version !== version) throw new Error(t('bokeh.version', { version, loaded: ready.version }))
        return ready
      }
      const base = exported ? `vendor/bokeh/${version}` : `api/vendor/bokeh/${version}`
      for (const f of FILES) await script(`${base}/${f}.min.js`) // in order: the extensions need bokeh.js
      return bokehGlobal()!
    })()
    p.catch(() => loading.delete(version))
    loading.set(version, p)
  }
  return p
}

/** Interactive chart in a DOM element. Returns a function that removes it. */
export async function embedBokeh(el: HTMLElement, item: Item, version: string): Promise<() => void> {
  const Bokeh = await loadBokeh(version)
  const views = [...(await Bokeh.embed.embed_item(item, el)).roots]
  return () => views.forEach((v) => v.remove())
}

/** PNG data URL of a Bokeh chart, drawn offscreen at the chart's own size (HiDPI). */
export async function bokehImage(item: Item, version: string): Promise<string> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-20000px;top:0;'
  document.body.append(host)
  try {
    const Bokeh = await loadBokeh(version)
    const [view] = [...(await Bokeh.embed.embed_item(item, host)).roots]
    await view.ready
    const blob = await view.export('png', true).to_blob()
    view.remove()
    return await new Promise<string>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(r.result as string)
      r.readAsDataURL(blob)
    })
  } finally {
    host.remove()
  }
}
