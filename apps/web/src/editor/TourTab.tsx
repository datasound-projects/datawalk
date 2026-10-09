import { useState } from 'react'
import { activeMembers } from '../layouts/items'
import { displayName, type Report, type TourStop } from '../state/schema'
import { rich, t } from '../i18n'
import { useViewer } from '../state/store'
import { defaultTour, tourStops } from '../tour/tour'
import { newId } from './ops'
import { Text } from './Text'

const KIND = { room: 'kind.room', visualization: 'kind.chart', dashboard: 'kind.dashboard' } as const

/** The tour as the editor shows it: the saved tour, or the default order until the first edit.
 *  Default stops use their ref as id (stable between renders and the edit that saves them). */
const editable = (r: Report): TourStop[] => (r.tour.length ? r.tour : defaultTour(r))

/** Tour tab: order the stops, add and remove them, write speaker notes, set auto-play times. */
export function TourTab({ report }: { report: Report }) {
  const edit = useViewer((s) => s.edit)
  const stops = tourStops({ ...report, tour: editable(report) })
  const [adding, setAdding] = useState('')
  const change = (f: (tour: TourStop[]) => TourStop[]) => edit((r) => void (r.tour = f(editable(r))))
  // Swap with the neighbouring stop that the list shows (stops of removed charts are hidden).
  const move = (i: number, d: number) => {
    const [a, b] = [stops[i]?.stop.id, stops[i + d]?.stop.id]
    if (!a || !b) return
    change((t) => {
      const [x, y] = [t.findIndex((s) => s.id === a), t.findIndex((s) => s.id === b)]
      if (x >= 0 && y >= 0) [t[x], t[y]] = [t[y], t[x]]
      return t
    })
  }
  const candidates: [string, string][] = report.rooms.flatMap((room) => [
    [room.id, t('common.roomOption', { room: room.name })] as [string, string],
    ...room.items.flatMap((id): [string, string][] => {
      const v = report.visualizations.find((x) => x.id === id && x.status === 'active')
      if (v) return [[id, `${room.name} › ${displayName(v)}`]]
      const d = report.dashboards.find((x) => x.id === id)
      return d && activeMembers(report, id).length ? [[id, `${room.name} › ${t('tourTab.dashboard', { name: d.name })}`]] : []
    }),
  ])

  return (
    <>
      <section className="panel">
        <h3>{t('tourTab.title')}</h3>
        <p className="muted">
          {rich('tourTab.intro', { pageDown: <kbd>Page Down</kbd>, pageUp: <kbd>Page Up</kbd>, p: <kbd>P</kbd> })}
          {!report.tour.length && ` ${t('tourTab.defaultOrder')}`}
        </p>
        <div className="row">
          <button onClick={() => edit((r) => void (r.tour = []))} disabled={!report.tour.length}>
            {t('tourTab.reset')}
          </button>
        </div>
      </section>
      <ol className="tour-stops">
        {stops.map((s, i) => (
          <li key={s.stop.id} className="panel">
            <div className="panel-head">
              <strong>
                {i + 1}. {s.title}
              </strong>
              <span className="muted">{t(KIND[s.kind])}</span>
              <div className="row">
                <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('tourTab.moveUp', { n: i + 1 })}>
                  ↑
                </button>
                <button onClick={() => move(i, 1)} disabled={i === stops.length - 1} aria-label={t('tourTab.moveDown', { n: i + 1 })}>
                  ↓
                </button>
                <button onClick={() => change((t) => t.filter((x) => x.id !== s.stop.id))} aria-label={t('tourTab.removeStop', { n: i + 1 })}>
                  {t('tourTab.remove')}
                </button>
              </div>
            </div>
            <Text
              label={t('tourTab.notes', { n: i + 1 })}
              value={s.stop.notes}
              multiline
              onCommit={(v) => change((t) => t.map((x) => (x.id === s.stop.id ? { ...x, notes: v } : x)))}
            />
            <label className="field inline">
              <span>{t('tourTab.seconds')}</span>
              <input
                type="number"
                min={1}
                max={3600}
                key={s.stop.duration ?? ''}
                defaultValue={s.stop.duration ?? ''}
                placeholder="10"
                aria-label={t('tourTab.secondsFor', { n: i + 1 })}
                onBlur={(e) => {
                  const v = e.target.value === '' ? null : Math.min(3600, Math.max(1, Number(e.target.value)))
                  if (v !== s.stop.duration) change((t) => t.map((x) => (x.id === s.stop.id ? { ...x, duration: v } : x)))
                }}
              />
            </label>
          </li>
        ))}
      </ol>
      <section className="panel row">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={t('tourTab.stopToAdd')}>
          <option value="">{t('tourTab.addStop')}</option>
          {candidates.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <button
          disabled={!adding}
          onClick={() => {
            change((t) => [...t, { id: newId(), ref: adding, notes: '', duration: null }])
            setAdding('')
          }}
        >
          {t('tourTab.addEnd')}
        </button>
      </section>
    </>
  )
}
