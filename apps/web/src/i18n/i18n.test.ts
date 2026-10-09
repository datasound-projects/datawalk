import { afterEach, expect, test } from 'vitest'
import { de } from './de'
import { en } from './en'
import { locale, plural, setLocale, t } from './index'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

afterEach(() => setLocale('en'))

test('German translates every English key, and only those', () => {
  expect(Object.keys(de).filter((k) => !(k in en))).toEqual([])
  expect(Object.keys(en).filter((k) => !(k in de))).toEqual([])
})

test('German messages keep the placeholders of the English ones', () => {
  const differ = Object.entries(de).filter(([k, v]) => placeholders(v!).join() !== placeholders(en[k as keyof typeof en]).join())
  expect(differ).toEqual([])
})

test('node has no browser language: English', () => {
  expect(locale()).toBe('en')
})

test('t fills placeholders and falls back to English', () => {
  expect(t('lobby.enter')).toBe('Enter room')
  expect(t('hub.live', { following: 1, total: 2 })).toBe('Live · 1 of 2 follow')
  expect(t('hub.follow', {})).toBe('Follow {name}') // a missing param stays visible
  setLocale('de')
  expect(t('hub.follow', { name: 'Ana' })).toBe('Ana folgen')
  delete de['lobby.enter']
  try {
    expect(t('lobby.enter')).toBe('Enter room')
  } finally {
    de['lobby.enter'] = 'Raum betreten'
  }
  setLocale('xx') // no catalog
  expect(locale()).toBe('en')
})

test('plural picks the form for n', () => {
  expect(plural('lobby.rooms', 1)).toBe('1 room')
  expect(plural('lobby.rooms', 3)).toBe('3 rooms')
  expect(plural('lobby.rooms', 1200, { n: (1200).toLocaleString('en') })).toBe('1,200 rooms')
  setLocale('de')
  expect(plural('lobby.rooms', 0)).toBe('0 Räume')
})
