// The guide's voice. Kokoro clips play through WebAudio: the end of a clip is an exact event,
// and the mouth follows the real audio. Without Kokoro the browser's own voice speaks (word
// events move the mouth); without any voice the captions show for their reading time.
import { type Clip, type FaceTrack, GuideUnavailable, requestSpeech } from './api'

export const WORDS_PER_SECOND = 2.3

/** Narration in speakable pieces: one caption and one clip each (the same rule as Python). */
export function sentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=["'([]?[A-ZÄÖÜ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export const readingMs = (text: string) => (1000 * text.split(/\s+/).filter(Boolean).length) / WORDS_PER_SECOND

/** What the avatar's face does now. The avatar reads it every frame (no React state). */
export const face = {
  track: null as FaceTrack | null, // Audio2Face-3D frames of the playing clip
  trackStart: 0, // audio clock when that clip started
  mode: null as 'audio' | 'browser' | 'captions' | null, // what speaks now
  pulse: 0, // performance.now() of the last word (browser voice)
}

let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let gain: GainNode | null = null
let muted = false
let kokoro = false // the server has a Kokoro voice (status)
const noKokoro = new Set<string>() // languages that Kokoro cannot speak (the server said so)
const level = new Float32Array(512)

/** Call from a click: browsers start audio only after a gesture of the visitor. */
export function unlockAudio() {
  try {
    if (!ctx) {
      ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      gain = ctx.createGain()
      analyser.connect(gain).connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
    gain!.gain.value = muted ? 0 : 1
  } catch {
    ctx = null // no WebAudio: the browser voice speaks
  }
}

/** Muted speech still plays (silently): captions, lips, and the tour keep their timing. */
export function setMuted(on: boolean) {
  muted = on
  if (gain) gain.gain.value = on ? 0 : 1
}

export function setKokoro(on: boolean) {
  kokoro = on
}

export const abortError = () => new DOMException('The guide stopped speaking.', 'AbortError')
export const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

export interface SayOptions {
  lang: string
  signal: AbortSignal
  from?: number // first sentence (resume after an interruption)
  onSentence?: (index: number, text: string) => void
}

/** Speak text sentence by sentence; resolves when the last sentence ends. An abort stops the
 *  audio at once and rejects with an AbortError. The next clip loads while one plays. */
export async function say(text: string, o: SayOptions): Promise<void> {
  const parts = sentences(text)
  const clipsOn = () => kokoro && !noKokoro.has(o.lang) && ctx?.state === 'running'
  const load = (i: number): Promise<Clip | null> =>
    i < parts.length && clipsOn()
      ? requestSpeech(parts[i], o.lang, o.signal).catch((e) => {
          if (e instanceof GuideUnavailable) noKokoro.add(o.lang) // no voice for this language
          return null // this sentence: the browser voice
        })
      : Promise.resolve(null)
  let next = load(o.from ?? 0)
  for (let i = o.from ?? 0; i < parts.length; i++) {
    if (o.signal.aborted) throw abortError()
    const clip = await next
    if (o.signal.aborted) throw abortError()
    next = load(i + 1)
    o.onSentence?.(i, parts[i])
    try {
      if (clip) await playClip(clip, o.signal)
      else await speakBrowser(parts[i], o)
    } catch (e) {
      if (isAbort(e)) throw e
      await speakBrowser(parts[i], o) // a clip that cannot play (bad audio): this sentence in the browser voice
    }
  }
}

async function playClip(clip: Clip, signal: AbortSignal): Promise<void> {
  const bytes = Uint8Array.from(atob(clip.audio), (c) => c.charCodeAt(0))
  const buffer = await ctx!.decodeAudioData(bytes.buffer)
  if (signal.aborted) throw abortError()
  const source = ctx!.createBufferSource()
  source.buffer = buffer
  source.connect(analyser!)
  return new Promise((resolve, reject) => {
    let safety = 0
    const finish = (ok: boolean) => {
      clearTimeout(safety)
      signal.removeEventListener('abort', abort)
      source.onended = null
      face.mode = null
      face.track = null
      if (ok) resolve()
      else reject(abortError())
    }
    const abort = () => {
      try {
        source.stop()
      } catch {
        /* not started */
      }
      finish(false)
    }
    source.onended = () => finish(true)
    signal.addEventListener('abort', abort, { once: true })
    // A suspended audio device would never end the clip.
    safety = setTimeout(() => finish(true), (clip.seconds + 5) * 1000)
    face.track = clip.face
    face.trackStart = ctx!.currentTime
    face.mode = 'audio'
    source.start()
  })
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang))
  return voices.find((v) => v.localService) ?? voices[0] // local voices first: nothing leaves the computer
}

