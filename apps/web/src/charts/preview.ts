import { SRGBColorSpace, type Texture, TextureLoader } from 'three'
import { loadPayload, previewUrl, uploadPreview } from '../app/api'
import { useViewer } from '../state/store'
import { canvasTexture } from '../scenes/textures'
import { displayName, type Visualization } from '../state/schema'
import { drawKpi, drawTable, drawText } from './panels'
import type { PlotlyFigure } from './plotly'
import { bokehImage } from './bokeh'
import { PREVIEW_WIDTH, plotlyImage } from './images'
import { svgImage, vegaImage } from './vega'

const uploaded = new Set<string>() // previews sent to the server in this session

/** Texture for a wall display: the stored PNG, a Plotly.js render, or a drawn KPI/table panel. */
export async function loadPreviewTexture(viz: Visualization, anisotropy: number): Promise<Texture | null> {
  let tex: Texture | null = null
  if (viz.source.has_preview) tex = await new TextureLoader().loadAsync(previewUrl(viz.id))
  else if (viz.source.has_payload) {
    const p = await loadPayload(viz.id)
    const h = Math.round(1024 / viz.source.aspect)
    if (p.kind === 'plotly') {
      const url = await plotlyImage(viz, p.figure as PlotlyFigure)
      tex = await new TextureLoader().loadAsync(url)
      // In an editing session, keep the render on the server (once): usable in exports.
      const token = useViewer.getState().editToken
      if (token && !uploaded.has(viz.id)) {
        uploaded.add(viz.id)
        fetch(url).then((r) => r.blob()).then((png) => uploadPreview(viz.id, png, token)).catch(console.warn)
      }
    }
    else if (p.kind === 'kpi') tex = canvasTexture(1024, h, (ctx) => drawKpi(ctx, displayName(viz), p))
    else if (p.kind === 'table') tex = canvasTexture(1024, h, (ctx) => drawTable(ctx, p))
    else if (p.kind === 'vegalite') tex = await new TextureLoader().loadAsync(await vegaImage(p.spec, PREVIEW_WIDTH))
    else if (p.kind === 'svg') tex = await new TextureLoader().loadAsync(await svgImage(p.svg, PREVIEW_WIDTH))
    else if (p.kind === 'bokeh') tex = await new TextureLoader().loadAsync(await bokehImage(p.item, p.version))
    else if (p.kind === 'text') {
      const all = useViewer.getState().report?.visualizations ?? []
      const evidence = p.links.flatMap((k) => all.filter((v) => v.key === k && v.status === 'active').map(displayName))
      tex = canvasTexture(1024, h, (ctx) => drawText(ctx, displayName(viz), p, evidence))
    }
  }
  if (tex) {
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = anisotropy
  }
  return tex
}
