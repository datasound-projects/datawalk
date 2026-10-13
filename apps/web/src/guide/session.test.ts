// The guide's presentation sequence, with a voice that the test controls: select a stop ->
// the camera arrives -> speak -> the speech ends -> advance. Interruptions and questions too.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Report } from '../state/schema'

vi.mock('../navigation/input', () => ({ unlockPointer: () => {} }))

interface Said {
  text: string
  from: number
  signal: AbortSignal
  end: () => void
  fail: (e: unknown) => void
}
const said: Said[] = []
vi.mock('./speech', () => ({
  isAbort: (e: unknown) => e instanceof DOMException && e.name === 'AbortError',
  silence: () => {},
  unlockAudio: () => {},
  say: (text: string, o: { from?: number; signal: AbortSignal; onSentence?: (i: number, t: string) => void }) =>
    new Promise<void>((resolve, reject) => {
      o.onSentence?.(o.from ?? 0, text)
      o.signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError')))
      said.push({ text, from: o.from ?? 0, signal: o.signal, end: resolve, fail: reject })
    }),
}))

const plan = {
  revision: 1,
  minutes: 3,
  model: 'fake',
  notes: [],
  stops: [
    { id: 'p1'.padEnd(32, '0'), ref: 'r1'.padEnd(32, '0'), title: 'Summary', kind: 'room', narration: 'First stop.', duration: 3, removed: 0, source: 'model' },
    { id: 'p2'.padEnd(32, '0'), ref: 'v1'.padEnd(32, '0'), title: 'Price', kind: 'chart', narration: 'Second stop.', duration: 3, removed: 0, source: 'model' },
    { id: 'p3'.padEnd(32, '0'), ref: 'v2'.padEnd(32, '0'), title: 'Model', kind: 'chart', narration: 'Third stop.', duration: 3, removed: 0, source: 'model' },
  ],
}
const answer = vi.fn()
vi.mock('./api', () => ({
  requestPlan: async () => plan,
  requestAnswer: (...args: unknown[]) => answer(...args),
}))

const { useViewer } = await import('../state/store')
const { useGuide, present, pause, resume, stop, ask } = await import('./session')
const { goTo, stopTour } = await import('../tour/tour')

const viz = (id: string, name: string) => ({
  id,
  key: name.toLowerCase(),
  status: 'active',
  source: { library: 'plotly', chart_type: 'line', mode: 'interactive', title: null, axes: [], aspect: 1.5, default_name: name, limitations: [], has_preview: false, has_payload: true, provenance: null },
  overrides: { name: null, description: '', explanation: {}, edited: [] },
})
const report = {
  id: 'rep'.padEnd(32, '0'),
  name: 'Test',
  revision: 1,
  rooms: [{ id: 'r1'.padEnd(32, '0'), key: null, name: 'Summary', description: '', theme: null, items: ['v1'.padEnd(32, '0'), 'v2'.padEnd(32, '0')], placements: {} }],
  visualizations: [viz('v1'.padEnd(32, '0'), 'Price'), viz('v2'.padEnd(32, '0'), 'Model')],
  dashboards: [],
  tour: [],
} as unknown as Report

const tick = () => new Promise((r) => setTimeout(r, 0))
const state = () => useViewer.getState()
/** The tour camera reached the current stop (TourCamera sets this when a glide ends). */
const arrive = async () => {
  const s = state()
  useViewer.setState({ tourArrived: s.guideTour![s.stopIndex].id })
  await tick()
}

beforeEach(() => {
  said.length = 0
  answer.mockReset()
  useViewer.setState({ report, flat: false, presenting: false, stopIndex: 0, guideTour: null, tourArrived: null, overlay: 'lobby', roomLoading: false, lang: 'en' })
  useGuide.setState({ plan: null, running: false, paused: false, phase: 'idle', messages: [], error: null })
})
afterEach(() => stop())

