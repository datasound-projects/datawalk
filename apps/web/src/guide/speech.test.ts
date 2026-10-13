import { expect, test } from 'vitest'
import { face, readingMs, sampleFace, sentences } from './speech'

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
