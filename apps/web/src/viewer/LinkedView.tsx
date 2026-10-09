import { useEffect, useMemo, useRef, useState } from 'react'
import { loadPayload } from '../app/api'
import { offline, plotly, type PlotlyFigure } from '../charts/plotly'
import { t } from '../i18n'
import { displayName, type Link, type Payload, type Report, type Visualization } from '../state/schema'

type PlotlyModule = Awaited<ReturnType<typeof plotly>>
type Range = [string | number, string | number]

/** A chart figure for the linked view: the original Plotly figure, or a plot of the
 *  extracted series (labeled as such: it is not the original image). */
function linkedFigure(viz: Visualization, p: Payload): PlotlyFigure | null {
  if (p.kind === 'plotly') return offline(p.figure as PlotlyFigure)
  if (p.kind !== 'series') return null
  const ax = viz.source.axes[0]
  return {
    data: p.series.map((s) => ({
      type: 'scatter',
      mode: s.kind === 'line' ? 'lines' : 'markers',
      name: s.name,
      x: s.x as (string | number | null)[],
      y: s.y as (string | number | null)[],
    })),
    layout: {
      title: { text: `${displayName(viz)} <span style="font-size:11px">${t('linked.extracted')}</span>` },
      xaxis: { title: { text: ax?.x.label ?? '' } },
      yaxis: { title: { text: ax?.y.label ?? '' }, type: ax?.y.scale === 'log' ? 'log' : undefined },
    },
  }
}

const band = (r: Range) => [
  { type: 'rect' as const, xref: 'x' as const, yref: 'paper' as const, x0: r[0], x1: r[1], y0: 0, y1: 1, fillcolor: 'rgba(217,164,65,0.2)', line: { width: 0 } },
]

/** Charts that share x values: zoom one and all follow; box-select a range to mark it in all. */
export function LinkedView({ link, report }: { link: Link; report: Report }) {
  const members = useMemo(
    () =>
      link.items
        .map((id) => report.visualizations.find((v) => v.id === id))
        .filter((v): v is Visualization => v?.status === 'active'),
    [link, report],
  )
  const hosts = useRef<(HTMLDivElement | null)[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let P: PlotlyModule | null = null
    const els: HTMLDivElement[] = []
    ;(async () => {
      P = await plotly()
      const figs = await Promise.all(members.map(async (m) => linkedFigure(m, await loadPayload(m.id))))
      if (!alive) return
      let syncing = false
      const apply = async (update: Record<string, unknown>, except: HTMLDivElement) => {
        if (syncing) return
        syncing = true
        await Promise.all(els.filter((e) => e !== except).map((e) => P!.relayout(e, update)))
        syncing = false
      }
      for (const [i, fig] of figs.entries()) {
        const el = hosts.current[i]
        if (!el || !fig) continue
        els.push(el)
        await P.newPlot(el, fig.data, { ...fig.layout, height: 280, margin: { t: 40, r: 20, b: 40, l: 60 }, dragmode: 'zoom' }, {
          responsive: true,
          displaylogo: false,
          modeBarButtonsToAdd: ['select2d'],
        })
        const gd = el as unknown as { on: (ev: string, fn: (e: Record<string, unknown>) => void) => void }
        gd.on('plotly_relayout', (e) => {
          if ('xaxis.range[0]' in e) apply({ 'xaxis.range[0]': e['xaxis.range[0]'], 'xaxis.range[1]': e['xaxis.range[1]'] }, el)
          else if ('xaxis.autorange' in e) apply({ 'xaxis.autorange': true }, el)
        })
        gd.on('plotly_selected', (e) => {
          const r = (e?.range as { x?: Range } | undefined)?.x
          if (!r) return
          syncing = false
          for (const x of els) P!.relayout(x, { shapes: band(r) })
        })
      }
    })().catch((e) => setError(String(e)))
    return () => {
      alive = false
      for (const e of els) P?.purge(e)
    }
  }, [members])

  return (
    <div className="linked">
      <p className="muted">
        {t('linked.help', { name: link.name })}
      </p>
      {error && <p className="warn">{error}</p>}
      {members.map((m, i) => (
        <div key={m.id} ref={(el) => void (hosts.current[i] = el)} className="linked-chart" aria-label={t('linked.chart', { name: displayName(m) })} />
      ))}
    </div>
  )
}
