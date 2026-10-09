// Flat view: the report as an accessible document. No WebGL: the fallback for devices without
// 3D, for screen readers and keyboard users, and the layout for print and PDF.
import { useEffect, useRef, useState } from 'react'
import { datasetUrl, loadPayload } from '../app/api'
import { chartImageUrl } from '../charts/images'
import { rich, t } from '../i18n'
import { activeMembers } from '../layouts/items'
import { displayName, type Payload, type Report, type Room, type Visualization } from '../state/schema'
import { setFlat, useViewer } from '../state/store'
import type { PlotlyFigure } from '../charts/plotly'
import { BrandMark } from './Overlays'
import { BokehChart, EXPLANATION_LABELS, KpiView, modeLabel, PlotlyChart, TableView, TextView, VegaChart } from './Inspector'

export const roomAnchor = (room: Room) => `room-${room.key ?? room.id}`
export const vizAnchor = (v: Visualization) => `viz-${v.key}`

type Shown = { viz: Visualization; anchor: string }
type Entry = Shown | { name: string; description: string; members: Shown[] }

/** Rooms with their items in order. A chart can appear twice (a summary KPI is also on its
 *  dashboard): the first occurrence gets viz-<key>, later ones viz-<key>-2, ... (unique ids). */
function flatSections(report: Report): { room: Room; entries: Entry[] }[] {
  const seen = new Map<string, number>()
  const shown = (viz: Visualization): Shown => {
    const n = (seen.get(viz.key) ?? 0) + 1
    seen.set(viz.key, n)
    return { viz, anchor: n === 1 ? vizAnchor(viz) : `${vizAnchor(viz)}-${n}` }
  }
  return report.rooms.map((room) => ({
    room,
    entries: room.items.flatMap((id): Entry[] => {
      const v = report.visualizations.find((x) => x.id === id)
      if (v) return v.status === 'active' ? [shown(v)] : []
      const d = report.dashboards.find((x) => x.id === id)
      const members = d ? activeMembers(report, d.id) : []
      return d && members.length ? [{ name: d.name, description: d.description, members: members.map(shown) }] : []
    }),
  }))
}

// Images still loading; print and PDF export wait for zero (window.datawalkFlatReady).
let pending = 0
const track = (delta: number) => {
  pending += delta
  ;(window as { datawalkFlatReady?: boolean }).datawalkFlatReady = pending === 0
  if (pending === 0) dispatchEvent(new Event('datawalk-flat-ready'))
}

