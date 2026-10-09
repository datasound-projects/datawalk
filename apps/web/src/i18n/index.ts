// UI text: t('key', { name }) from the active catalog, English when a key is missing.
import { createElement, Fragment, type ReactNode } from 'react'
import { de } from './de'
import { en } from './en'

export type MessageKey = keyof typeof en
/** Base keys of plural messages ('lobby.rooms' for 'lobby.rooms.one' / 'lobby.rooms.other'). */
export type PluralKey = { [K in MessageKey]: K extends `${infer B}.other` ? B : never }[MessageKey]
type Params = Record<string, string | number>

const CATALOGS: Record<string, Partial<Record<MessageKey, string>>> = { en, de }
/** Each language in its own name, for the language selector. */
export const LANGUAGES: Record<string, string> = { en: 'English', de: 'Deutsch' }
const STORAGE_KEY = 'datawalk.lang'

/** ?lang=, else the visitor's choice, else the browser language; English without a catalog. */
function initial(): string {
  if (typeof window === 'undefined') return 'en' // tests (node)
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    /* storage unavailable */
  }
  const candidates = [new URLSearchParams(location.search).get('lang'), saved, navigator.language?.split('-')[0]]
  return candidates.find((l) => l && l in CATALOGS) ?? 'en'
}

let current = initial()
const tagDocument = () => {
  if (typeof document !== 'undefined') document.documentElement.lang = current // screen readers pick the voice
}
tagDocument()

export const locale = () => current

/** Switch the language and remember it. Components re-render through the store's `lang`. */
export function setLocale(lang: string) {
  current = lang in CATALOGS ? lang : 'en'
  tagDocument()
  try {
    localStorage.setItem(STORAGE_KEY, current)
  } catch {
    /* storage unavailable */
  }
}

export function t(key: MessageKey, params?: Params): string {
  const s = CATALOGS[current][key] ?? en[key]
  return params ? s.replace(/\{(\w+)\}/g, (m, p: string) => (p in params ? String(params[p]) : m)) : s
}

/** The plural form of `base` for n ({n} in the message); params may override n, e.g. formatted. */
export function plural(base: PluralKey, n: number, params?: Params): string {
  const key = `${base}.${new Intl.PluralRules(current).select(n)}`
  return t((key in en ? key : `${base}.other`) as MessageKey, { n, ...params })
}

/** A message with elements in it: placeholders take React nodes (<strong>, <kbd>, <code>, ...). */
export function rich(key: MessageKey, parts: Record<string, ReactNode>): ReactNode[] {
  return t(key)
    .split(/\{(\w+)\}/)
    .map((s, i) => (i % 2 ? createElement(Fragment, { key: i }, parts[s]) : s))
}
