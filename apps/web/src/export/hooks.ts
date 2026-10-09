// Hooks for exports that Python drives through a headless browser (PPTX images, GLB, USDZ).
// They render with the same code as the walls, so exported images match the wall displays.
import { loadPayload } from '../app/api'
import { chartImageUrl } from '../charts/images'
import { svgImage } from '../charts/vega'
import { useViewer } from '../state/store'

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.readAsDataURL(blob)
  })

export const exportHooks = {
  /** PNG data URL of a chart, as the wall shows it (KPIs, tables and text as drawn panels). */
  async chartPng(id: string): Promise<string | null> {
    const viz = useViewer.getState().report?.visualizations.find((v) => v.id === id)
    if (!viz) return null
    if (viz.source.has_payload && !viz.source.has_preview) {
      const p = await loadPayload(viz.id)
      if (p.kind === 'svg') return svgImage(p.svg, 1600)
      if (p.kind === 'kpi' || p.kind === 'table' || p.kind === 'text') {
        const { loadPreviewTexture } = await import('../charts/preview') // three.js: only here
        const tex = await loadPreviewTexture(viz, 1)
        return tex ? (tex.image as HTMLCanvasElement).toDataURL('image/png') : null
      }
    }
    const url = await chartImageUrl(viz)
    if (!url || url.startsWith('data:image/png')) return url
    return dataUrl(await (await fetch(url)).blob()) // a stored preview: PNG from the server or site
  },
  /** The world file, base64-encoded. */
  async world(format: 'glb' | 'usdz'): Promise<string> {
    const { buildWorld } = await import('./world')
    const bytes = await buildWorld(useViewer.getState().report!, format)
    const url = await dataUrl(new Blob([bytes as BlobPart]))
    return url.slice(url.indexOf(',') + 1)
  },
}