/** Alt text from the chart name, description, and axes. */
export function altText(viz: Visualization) {
  const axes = viz.source.axes
    .map((a) => [a.title, a.x.label && `x: ${a.x.label}`, a.y.label && `y: ${a.y.label}`, a.z?.label && `z: ${a.z.label}`].filter(Boolean).join(', '))
    .filter(Boolean)
  return [
    t('flat.alt', { name: displayName(viz) }),
    viz.overrides.description,
    axes.length ? t('flat.altAxes', { axes: axes.join('; ') }) : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function ChartImage({ viz }: { viz: Visualization }) {
  const [state, setState] = useState<{ url: string | null; done: boolean }>({ url: null, done: false })
  useEffect(() => {
    track(1)
    let live = true
    chartImageUrl(viz)
      .catch(() => null)
      .then((url) => live && setState({ url, done: true }))
      .finally(() => track(-1))
    return () => {
      live = false
    }
  }, [viz])
  if (!state.done) return <p className="muted">{t('flat.loadingChart')}</p>
  if (!state.url) return <p className="muted">{t('flat.noImage')}</p>
  return <img src={state.url} alt={altText(viz)} />
}

/** The interactive chart (Plotly or Vega-Lite), loaded when it scrolls near the screen. The
 *  image stays underneath for print and PDF (print styles hide the interactive chart). */
function LazyInteractive({ viz }: { viz: Visualization }) {
  const ref = useRef<HTMLDivElement>(null)
  const [payload, setPayload] = useState<Payload | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        loadPayload(viz.id).then(setPayload, console.error)
      },
      { rootMargin: '400px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [viz])
  return (
    <div ref={ref} className="flat-interactive">
      {payload?.kind === 'plotly' && <PlotlyChart figure={payload.figure as PlotlyFigure} />}
      {payload?.kind === 'vegalite' && <VegaChart spec={payload.spec} />}
      {payload?.kind === 'bokeh' && <BokehChart item={payload.item} version={payload.version} />}
    </div>
  )
}

function Panel({ viz }: { viz: Visualization }) {
  const [payload, setPayload] = useState<Payload | null | 'failed'>(null)
  useEffect(() => {
    loadPayload(viz.id).then(setPayload, (e) => {
      console.error(e)
      setPayload('failed')
    })
  }, [viz])
  if (payload === 'failed') return <p className="muted">{t('flat.failed')}</p>
  if (payload?.kind === 'kpi') return <KpiView p={payload} />
  if (payload?.kind === 'table') return <TableView p={payload} />
  if (payload?.kind === 'text') return <TextView p={payload} flat />
  return <p className="muted">{t('flat.loading')}</p>
}

function Chart({ viz, anchor, level }: Shown & { level: 2 | 3 }) {
  const { report, inspect } = useViewer()
  const ex = viz.overrides.explanation
  const H = level === 2 ? 'h3' : 'h4'
  const panel = viz.source.has_payload && ['kpi', 'table', 'text'].includes(viz.source.chart_type)
  const datasets = report!.datasets.filter((d) => d.visualizations.includes(viz.id))
  return (
    <article id={anchor} className="flat-chart" tabIndex={-1} aria-labelledby={`${anchor}-title`}>
      <H id={`${anchor}-title`}>
        <a href={`#${anchor}`} className="anchor">
          {displayName(viz)}
        </a>
      </H>
      {/* The image keeps its space while it loads, so deep links stay on target. */}
      <div className="flat-figure" style={panel ? undefined : { aspectRatio: viz.source.aspect }}>
        {panel ? <Panel viz={viz} /> : <ChartImage viz={viz} />}
        {!panel && viz.source.mode === 'interactive' && <LazyInteractive viz={viz} />}
      </div>
      <div className="flat-text">
        <p className="muted">{modeLabel(viz)}</p>
        {viz.overrides.description && <p>{viz.overrides.description}</p>}
        {ex.findings.length > 0 && (
          <>
            <p>
              <strong>{t('inspector.findings')}</strong>
            </p>
            <ul>
              {ex.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </>
        )}
        {EXPLANATION_LABELS.filter(([k]) => ex[k]).map(([k, label]) => (
          <p key={k}>
            <strong>{t(label)}:</strong> {ex[k] as string}
          </p>
        ))}
        {datasets.map((d) => (
          <p key={d.id}>
            <a href={datasetUrl(d.id)} download={`${d.key}.csv`}>
              {t('flat.download', { name: d.name })}
            </a>{' '}
            <span className="muted">{t('flat.csvRows', { rows: d.rows.toLocaleString() })}</span>
          </p>
        ))}
        {viz.source.mode === 'interactive' && (
          <button className="no-print" onClick={() => inspect(viz.id)}>
            {t('flat.openInteractive')}
          </button>
        )}
      </div>
    </article>
  )
}

export function FlatView({ report }: { report: Report }) {
  const { gpu, roomId, exportInfo } = useViewer()
  const sections = flatSections(report)

  // Arrive where the visitor was: the deep link, else the room they walked in. Tables and
  // panels change height as they load: arrive again when all is loaded, unless the visitor moved.
  useEffect(() => {
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
    const { roomId, started } = useViewer.getState()
    const room = started ? report.rooms.find((r) => r.id === roomId) : undefined // came from 3D
    const el = target ?? (room && document.getElementById(roomAnchor(room)))
    el?.scrollIntoView({ behavior: 'instant' })
    let moved = false
    const onMove = () => (moved = true)
    const again = () => !moved && el?.scrollIntoView({ behavior: 'instant' })
    const events = ['wheel', 'keydown', 'pointerdown', 'touchstart'] as const
    for (const e of events) addEventListener(e, onMove, { once: true })
    addEventListener('datawalk-flat-ready', again)
    return () => {
      for (const e of events) removeEventListener(e, onMove)
      removeEventListener('datawalk-flat-ready', again)
    }
  }, [report])

  // Keep roomId on the section in view, so that "Walk in 3D" opens the same room.
  useEffect(() => {
    const scroller = document.querySelector('.flat')
    const onScroll = () => {
      const sections = [...document.querySelectorAll<HTMLElement>('.flat-room')]
      const current = sections.filter((s) => s.getBoundingClientRect().top < 120).pop() ?? sections[0]
      const id = current?.dataset.room
      if (id && id !== useViewer.getState().roomId) useViewer.getState().enterRoom(id)
    }
    scroller?.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller?.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="flat">
      <a className="skip-link" href="#flat-main">
        {t('flat.skip')}
      </a>
      <header className="flat-header">
        <div>
          <BrandMark report={report} />
          <p className="eyebrow">{t('flat.eyebrow')}</p>
          <h1>{report.name}</h1>
          {report.description && <p>{report.description}</p>}
          {exportInfo && (
            <p className="muted">
              {rich('export.stamp', {
                revision: exportInfo.revision,
                date: new Date(exportInfo.exported_at).toLocaleString(),
                hash: <code>{exportInfo.hash.slice(0, 19)}</code>,
              })}
            </p>
          )}
        </div>
        <div className="row no-print">
          {gpu.webgl ? (
            <button className="primary" onClick={() => setFlat(false)}>
              {t('flat.walk3d')}
            </button>
          ) : (
            <p className="muted">{t('flat.noWebgl')}</p>
          )}
          <button onClick={() => print()}>{t('flat.print')}</button>
        </div>
        {gpu.webgl && gpu.software && (
          <p className="muted no-print">{t('flat.software')}</p>
        )}
      </header>
      <nav className="flat-toc" aria-label={t('flat.contents')}>
        <h2>{t('flat.contents')}</h2>
        <ol>
          {sections.map(({ room, entries }) => (
            <li key={room.id}>
              <a href={`#${roomAnchor(room)}`} aria-current={room.id === roomId ? 'location' : undefined}>
                {room.name}
              </a>
              <ol>
                {entries.flatMap((e) => ('viz' in e ? [e] : e.members)).map(({ viz: v, anchor }) => (
                  <li key={anchor}>
                    <a href={`#${anchor}`}>{displayName(v)}</a>
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </nav>
      <main id="flat-main" tabIndex={-1}>
        {!sections.length && <p className="muted">{t('lobby.noRooms')}</p>}
        {sections.map(({ room, entries }) => (
          <section key={room.id} id={roomAnchor(room)} className="flat-room" data-room={room.id} aria-labelledby={`${roomAnchor(room)}-title`}>
            <h2 id={`${roomAnchor(room)}-title`}>{room.name}</h2>
            {room.description && <p>{room.description}</p>}
            {entries.map((e) =>
              'viz' in e ? (
                <Chart key={e.anchor} {...e} level={2} />
              ) : (
                <section key={e.name} className="flat-dashboard" aria-label={e.name}>
                  <h3>{e.name}</h3>
                  {e.description && <p>{e.description}</p>}
                  {e.members.map((m) => (
                    <Chart key={m.anchor} {...m} level={3} />
                  ))}
                </section>
              ),
            )}
          </section>
        ))}
      </main>
    </div>
  )
}