test('each stop: the camera arrives first, the speech ends, then the next stop', async () => {
  await present(report, 3)
  await tick()
  expect(state().presenting).toBe(true)
  expect(state().guideTour?.map((s) => s.notes)).toEqual(['First stop.', 'Second stop.', 'Third stop.'])
  expect(said).toHaveLength(0) // the camera is still moving: no speech yet
  await arrive()
  expect(said.map((s) => s.text)).toEqual(['First stop.'])
  expect(useGuide.getState().caption).toBe('First stop.')
  said[0].end()
  await tick()
  expect(state().stopIndex).toBe(1)
  expect(said).toHaveLength(1) // waits for the arrival at stop 2
  await arrive()
  said[1].end()
  await tick()
  await arrive()
  said[2].end()
  await tick()
  await tick()
  expect(state().presenting).toBe(false) // the last stop ends the presentation
  expect(state().guideTour).toBeNull() // the report's own tour is back
  expect(useGuide.getState().running).toBe(false)
})

test('pause stops the speech; resume repeats the interrupted sentence', async () => {
  await present(report, 3)
  await arrive()
  pause()
  await tick()
  expect(said[0].signal.aborted).toBe(true)
  expect(useGuide.getState().phase).toBe('paused')
  resume()
  await tick()
  await tick()
  expect(said).toHaveLength(2)
  expect(said[1]).toMatchObject({ text: 'First stop.', from: 0 })
})

test('a clicker press during the speech moves on at once', async () => {
  await present(report, 3)
  await arrive()
  goTo(2) // Page Down twice, the map, or the presenter window
  await tick()
  expect(said[0].signal.aborted).toBe(true)
  await arrive()
  expect(said.at(-1)?.text).toBe('Third stop.')
})

test('a question pauses; an answer that shows a chart keeps the pause', async () => {
  answer.mockResolvedValue({ answer: 'The model is best.', interpretation: '', evidence: [], action: { name: 'inspect_chart', ref: 'v2'.padEnd(32, '0') }, removed: 0, model: 'fake' })
  await present(report, 3)
  await arrive()
  const asking = ask('Show the best model')
  await tick()
  expect(said[0].signal.aborted).toBe(true)
  expect(answer.mock.calls[0][0]).toMatchObject({ question: 'Show the best model', current: 'r1'.padEnd(32, '0'), stops: plan.stops.map((s) => s.ref) })
  await tick()
  expect(state().overlay).toBe('inspector') // DataWalk runs the action: the inspector opens
  expect(state().inspectId).toBe('v2'.padEnd(32, '0'))
  said.at(-1)!.end() // the spoken answer ends
  await asking
  expect(useGuide.getState().paused).toBe(true) // the visitor looks at the chart: Resume goes on
  expect(useGuide.getState().messages.map((m) => m.role)).toEqual(['visitor', 'guide'])
})

test('after a plain answer the presentation goes on by itself', async () => {
  answer.mockResolvedValue({ answer: 'It fell 12.9%.', interpretation: '', evidence: [], action: null, removed: 0, model: 'fake' })
  await present(report, 3)
  await arrive()
  const asking = ask('What changed?')
  await tick()
  await tick()
  said.at(-1)!.end()
  await asking
  await tick()
  expect(useGuide.getState().paused).toBe(false)
  expect(said.at(-1)?.text).toBe('First stop.') // the interrupted narration again
})

test('a question typed after the field paused still resumes; a Pause click does not', async () => {
  answer.mockResolvedValue({ answer: 'Yes.', interpretation: '', evidence: [], action: null, removed: 0, model: 'fake' })
  await present(report, 3)
  await arrive()
  pause('question') // the visitor clicks into the question field
  await tick()
  const asking = ask('Is it real?')
  await tick()
  await tick()
  said.at(-1)!.end()
  await asking
  expect(useGuide.getState().paused).toBe(false)
  pause() // the Pause button
  const again = ask('And now?')
  await tick()
  await tick()
  said.at(-1)!.end()
  await again
  expect(useGuide.getState().paused).toBe(true)
})

test('a failed clip does not stop the presentation', async () => {
  await present(report, 3)
  await arrive()
  said[0].fail(new Error('decode failed'))
  await tick()
  expect(useGuide.getState().error).toContain('decode failed')
  expect(state().stopIndex).toBe(1)
})

test('Esc ends the tour and the guide', async () => {
  await present(report, 3)
  await arrive()
  stopTour()
  await tick()
  expect(said[0].signal.aborted).toBe(true)
  expect(useGuide.getState().running).toBe(false)
  expect(state().guideTour).toBeNull()
})