function speakBrowser(text: string, o: SayOptions): Promise<void> {
  const ms = readingMs(text)
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return captions(ms, o.signal)
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = o.lang === 'de' ? 'de-DE' : 'en-US'
    const voice = pickVoice(o.lang)
    if (voice) u.voice = voice
    u.volume = muted ? 0 : 1
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(safety)
      o.signal.removeEventListener('abort', abort)
      face.mode = null
      if (ok) resolve()
      else reject(abortError())
    }
    const abort = () => {
      speechSynthesis.cancel()
      finish(false)
    }
    u.onstart = () => {
      face.mode = 'browser'
      face.pulse = performance.now()
    }
    u.onboundary = () => void (face.pulse = performance.now())
    u.onend = () => finish(true)
    u.onerror = () => finish(true) // no voice on this system: go on with the captions' timing
    // Some systems have no voice and never end an utterance: the reading time ends it.
    const safety = setTimeout(() => finish(true), ms * 1.5 + 3000)
    o.signal.addEventListener('abort', abort, { once: true })
    speechSynthesis.speak(u)
  })
}

function captions(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    face.mode = 'captions'
    const done = setTimeout(() => {
      face.mode = null
      resolve()
    }, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(done)
        face.mode = null
        reject(abortError())
      },
      { once: true },
    )
  })
}

/** Stop any speech now (Stop, Esc, a new question). */
export function silence() {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

export interface Weights {
  jawOpen: number
  mouthFunnel: number
  mouthSmile: number
  browInnerUp: number
  eyeBlink: number // -1: the avatar blinks by itself
}

/** The face at this moment: Audio2Face-3D frames when the clip has them, else the loudness of
 *  the audio that plays, else a short opening at each spoken word. */
export function sampleFace(now: number): Weights {
  const w: Weights = { jawOpen: 0, mouthFunnel: 0, mouthSmile: 0, browInnerUp: 0, eyeBlink: -1 }
  if (face.mode === 'audio' && face.track && ctx) {
    const { fps, names, frames } = face.track
    const row = frames[Math.min(frames.length - 1, Math.max(0, Math.floor((ctx.currentTime - face.trackStart) * fps)))]
    const get = (n: string) => {
      const i = names.indexOf(n)
      return row && i >= 0 ? row[i] : 0
    }
    w.jawOpen = get('jawOpen')
    w.mouthFunnel = get('mouthFunnel')
    w.mouthSmile = (get('mouthSmileLeft') + get('mouthSmileRight')) / 2
    w.browInnerUp = get('browInnerUp')
    if (names.includes('eyeBlinkLeft')) w.eyeBlink = (get('eyeBlinkLeft') + get('eyeBlinkRight')) / 2
  } else if (face.mode === 'audio' && analyser) {
    analyser.getFloatTimeDomainData(level)
    let sum = 0
    for (const x of level) sum += x * x
    const rms = Math.sqrt(sum / level.length)
    w.jawOpen = Math.min(1, rms * 5)
    w.mouthFunnel = Math.min(0.4, rms * 1.5)
  } else if (face.mode === 'browser') {
    const t = now - face.pulse
    w.jawOpen = t < 260 ? 0.6 * Math.sin((Math.PI * t) / 260) : 0.06
  }
  return w
}
