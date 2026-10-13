// The AI guide's presentation, one stop at a time:
//   select the stop -> the tour camera moves -> it arrives -> the guide speaks -> the speech
//   ends -> the next stop.
// Every step waits for an event, not a timer. The viewer's stopIndex is the one truth: clicker
// keys, the HUD, the presenter window, and the guide's own actions all call goTo(), and the
// guide follows. A question pauses the presentation; the answer can resume it.
import { create } from 'zustand'
import { unlockPointer } from '../navigation/input'
import type { Report, TourStop } from '../state/schema'
import { useViewer } from '../state/store'
import { activeStops, currentStop, goTo, startTour, stopTour, type Stop } from '../tour/tour'
import { type Answer, type GuideStatus, type Plan, requestAnswer, requestPlan } from './api'
import { isAbort, say, silence, unlockAudio } from './speech'

export type Phase = 'idle' | 'loading' | 'thinking' | 'speaking' | 'listening' | 'paused' | 'error'

export interface Message {
  id: number
  role: 'visitor' | 'guide'
  text: string
  answer?: Answer
}

interface GuideState {
  status: GuideStatus | null
  open: boolean
  tab: 'ask' | 'plan'
  phase: Phase
  minutes: number
  plan: Plan | null
  running: boolean // the guide presents: its plan is the tour
  paused: boolean
  caption: string
  error: string | null
  muted: boolean
  messages: Message[]
  set: (s: Partial<Omit<GuideState, 'set'>>) => void
}

export const useGuide = create<GuideState>()((set) => ({
  status: null,
  open: false,
  tab: 'ask',
  phase: 'idle',
  minutes: 3,
  plan: null,
  running: false,
  paused: false,
  caption: '',
  error: null,
  muted: false,
  messages: [],
  set: (s) => set(s),
}))

const lang = () => (useViewer.getState().lang === 'de' ? 'de' : 'en')
const ARRIVAL_TIMEOUT = 20_000 // a stop the camera cannot reach must not stop the presentation

/** Resolves when the predicate holds for the store's state (now or later), when the timeout
 *  passes, or rejects when the signal aborts. */
function until<S>(store: { getState: () => S; subscribe: (f: (s: S) => void) => () => void }, ok: (s: S) => boolean, signal: AbortSignal, timeout = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('stopped', 'AbortError'))
    if (ok(store.getState())) return resolve()
    const done = (f: () => void) => {
      unsubscribe()
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      f()
    }
    const abort = () => done(() => reject(new DOMException('stopped', 'AbortError')))
    const unsubscribe = store.subscribe((s) => ok(s) && done(resolve))
    const timer = timeout ? setTimeout(() => done(resolve), timeout) : 0
    signal.addEventListener('abort', abort, { once: true })
  })
}

// -- plan ------------------------------------------------------------------------------------

/** The plan for this report revision and length: the one already loaded (with the visitor's
 *  edits), else a new one from the server (cached there per revision). */
export async function loadPlan(report: Report, minutes: number, refresh = false): Promise<Plan | null> {
  const g = useGuide.getState()
  if (!refresh && g.plan && g.plan.minutes === minutes && g.plan.revision === report.revision) return g.plan
  g.set({ phase: 'loading', error: null, minutes })
  try {
    const plan = await requestPlan(minutes, lang(), refresh)
    useGuide.getState().set({ plan, phase: 'idle' })
    return plan
  } catch (e) {
    useGuide.getState().set({ phase: 'error', error: String(e instanceof Error ? e.message : e) })
    return null
  }
}

export function editNarration(id: string, narration: string) {
  const { plan, set } = useGuide.getState()
  if (plan) set({ plan: { ...plan, stops: plan.stops.map((s) => (s.id === id ? { ...s, narration } : s)) } })
}

export const planTour = (plan: Plan): TourStop[] => plan.stops.map((s) => ({ id: s.id, ref: s.ref, notes: s.narration, duration: s.duration }))

// -- presentation ------------------------------------------------------------------------------

let session: AbortController | null = null // the running presentation
let speech: AbortController | null = null // what the guide says now
let answering: AbortController | null = null // the answer to a question
let resumeAt: { stopId: string; sentence: number } | null = null // where a pause interrupted
let pausedFor: 'visitor' | 'question' = 'visitor' // a question's pause may resume by itself
let messageId = 0

