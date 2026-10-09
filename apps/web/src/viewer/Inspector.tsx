import { useEffect, useRef, useState } from 'react'
import { datasetUrl, loadPayload, previewUrl } from '../app/api'
import { deltaTone } from '../charts/panels'
import { offline, plotly, type PlotlyFigure } from '../charts/plotly'
import { embedBokeh } from '../charts/bokeh'
import { embedVega, svgUrl } from '../charts/vega'
import { isExhibit } from '../layouts/items'
import { lockPointer } from '../navigation/input'
import { displayName, type Payload, type Visualization } from '../state/schema'
import { useViewer } from '../state/store'
import { Comments } from '../hub/HubUI'
import { type MessageKey, rich, t } from '../i18n'
import { LinkedView } from './LinkedView'
import { Markdown } from './Markdown'

/** Explanation fields and their label keys (t(label) at render, in the current language). */
export const EXPLANATION_LABELS: [keyof Visualization['overrides']['explanation'], MessageKey][] = [
  ['what_it_shows', 'explanation.what_it_shows'],
  ['inputs', 'explanation.inputs'],
  ['units', 'explanation.units'],
  ['data_source', 'explanation.data_source'],
  ['interpretation', 'explanation.interpretation'],
  ['methodology', 'explanation.methodology'],
  ['assumptions', 'explanation.assumptions'],
  ['limitations', 'explanation.limitations'],
  ['author', 'explanation.author'],
]

const MAX_ROWS = 200

/** A data value as text: a missing value is a dash, a date at midnight is the date only. */
const cell = (v: unknown) =>
  v === null || v === undefined ? '–' : String(v).replace(/^(\d{4}-\d{2}-\d{2})T00:00:00(\.0+)?(Z|\+00:00)?$/, '$1')
const MAX_TABLE_ROWS = 1000

export function modeLabel(viz: Visualization) {
  if (viz.source.chart_type === 'kpi') return t('mode.kpi')
  if (viz.source.chart_type === 'text') return t('mode.text')
  if (viz.source.library === 'vega-lite') return t('mode.vegalite')
  if (viz.source.library === 'bokeh') return t('mode.bokeh')
  if (viz.source.library === 'svg') return t('mode.svg')
  if (viz.source.chart_type === 'table') return t('mode.table')
  return t(`mode.${viz.source.mode}`)
}

/** What a stakeholder can and cannot do with this visualization. */
export function capabilities(viz: Visualization): [string, boolean][] {
  if (viz.source.chart_type === 'text') return []
  if (viz.source.library === 'vega-lite' || viz.source.library === 'bokeh')
    return [
      [t('caps.selections'), true],
      [t('caps.exactValues'), true],
    ]
  const interactive = viz.source.mode === 'interactive'
  return [
    [t('caps.zoom'), interactive],
    [t('caps.hover'), interactive],
    [t('caps.exactValues'), viz.source.mode !== 'static'],
    [t('caps.exhibit'), isExhibit(viz)],
  ]
}

type Kpi = Extract<Payload, { kind: 'kpi' }>
type Table = Extract<Payload, { kind: 'table' }>
type Text = Extract<Payload, { kind: 'text' }>

/** Go to a chart: its room, then its inspector (or its section in the flat view). */
export function reach(viz: Visualization) {
  const s = useViewer.getState()
  const report = s.report!
  const room = report.rooms.find(
    (r) => r.items.includes(viz.id) || report.dashboards.some((d) => r.items.includes(d.id) && d.items.includes(viz.id)),
  )
  if (room) s.enterRoom(room.id)
  if (s.flat) {
    s.setOverlay(null)
    location.hash = `viz-${viz.key}`
  } else s.inspect(viz.id)
}

