// The AI guide's server calls (local server only, opt-in: --guide).

export interface GuideStatus {
  model: { ok: boolean; detail: string; name: string }
  voice: { ok: boolean; detail: string; engine: 'kokoro' | 'browser' }
  face: { ok: boolean; detail: string; engine: 'audio2face' | 'lipsync' }
  lengths: number[]
}

export interface PlanStop {
  id: string // a tour stop id: the tour engine presents the plan as is
  ref: string
  title: string
  kind: string
  narration: string
  duration: number
  removed: number // sentences removed: the report data does not support them
  source: 'model' | 'report'
}

export interface Plan {
  revision: number
  minutes: number
  model: string // '' when the plan comes from the report's own text
  stops: PlanStop[]
  notes: string[]
}

export type Tool = 'go_to_stop' | 'inspect_chart' | 'next_stop' | 'pause_tour' | 'resume_tour'

export interface Answer {
  answer: string
  interpretation: string
  caveats: string
  evidence: { ref: string; title: string }[]
  facts: { id: string; text: string; ref: string }[] // what the answer rests on
  action: { name: Tool; ref: string } | null
  removed: number
  model: string
  source: 'model' | 'template' | 'rule' // template: the model failed, the facts answered
}

/** An earlier question and answer: what "it" and "that" refer to. */
export interface Turn {
  q: string
  a: string
  refs: string[]
}

/** Facial animation from Audio2Face-3D: ARKit blendshape weights per frame. */
export interface FaceTrack {
  fps: number
  names: string[]
  frames: number[][]
}

export interface Clip {
  audio: string // WAV, base64
  seconds: number
  face: FaceTrack | null
}

export class GuideUnavailable extends Error {}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`api/guide/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const detail = await res.json().then((b: { detail?: unknown }) => b.detail, () => '')
    const text = typeof detail === 'string' && detail ? detail : `HTTP ${res.status}`
    throw res.status === 503 ? new GuideUnavailable(text) : new Error(text)
  }
  return (await res.json()) as T
}

export async function loadStatus(): Promise<GuideStatus> {
  const res = await fetch('api/guide/status')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as GuideStatus
}

export const requestPlan = (minutes: number, lang: string, refresh = false) => post<Plan>('plan', { minutes, lang, refresh })

export const requestAnswer = (
  body: { question: string; current: string | null; inspecting: string | null; stops: string[]; lang: string; history: Turn[] },
  signal?: AbortSignal,
) =>
  post<Answer>('ask', body, signal)

export const requestSpeech = (text: string, lang: string, signal?: AbortSignal) => post<Clip>('speech', { text, lang }, signal)