/** Present the plan from stop `index`: the guide's plan becomes the tour while it runs. */
export async function present(report: Report, minutes = useGuide.getState().minutes, index = 0) {
  unlockAudio() // this runs in the click: browsers allow audio from here on
  const plan = await loadPlan(report, minutes)
  if (!plan?.stops.length) return
  end()
  const ctl = (session = new AbortController())
  resumeAt = null
  useGuide.getState().set({ running: true, paused: false, error: null, open: false }) // the room is the stage: only the captions and the compact controls stay
  const v = useViewer.getState()
  v.set({ guideTour: planTour(plan) })
  if (v.flat) {
    v.set({ kiosk: false })
    goTo(index)
  } else startTour(index)
  // The presentation ends with the tour: Esc, the End button, or the last stop.
  const unsubscribe = useViewer.subscribe((s) => !s.presenting && session === ctl && end())
  ctl.signal.addEventListener('abort', unsubscribe, { once: true })
  void loop(ctl.signal)
}

async function loop(signal: AbortSignal) {
  try {
    while (!signal.aborted) {
      await until(useGuide, (g) => !g.paused, signal)
      const { report, presenting, stopIndex } = useViewer.getState()
      const stops = report ? activeStops(report) : []
      const stop = stops[stopIndex]
      if (!presenting || !stop) break
      await arrive(stop, stopIndex, signal)
      if (useViewer.getState().stopIndex !== stopIndex || useGuide.getState().paused) continue // moved on or paused during the glide
      if (!(await narrate(stop, stopIndex))) continue // interrupted: paused, or another stop
      if (stopIndex >= stops.length - 1) break // the last stop: the presentation ends
      goTo(stopIndex + 1)
    }
  } catch (e) {
    if (!isAbort(e)) useGuide.getState().set({ error: String(e) })
  }
  if (!signal.aborted) stop()
}