/** Text panel: the Markdown, and the charts it refers to (summary findings link to evidence). */
export function TextView({ p, flat = false }: { p: Text; flat?: boolean }) {
  const all = useViewer((s) => s.report!.visualizations)
  const evidence = p.links.flatMap((k) => all.filter((v) => v.key === k && v.status === 'active'))
  return (
    <div className="text-view">
      <Markdown source={p.markdown} headingBase={flat ? 3 : 2} />
      {evidence.length > 0 && (
        <p>
          <strong>{t('text.evidence')} </strong>
          {evidence.map((v, i) => (
            <span key={v.id}>
              {i > 0 && ' · '}
              {flat ? (
                <a href={`#viz-${v.key}`}>{displayName(v)}</a>
              ) : (
                <button className="link evidence" onClick={() => reach(v)}>
                  {displayName(v)}
                </button>
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  )
}

export function KpiView({ p }: { p: Kpi }) {
  const arrow = p.delta === null ? '' : p.delta > 0 ? '▲' : p.delta < 0 ? '▼' : '■'
  return (
    <div className="kpi-view">
      <div className="kpi-value">
        {p.display}
        {p.unit && <span className="kpi-unit"> {p.unit}</span>}
      </div>
      {p.delta !== null && (
        <div className={`kpi-delta ${deltaTone(p)}`}>
          {arrow} {p.delta_display}
        </div>
      )}
      <p className="muted">
        {rich('kpi.exactValue', { value: <code>{String(p.value)}</code> })}
        {p.delta !== null && (
          <>
            {' '}
            ·{' '}
            {rich('kpi.exactChange', {
              delta: <code>{p.delta}</code>,
              direction: t(p.higher_is_better ? 'kpi.higherBetter' : 'kpi.lowerBetter'),
            })}
          </>
        )}
      </p>
    </div>
  )
}

export function TableView({ p }: { p: Table }) {
  // A column of numbers aligns right, with its header; text aligns left.
  const num = p.columns.map((_, j) => (typeof p.rows.find((r) => r[j] !== null)?.[j] === 'number' ? 'num' : undefined))
  return (
    <div className="table-view">
      <table>
        <thead>
          <tr>
            {p.columns.map((c, i) => (
              <th key={i} className={num[i]}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.slice(0, MAX_TABLE_ROWS).map((r, i) => (
            <tr key={i}>
              {r.map((v, j) => (
                <td key={j} className={num[j]}>
                  {v === null ? '' : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        {t('table.shown', { shown: Math.min(p.rows.length, MAX_TABLE_ROWS).toLocaleString(), total: p.total_rows.toLocaleString() })}
      </p>
    </div>
  )
}

/** Full-screen DOM inspection of one visualization. */
export function Inspector({ viz }: { viz: Visualization }) {
  const setOverlay = useViewer((s) => s.setOverlay)
  const report = useViewer((s) => s.report)!
  const [payload, setPayload] = useState<Payload | null>(null)
  const link = report.links.find((l) => l.items.includes(viz.id))
  const datasets = report.datasets.filter((d) => d.visualizations.includes(viz.id))
  const [view, setView] = useState<'original' | 'linked'>('original')
  const ex = viz.overrides.explanation

  useEffect(() => {
    if (viz.source.has_payload) loadPayload(viz.id).then(setPayload, console.error)
  }, [viz])

  const flat = useViewer((s) => s.flat)
  const hub = useViewer((s) => s.hub)
  const back = () => {
    setOverlay(null)
    if (flat) document.getElementById(`viz-${viz.key}`)?.focus()
    else lockPointer()
  }

  return (
    <div className="overlay inspector" role="dialog" aria-label={displayName(viz)}>
      <header>
        <div>
          <h2>{displayName(viz)}</h2>
          <span className={`badge ${viz.source.mode}`}>{modeLabel(viz)}</span>
          <span className="muted"> · {viz.source.library}</span>
        </div>
        <button onClick={back} autoFocus>
          {flat ? t('inspector.backReport') : t('inspector.backRoom')}
        </button>
      </header>
      <div className="inspector-body">
        <div className="chart">
          {link && (
            <div className="view-tabs" role="tablist">
              <button role="tab" aria-selected={view === 'original'} className={view === 'original' ? 'active' : ''} onClick={() => setView('original')}>
                {t('inspector.original')}
              </button>
              <button role="tab" aria-selected={view === 'linked'} className={view === 'linked' ? 'active' : ''} onClick={() => setView('linked')}>
                {t('inspector.linked', { n: link.items.length })}
              </button>
            </div>
          )}
          {link && view === 'linked' ? (
            <LinkedView link={link} report={report} />
          ) : payload?.kind === 'plotly' ? (
            <PlotlyChart figure={payload.figure as PlotlyFigure} />
          ) : payload?.kind === 'kpi' ? (
            <KpiView p={payload} />
          ) : payload?.kind === 'table' ? (
            <TableView p={payload} />
          ) : payload?.kind === 'text' ? (
            <TextView p={payload} />
          ) : payload?.kind === 'vegalite' ? (
            <VegaChart spec={payload.spec} />
          ) : payload?.kind === 'bokeh' ? (
            <BokehChart item={payload.item} version={payload.version} />
          ) : payload?.kind === 'svg' ? (
            <img src={svgUrl(payload.svg)} alt={displayName(viz)} />
          ) : viz.source.has_preview ? (
            <img src={previewUrl(viz.id)} alt={displayName(viz)} />
          ) : viz.source.has_payload ? null : (
            <p className="muted">{t('inspector.noImage')}</p>
          )}
        </div>
        <aside>
          {viz.overrides.description ? <p>{viz.overrides.description}</p> : null}
          {ex.findings.length > 0 && (
            <section>
              <h3>{t('inspector.findings')}</h3>
              <ul>
                {ex.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </section>
          )}
          {EXPLANATION_LABELS.filter(([k]) => ex[k]).map(([k, label]) => (
            <section key={k}>
              <h3>{t(label)}</h3>
              <p>{ex[k] as string}</p>
            </section>
          ))}
          {datasets.length > 0 && (
            <section>
              <h3>{t('inspector.data')}</h3>
              <ul>
                {datasets.map((d) => (
                  <li key={d.id}>
                    <a href={datasetUrl(d.id)} download={`${d.key}.csv`}>
                      {d.name}
                    </a>{' '}
                    <span className="muted">
                      {t('inspector.csv', { rows: d.rows.toLocaleString(), columns: d.columns.length })}
                    </span>
                    {d.description && <p className="muted">{d.description}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {capabilities(viz).length > 0 && (
          <section>
            <h3>{t('inspector.caps')}</h3>
            <ul className="caps">
              {capabilities(viz).map(([label, ok]) => (
                <li key={label} className={ok ? 'yes' : 'no'}>
                  {ok ? '✓' : '–'} {label}
                  {!ok && <span className="muted"> {t('caps.notAvailable')}</span>}
                </li>
              ))}
            </ul>
          </section>
          )}
          <ProvenanceView viz={viz} />
          {hub && <Comments vizKey={viz.key} />}
          {viz.source.axes.length > 0 && (
          <section>
            <h3>{t('inspector.axes')}</h3>
            {viz.source.axes.map((a, i) => (
              <p key={i} className="axes">
                {a.title && <strong>{a.title}: </strong>}x: {a.x.label || t('inspector.unlabeled')} [{a.x.scale}] · y:{' '}
                {a.y.label || t('inspector.unlabeled')} [{a.y.scale}]
                {a.z && ` · z: ${a.z.label || t('inspector.unlabeled')} [${a.z.scale}]`}
              </p>
            ))}
          </section>
          )}
          {viz.source.limitations.length > 0 && (
            <section>
              <h3>{t('inspector.importLimitations')}</h3>
              <ul>
                {viz.source.limitations.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </section>
          )}
          {payload?.kind === 'series' &&
            payload.series.map((s, i) => (
              <section key={i}>
                <h3>{t('inspector.series', { name: s.name, kind: s.kind, n: s.x.length })}</h3>
                <table>
                  <thead>
                    <tr>
                      <th>x</th>
                      <th>y</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.x.slice(0, MAX_ROWS).map((x, j) => (
                      <tr key={j}>
                        <td>{cell(x)}</td>
                        <td>{cell(s.y[j])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {s.x.length > MAX_ROWS && <p className="muted">{t('inspector.firstRows', { max: MAX_ROWS, n: s.x.length })}</p>}
              </section>
            ))}
        </aside>
      </div>
    </div>
  )
}

/** Interactive Vega-Lite chart (vega-embed, no external data). */
export function VegaChart({ spec }: { spec: Record<string, unknown> }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dispose: (() => void) | null = null
    let live = true
    embedVega(el, spec).then((d) => (live ? (dispose = d) : d()), console.error)
    return () => {
      live = false
      dispose?.()
    }
  }, [spec])
  return <div ref={ref} className="vega-host" />
}

/** Interactive Bokeh chart (BokehJS of the chart's version). */
export function BokehChart({ item, version }: { item: Record<string, unknown>; version: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let dispose: (() => void) | null = null
    let live = true
    embedBokeh(el, item, version).then(
      (d) => (live ? (dispose = d) : d()),
      (e) => live && setError(String(e)),
    )
    return () => {
      live = false
      dispose?.()
    }
  }, [item, version])
  return error ? <p className="warn">{error}</p> : <div ref={ref} className="bokeh-host" />
}

/** Where an imported chart comes from: file, notebook cell, hash, and the code. */
function ProvenanceView({ viz }: { viz: Visualization }) {
  const p = viz.source.provenance
  if (!p) return null
  return (
    <section>
      <h3>{t('source.title')}</h3>
      <p className="muted">
        {t(p.kind === 'notebook' ? 'source.notebook' : p.kind === 'mlflow' ? 'source.mlflow' : 'source.file')}: <code>{p.path}</code>
        {p.cell_id && (
          <>
            {' '}
            · {t('source.cell')} <code>{p.cell_id}</code>
          </>
        )}
        {p.output_index !== null && <> · {t('source.output', { n: p.output_index })}</>}
        {p.execution_count !== null && <> · {t('source.execution', { n: p.execution_count })}</>}
        {p.sha256 && (
          <>
            {' '}
            · <code title={`SHA-256 ${p.sha256}`}>{p.sha256.slice(0, 12)}</code>
          </>
        )}
      </p>
      {p.code && (
        <details>
          <summary>{t('source.show')}</summary>
          <pre className="source-code">
            <code>{p.code}</code>
          </pre>
        </details>
      )}
    </section>
  )
}

export function PlotlyChart({ figure }: { figure: PlotlyFigure }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fig = offline(figure)
    // Let the panel size the chart; everything else is the original figure.
    const layout = { ...fig.layout, autosize: true, width: undefined, height: undefined }
    let Plotly: Awaited<ReturnType<typeof plotly>> | null = null
    let live = true // closed before Plotly loaded: draw nothing
    plotly().then(async (P) => {
      if (!live) return
      Plotly = P
      await P.newPlot(el, fig.data, layout, { responsive: true, displaylogo: false })
      if (fig.frames?.length) await P.addFrames(el, fig.frames)
    })
    return () => {
      live = false
      Plotly?.purge(el)
    }
  }, [figure])
  return <div ref={ref} className="plotly-host" />
}
