import type * as PlotlyTypes from 'plotly.js'

export type PlotlyFigure = {
  data: PlotlyTypes.Data[]
  layout?: Partial<PlotlyTypes.Layout> & { images?: { source?: string }[] }
  frames?: PlotlyTypes.Frame[]
}

// Plotly.js is large: load it only when a chart needs it.
let module: Promise<typeof PlotlyTypes> | null = null
export const plotly = () =>
  (module ??= import('plotly.js-dist-min').then((m) => (m.default ?? m) as typeof PlotlyTypes))

/** Drop layout images that point to other origins: reports must not fetch external data. */
export function offline(fig: PlotlyFigure): PlotlyFigure {
  const images = fig.layout?.images?.filter((im) => im.source?.startsWith('data:'))
  return { ...fig, layout: { ...fig.layout, ...(images && { images }) } as PlotlyFigure['layout'] }
}