/** Wait until the camera stands at the stop and the room is drawn. The flat view scrolls. */
async function arrive(stop: Stop, index: number, signal: AbortSignal) {
  const v = useViewer.getState()
  if (v.flat) {
    const viz = v.report?.visualizations.find((x) => x.id === stop.targetId)
    const el = viz ? document.getElementById(`viz-${viz.key}`) : document.querySelector(`[data-room="${stop.roomId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  useGuide.getState().set({ phase: 'loading', caption: '' })
  await until(useViewer, (s) => (s.tourArrived === stop.stop.id && !s.roomLoading) || s.stopIndex !== index || !s.presenting, signal, ARRIVAL_TIMEOUT)
}

/** Speak the stop's narration. True when it ended normally; false when a pause or another
 *  stop interrupted it (a pause remembers the sentence). */
async function narrate(stop: Stop, index: number): Promise<boolean> {
  const g = useGuide.getState()
  const text = g.plan?.stops.find((s) => s.id === stop.stop.id)?.narration ?? stop.stop.notes
  const from = resumeAt?.stopId === stop.stop.id ? resumeAt.sentence : 0
  resumeAt = null
  const ctl = (speech = new AbortController())
  session?.signal.addEventListener('abort', () => ctl.abort(), { once: true })
  const unsubscribe = useViewer.subscribe((s) => (s.stopIndex !== index || !s.presenting) && ctl.abort())
  let sentence = from
  g.set({ phase: 'speaking' })
  try {
    await say(text, { lang: lang(), signal: ctl.signal, from, onSentence: (i, caption) => ((sentence = i), useGuide.getState().set({ caption })) })
    return true
  } catch (e) {
    if (!isAbort(e)) {
      useGuide.getState().set({ error: String(e instanceof Error ? e.message : e) }) // this stop failed: go on
      return true
    }
    if (useGuide.getState().paused) resumeAt = { stopId: stop.stop.id, sentence }
    return false
  } finally {
    unsubscribe()
    if (speech === ctl) speech = null
    // Only a speaking phase ends here: a question that interrupted ("thinking") keeps its own.
    const now = useGuide.getState()
    if (now.phase === 'speaking' || now.phase === 'paused') now.set({ caption: '', phase: now.paused ? 'paused' : 'idle' })
  }
}

/** Pause the presentation. 'question': the visitor starts a question (the field, Ask, the
 *  microphone); after a plain answer the presentation goes on. 'visitor': only Resume. */
export function pause(reason: 'visitor' | 'question' = 'visitor') {
  const g = useGuide.getState()
  if (!g.running || g.paused) return
  pausedFor = reason
  g.set({ paused: true, phase: 'paused' }) // first: the interrupted narration sees the pause
  speech?.abort()
}

export function resume() {
  const g = useGuide.getState()
  if (!g.running || !g.paused) return
  unlockAudio()
  g.set({ paused: false, phase: 'idle' })
}

/** End the presentation (and any answer that the guide speaks). */
export function stop() {
  answering?.abort()
  const wasRunning = useGuide.getState().running
  end()
  if (wasRunning && useViewer.getState().presenting) stopTour()
}

function end() {
  session?.abort()
  speech?.abort()
  session = speech = null
  silence()
  useGuide.getState().set({ running: false, paused: false, caption: '', phase: 'idle' })
}

// -- questions ---------------------------------------------------------------------------------

/** Answer a visitor's question. A running presentation pauses; after the answer it goes on,
 *  unless the answer showed something else (then Resume continues). */
export async function ask(question: string) {
  const report = useViewer.getState().report
  question = question.trim().slice(0, 500)
  if (!question || !report) return
  unlockAudio()
  const g = useGuide.getState()
  const wasPlaying = g.running && (!g.paused || pausedFor === 'question')
  pause('question')
  answering?.abort()
  const ctl = (answering = new AbortController())
  g.set({ phase: 'thinking', error: null, messages: [...g.messages, { id: ++messageId, role: 'visitor', text: question }] })
  try {
    const v = useViewer.getState()
    const answer = await requestAnswer(
      {
        question,
        current: currentStop()?.stop.ref ?? null,
        inspecting: v.overlay === 'inspector' ? v.inspectId : null,
        stops: activeStops(report).map((s) => s.stop.ref),
        lang: lang(),
      },
      ctl.signal,
    )
    const now = useGuide.getState()
    now.set({ messages: [...now.messages, { id: ++messageId, role: 'guide', text: answer.answer, answer }], phase: 'speaking' })
    const showed = show(answer.action) // the audience sees the evidence while the guide speaks
    const spoken = answer.interpretation ? `${answer.answer} ${answer.interpretation}` : answer.answer
    await say(spoken, { lang: lang(), signal: ctl.signal, onSentence: (_, caption) => useGuide.getState().set({ caption }) })
    const name = answer.action?.name
    if (name === 'next_stop') nextStop()
    else if (name === 'resume_tour' || (wasPlaying && !showed && name !== 'pause_tour')) resume()
  } catch (e) {
    if (!isAbort(e)) useGuide.getState().set({ error: String(e instanceof Error ? e.message : e) })
  } finally {
    if (answering === ctl) answering = null
    const now = useGuide.getState()
    now.set({ caption: '', phase: now.error ? 'error' : now.paused ? 'paused' : 'idle' })
  }
}

/** Run a navigation action that the model proposed and the server validated. DataWalk does
 *  the work: the tour engine moves the camera, the inspector opens the chart. */
function show(action: Answer['action']): boolean {
  const v = useViewer.getState()
  if (!action || !v.report) return false
  if (action.name === 'go_to_stop') {
    const index = activeStops(v.report).findIndex((s) => s.stop.ref === action.ref)
    if (index < 0) return false
    resumeAt = null
    if (v.presenting) goTo(index)
    else startTour(index)
    return true
  }
  if (action.name === 'inspect_chart' && v.report.visualizations.some((x) => x.id === action.ref)) {
    v.inspect(action.ref)
    unlockPointer()
    return true
  }
  if (action.name === 'pause_tour') pause()
  return false
}

function nextStop() {
  const { stopIndex, presenting } = useViewer.getState()
  if (!presenting) return
  resumeAt = null
  goTo(stopIndex + 1)
  resume()
}
