import { describe, expect, it } from 'vitest'
import { contrast, readableAccent } from './contrast'

describe('brand accent', () => {
  it('keeps a light brand color, lightens a dark one to 4.5:1', () => {
    expect(readableAccent('#d9a441')).toBe('#d9a441')
    for (const dark of ['#1f4e79', '#003366', '#000000', '#7a0019']) {
      const accent = readableAccent(dark)
      expect(contrast(accent, '#0f1012')).toBeGreaterThanOrEqual(4.5) // links and focus on the background
      expect(contrast(accent, '#1a1407')).toBeGreaterThanOrEqual(4.5) // button text on the accent
    }
  })
})
