import { expect, test, vi } from 'vitest'
import { face, readingMs, sampleFace, say, sentences } from './speech'

test('narration splits into sentences, not at decimal points', () => {
  expect(sentences('The AUC is 0.61. Chance is 0.50! Why? (Synthetic data.)')).toEqual(['The AUC is 0.61.', 'Chance is 0.50!', 'Why?', '(Synthetic data.)'])
  expect(sentences('  ')).toEqual([])
  expect(readingMs('one two three four five six seven eight nine ten eleven twelve')).toBeCloseTo((12 / 2.3) * 1000)
})

test('lip sync without Audio2Face: the mouth opens at each spoken word, then closes', () => {
  face.mode = null
  expect(sampleFace(0).jawOpen).toBe(0) // silent
  face.mode = 'browser'
  face.pulse = 1000
  expect(sampleFace(1130).jawOpen).toBeCloseTo(0.6) // the middle of a syllable
  expect(sampleFace(2000).jawOpen).toBeLessThan(0.1) // between words
  expect(sampleFace(1130).eyeBlink).toBe(-1) // the avatar blinks by itself
  face.mode = null
})

test('without any voice each caption still stays for its reading time', async () => {
  vi.useFakeTimers()
  const fail = vi.fn()
  vi.stubGlobal('SpeechSynthesisUtterance', class {
    onerror: (() => void) | null = null
    constructor(public text: string) {}
  })
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [],
    cancel: () => {},
    speak: (u: { onerror: () => void }) => queueMicrotask(() => (fail(), u.onerror())), // fails at once
  })
  const captions: string[] = []
  let done = false
  const speaking = say('The first sentence has six words. Second.', { lang: 'en', signal: new AbortController().signal, onSentence: (_, t) => captions.push(t) }).then(() => (done = true))
  await vi.advanceTimersByTimeAsync(1000)
  expect(fail).toHaveBeenCalledOnce()
  expect(captions).toEqual(['The first sentence has six words.']) // still on screen after 1 s
  await vi.advanceTimersByTimeAsync(2000) // 6 words / 2.3 per second = 2.6 s
  expect(captions).toHaveLength(2)
  await vi.advanceTimersByTimeAsync(1000)
  await speaking
  expect(done).toBe(true)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
