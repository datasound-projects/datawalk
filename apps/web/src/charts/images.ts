// Chart images without three.js: the flat view, the presenter view, and exports use them.
import { loadPayload, previewUrl } from '../app/api'
import type { Visualization } from '../state/schema'
import { bokehImage } from './bokeh'
import { offline, plotly, type PlotlyFigure } from './plotly'
import { svgUrl, vegaImage } from './vega'

export const PREVIEW_WIDTH = 1600

// Plotly renders take time: keep the latest ones (room changes, flat view, presenter view).
// ponytail: FIFO of 24 data URLs; an LRU if large reports revisit many rooms.
const rendered = new Map<string, Promise<string>>()

async function render(viz: Visualization, figure: PlotlyFigure): Promise<string> {
  const fig = offline(figure)
  const Plotly = await plotly()
  // Render at the figure's own design size (Plotly default 700 px), then upscale the pixels,
  // so fonts and margins keep their original proportions.
  const width = fig.layout?.width ?? 700
  const height = Math.round(width / viz.source.aspect)
  return Plotly.toImage(
    { data: fig.data, layout: { ...fig.layout, width, height } },
    { format: 'png', width, height, scale: PREVIEW_WIDTH / width },
  )
}

/** PNG data URL of a Plotly figure, as the wall shows it. */
export function plotlyImage(viz: Visualization, figure: PlotlyFigure): Promise<string> {
  const key = `${viz.id}:${viz.source.aspect}`
  let image = rendered.get(key)
  if (!image) {
    image = render(viz, figure)
    rendered.set(key, image)
    image.catch(() => rendered.delete(key))
    if (rendered.size > 24) rendered.delete(rendered.keys().next().value!)
  }
  return image
}

/** Image of a chart for the flat view and print: the stored preview, or a render. */
export async function chartImageUrl(viz: Visualization): Promise<string | null> {
  if (viz.source.has_preview) return previewUrl(viz.id)
  if (!viz.source.has_payload) return null
  const p = await loadPayload(viz.id)
  if (p.kind === 'plotly') return plotlyImage(viz, p.figure as PlotlyFigure)
  if (p.kind === 'vegalite') return vegaImage(p.spec, PREVIEW_WIDTH)
  if (p.kind === 'svg') return svgUrl(p.svg)
  if (p.kind === 'bokeh') return bokehImage(p.item, p.version)
  return null
}
