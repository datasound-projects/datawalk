import { suspend } from 'suspend-react'
import { fetchJson } from '../app/assets'
import type { RoomConstraints } from '../layouts/wallLayout'
import type { ThemeId } from './themes'
import { roomGeometry } from './geometry'
import { type Library, LibrarySchema, type RoomSpec, RoomSchema, type Theme, ThemeSchema } from './schema'

export interface ThemeBundle {
  theme: Theme
  room: RoomSpec
  library: Library
}

const cache = new Map<string, Promise<ThemeBundle>>()
const loaded = new Map<string, ThemeBundle>()
let library: Promise<Library> | null = null

export function loadTheme(id: ThemeId): Promise<ThemeBundle> {
  let p = cache.get(id)
  if (!p) {
    library ??= fetchJson('library/index.json').then((j) => LibrarySchema.parse(j))
    p = Promise.all([
      fetchJson(`themes/${id}/theme.json`).then((j) => ThemeSchema.parse(j)),
      fetchJson(`themes/${id}/room.json`).then((j) => RoomSchema.parse(j)),
      library,
    ]).then(([theme, room, lib]) => {
      const bundle = { theme, room, library: lib }
      loaded.set(id, bundle)
      return bundle
    })
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

/** Suspends until the theme files are loaded and valid. */
export const useTheme = (id: ThemeId) => suspend(() => loadTheme(id), ['theme', id])

/** Already-loaded theme, for code that cannot suspend (the room map). */
export const loadedTheme = (id: ThemeId) => loaded.get(id)

export function constraintsFor(bundle: ThemeBundle | undefined, doorCount: number): RoomConstraints | undefined {
  if (!bundle) return undefined
  const { room, library: lib } = bundle
  const geometry = (w: number, d: number) => roomGeometry(room, lib, w, d, doorCount)
  return {
    height: room.height,
    minWidth: room.minSize[0],
    minDepth: room.minSize[1],
    blocked: (w, d) => geometry(w, d).blocked,
    obstacles: (w, d) => geometry(w, d).obstacles,
  }
}
