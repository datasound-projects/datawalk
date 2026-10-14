// The AI guide's dock: the avatar in the bottom-right corner, its captions, and a small panel
// with the controls, the questions, and the plan. Loaded only when the server offers the guide.
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import { unlockPointer } from '../navigation/input'
import type { Report } from '../state/schema'
import { canEdit, useViewer, useViewerPick } from '../state/store'
import { activeStops, goTo, startTour } from '../tour/tour'
import { loadStatus, type Plan } from './api'
import { Avatar } from './Avatar'
import { listen, micSupported, stopListening } from './mic'
import { ask, editNarration, guideKey, loadPlan, type Message, pause, planTour, present, resume, stop, toggleGuide, useGuide } from './session'
import { setKokoro, setMuted } from './speech'

const LENGTHS = [3, 5, 10]

export function GuideDock({ report, hidden }: { report: Report; hidden: boolean }) {
  const g = useGuide()
  const { gpu } = useViewerPick('gpu')
  useEffect(() => {
    loadStatus()
      .then((status) => {
        setKokoro(status.voice.ok)
        useGuide.getState().set({ status })
      })
      .catch((e) => useGuide.getState().set({ phase: 'error', error: String(e) }))
    return () => stop()
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => void (guideKey(e) && e.preventDefault())
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <aside className={`guide${g.open ? ' open' : ''}`} data-phase={g.phase} aria-label={t('guide.title')} hidden={hidden}>
      {g.open && <Panel report={report} />}
      {/* With the panel open, the caption shows inside it: a bubble here would move the panel
          (and its buttons) with every sentence. */}
      {g.caption && !g.open && (
        <p className="guide-caption" role="status" aria-live="polite">
          {g.caption}
        </p>
      )}
      {g.running && !g.open && <MiniControls />}
      <button
        className="guide-avatar"
        onClick={toggleGuide}
        aria-expanded={g.open}
        aria-keyshortcuts="X"
        aria-label={`${g.open ? t('guide.collapse') : t('guide.expand')} (${t(`guide.phase.${g.phase}`)})`}
        title={`${g.open ? t('guide.collapse') : t('guide.expand')} (X)`}
      >
        <Avatar phase={g.phase} webgl={gpu.webgl} />
        <span className="guide-state" aria-hidden>
          {t(`guide.phase.${g.phase}`)}
        </span>
      </button>
    </aside>
  )
}

const toggleMute = () => {
  const g = useGuide.getState()
  setMuted(!g.muted)
  g.set({ muted: !g.muted })
}

/** While the guide presents: the few controls that a presenter needs, next to the captions. */
function MiniControls() {
  const g = useGuide()
  return (
    <div className="guide-mini" role="toolbar" aria-label={t('guide.controls')}>
      {g.paused ? (
        <button className="primary" onClick={resume}>
          {t('guide.resume')}
        </button>
      ) : (
        <button onClick={() => pause()}>{t('guide.pause')}</button>
      )}
      <button
        onClick={() => {
          pause('question')
          g.set({ open: true, tab: 'ask' })
        }}
      >
        {t('guide.ask')}
      </button>
      <button onClick={stop}>{t('guide.stop')}</button>
      <button aria-pressed={g.muted} onClick={toggleMute}>
        {g.muted ? t('guide.unmute') : t('guide.mute')}
      </button>
    </div>
  )
}

function Panel({ report }: { report: Report }) {
  const g = useGuide()
  const input = useRef<HTMLInputElement>(null)
  const busy = g.phase === 'loading' || g.phase === 'thinking'
  const model = g.status?.model
  return (
    <section className="guide-panel">
      <header>
        <div>
          <h2>{t('guide.title')}</h2>
          <p className="muted">{model ? (model.ok ? t('guide.modelReady', { model: model.name }) : t('guide.noModel')) : t('guide.checking')}</p>
        </div>
        <button className="link" onClick={toggleGuide} aria-label={t('guide.collapse')} aria-keyshortcuts="X" title={`${t('guide.collapse')} (X)`}>
          ✕
        </button>
      </header>

      <div className="guide-controls">
        {!g.running ? (
          <>
            <select value={g.minutes} onChange={(e) => g.set({ minutes: Number(e.target.value) })} aria-label={t('guide.length')} disabled={busy}>
              {LENGTHS.map((m) => (
                <option key={m} value={m}>
                  {t('guide.minutes', { n: m })}
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => void present(report, g.minutes)} disabled={busy}>
              {t('guide.present')}
            </button>
          </>
        ) : g.paused ? (
          <button className="primary" onClick={resume}>
            {t('guide.resume')}
          </button>
        ) : (
          <button onClick={() => pause()}>{t('guide.pause')}</button>
        )}
        {g.running && <button onClick={stop}>{t('guide.stop')}</button>}
        <button
          onClick={() => {
            pause('question')
            g.set({ tab: 'ask' })
            setTimeout(() => input.current?.focus())
          }}
        >
          {t('guide.ask')}
        </button>
        <button aria-pressed={g.muted} onClick={toggleMute}>
          {g.muted ? t('guide.unmute') : t('guide.mute')}
        </button>
      </div>

      {g.caption && (
        <p className="guide-now" role="status" aria-live="polite">
          {g.caption}
        </p>
      )}
      {g.error && (
        <p className="guide-error" role="alert">
          {g.error}
        </p>
      )}

      <nav className="tabs" role="tablist">
        {(['ask', 'plan'] as const).map((tab) => (
          <button key={tab} role="tab" aria-selected={g.tab === tab} className={g.tab === tab ? 'active' : ''} onClick={() => g.set({ tab })}>
            {t(`guide.tab.${tab}`)}
          </button>
        ))}
      </nav>
      {g.tab === 'ask' ? <AskTab inputRef={input} /> : <PlanTab report={report} />}
      <details className="guide-health">
        <summary>{t('guide.health')}</summary>
        {g.status && (
          <ul>
            <li>{g.status.model.detail}</li>
            <li>{g.status.voice.detail}</li>
            <li>{g.status.face.detail}</li>
            <li>{micSupported ? t('guide.micLocal') : t('guide.micNone')}</li>
          </ul>
        )}
      </details>
    </section>
  )
}

function AskTab({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const g = useGuide()
  const lang = useViewer((s) => s.lang)
  const [text, setText] = useState('')
  const log = useRef<HTMLOListElement>(null)
  useEffect(() => void log.current?.lastElementChild?.scrollIntoView({ block: 'nearest' }), [g.messages.length]) // returns a Promise in new browsers
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (!text.trim()) return
    void ask(text)
    setText('')
  }
  const speak = async () => {
    if (g.phase === 'listening') return stopListening()
    pause('question')
    g.set({ phase: 'listening', error: null })
    try {
      const heard = await listen(lang, setText)
      useGuide.getState().set({ phase: 'idle' })
      if (heard) void ask(heard)
    } catch (e) {
      const reason = e instanceof Error && e.message === 'unavailable' ? t('guide.micUnavailable') : String(e)
      useGuide.getState().set({ phase: 'idle', error: reason })
    }
  }
  return (
    <>
      <ol className="guide-log" ref={log} aria-live="polite">
        {!g.messages.length && <li className="muted">{t('guide.askHint')}</li>}
        {g.messages.map((m) => (
          <MessageItem key={m.id} message={m} />
        ))}
      </ol>
      <form className="guide-ask" onSubmit={submit}>
        <input
          ref={inputRef}
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => pause('question')}
          placeholder={t('guide.askPlaceholder')}
          aria-label={t('guide.askLabel')}
        />
        {micSupported && (
          <button type="button" onClick={() => void speak()} aria-pressed={g.phase === 'listening'} title={t('guide.mic')}>
            {g.phase === 'listening' ? t('guide.micStop') : t('guide.mic')}
          </button>
        )}
        <button type="submit" className="primary" disabled={!text.trim() || g.phase === 'thinking'}>
          {t('guide.send')}
        </button>
      </form>
    </>
  )
}

function MessageItem({ message }: { message: Message }) {
  const a = message.answer
  if (message.role === 'visitor') return <li className="visitor">{message.text}</li>
  return (
    <li className="guide-answer">
      <p>{message.text}</p>
      {a?.interpretation && (
        <p className="muted">
          <strong>{t('guide.interpretation')}</strong> {a.interpretation}
        </p>
      )}
      {a?.caveats && (
        <p className="muted">
          <strong>{t('guide.caveat')}</strong> {a.caveats}
        </p>
      )}
      {!!a?.evidence.length && (
        <p className="guide-evidence">
          <span className="muted">{t('guide.evidence')}</span>
          {a.evidence.map((e) => (
            <button key={e.ref} className="link" onClick={() => showEvidence(e.ref)}>
              {e.title}
            </button>
          ))}
        </p>
      )}
      {!!a?.facts?.length && (
        <details className="guide-facts">
          <summary className="muted small">{t('guide.facts', { n: a.facts.length })}</summary>
          <ul className="small">
            {a.facts.map((f) => (
              <li key={f.id}>{f.text}</li>
            ))}
          </ul>
        </details>
      )}
      {a?.trace?.fallback && <p className="muted small">{t('guide.fromFacts')}</p>}
      {!!a?.removed && <p className="muted small">{t('guide.removed', { n: a.removed })}</p>}
    </li>
  )
}

/** A cited item: inspect a chart, or go to a room or dashboard on the tour. */
function showEvidence(ref: string) {
  const v = useViewer.getState()
  if (!v.report) return
  if (v.report.visualizations.some((x) => x.id === ref)) {
    v.inspect(ref)
    unlockPointer()
    return
  }
  const index = activeStops(v.report).findIndex((s) => s.stop.ref === ref)
  if (index >= 0) {
    if (v.presenting) goTo(index)
    else startTour(index)
  }
}

function PlanTab({ report }: { report: Report }) {
  const g = useGuide()
  const editable = useViewer(canEdit)
  const busy = g.phase === 'loading' || g.phase === 'thinking'
  const plan: Plan | null = g.plan
  return (
    <div className="guide-plan">
      <div className="row">
        <button onClick={() => void loadPlan(report, g.minutes, !!plan)} disabled={busy || g.running}>
          {plan ? t('guide.regenerate') : t('guide.makePlan')}
        </button>
        {plan && editable && (
          <button onClick={() => useViewer.getState().edit((r) => void (r.tour = planTour(plan)))} title={t('guide.useAsTourTitle')}>
            {t('guide.useAsTour')}
          </button>
        )}
      </div>
      {busy && g.phase === 'loading' && !g.running && <p className="muted">{t('guide.planning')}</p>}
      {plan && (
        <>
          <p className="muted small">
            {plan.model ? t('guide.planBy', { model: plan.model, n: plan.stops.length }) : t('guide.planFromReport', { n: plan.stops.length })}
          </p>
          {plan.notes.map((n) => (
            <p key={n} className="muted small">
              {n}
            </p>
          ))}
          <ol className="guide-stops">
            {plan.stops.map((s, i) => (
              <li key={s.id}>
                <div className="panel-head">
                  <strong>
                    {i + 1}. {s.title}
                  </strong>
                  <button className="link" onClick={() => void present(report, plan.minutes, i)} disabled={busy}>
                    {t('guide.presentFrom')}
                  </button>
                </div>
                <textarea value={s.narration} rows={3} onChange={(e) => editNarration(s.id, e.target.value)} aria-label={t('guide.narrationFor', { title: s.title })} />
                {s.source === 'report' && <p className="muted small">{t('guide.fromReport')}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
