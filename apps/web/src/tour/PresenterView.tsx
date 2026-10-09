// The presenter's window: speaker notes, the current and the next stop, and a timer.
// It controls the audience window through the tour channel (see tour.ts).
import { useEffect, useMemo, useState } from 'react'
import { asset } from '../app/assets'
import { chartImageUrl } from '../charts/images'
import { t } from '../i18n'
import { activeMembers } from '../layouts/items'
import type { Report } from '../state/schema'
import { roomTheme } from '../state/store'
import { connect, sendGo, sendHello, type Stop, type TourMessage, tourStops } from './tour'

function Thumb({ report, stop }: { report: Report; stop: Stop | undefined }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!stop) return
    const room = report.rooms.find((r) => r.id === stop.roomId)!
    const viz =
      stop.kind === 'visualization'
        ? report.visualizations.find((v) => v.id === stop.stop.ref)
        : stop.kind === 'dashboard'
          ? activeMembers(report, stop.stop.ref)[0]
          : undefined
    const load = viz ? chartImageUrl(viz) : Promise.resolve(asset(`themes/${roomTheme(report, room, null)}/preview.jpg`))
    load.then((u) => live && setUrl(u), () => live && setUrl(null))
    return () => {
      live = false
    }
  }, [report, stop])
  if (!stop) return <div className="thumb empty">{t('presenter.end')}</div>
  return <div className="thumb">{url ? <img src={url} alt="" /> : <span className="muted">{stop.title}</span>}</div>
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function PresenterView({ report }: { report: Report }) {
  const stops = useMemo(() => tourStops(report), [report]) // stable: the clock re-renders twice a second
  const [state, setState] = useState<{ presenting: boolean; index: number; startedAt: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const off = connect(report.id, (m: TourMessage) => m.type === 'state' && setState(m))
    sendHello()
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => {
      off()
      clearInterval(t)
    }
  }, [report.id])

  const index = state?.index ?? 0
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const go = (i: number) => {
        e.preventDefault()
        sendGo(Math.min(Math.max(i, 0), stops.length - 1))
      }
      if (['ArrowRight', 'PageDown', 'Space'].includes(e.code)) go(state?.presenting ? index + 1 : index)
      else if (['ArrowLeft', 'PageUp'].includes(e.code)) go(index - 1)
      else if (e.code === 'Home') go(0)
      else if (e.code === 'End') go(stops.length - 1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [index, state?.presenting, stops.length])

  const current = stops[index]
  return (
    <div className="presenter">
      <header className="row">
        <h1>{report.name}</h1>
        <span className="timer" aria-label={t('presenter.elapsed')}>
          {state?.presenting ? clock(now - state.startedAt) : '0:00'}
        </span>
      </header>
      {!state && <p className="notice">{t('presenter.waiting')}</p>}
      {state && !state.presenting && <p className="notice">{t('presenter.notStarted')}</p>}
      <div className="presenter-grid">
        <section aria-label={t('presenter.current')}>
          <h2>
            {index + 1} / {stops.length} · {current?.title}
          </h2>
          <Thumb report={report} stop={current} />
        </section>
        <section aria-label={t('presenter.next')}>
          <h2 className="muted">{t('presenter.nextTitle', { title: stops[index + 1]?.title ?? '—' })}</h2>
          <Thumb report={report} stop={stops[index + 1]} />
        </section>
      </div>
      <section className="notes" aria-label={t('presenter.speakerNotes')}>
        <h2>{t('presenter.notes')}</h2>
        {current?.stop.notes ? <p>{current.stop.notes}</p> : <p className="muted">{t('presenter.noNotes')}</p>}
      </section>
      <div className="row">
        <button onClick={() => sendGo(Math.max(index - 1, 0))}>{t('presenter.back')}</button>
        <button className="primary" onClick={() => sendGo(state?.presenting ? Math.min(index + 1, stops.length - 1) : index)}>
          {t('presenter.forward')}
        </button>
      </div>
    </div>
  )
}
