import { describe, expect, test } from 'vitest'
import { DOOR, doorPositions, exhibitFits, type LayoutItem, layoutRoom } from '../layouts/wallLayout'
import { THEMES } from '../state/schema'
import { overlapsRect, roomGeometry } from './geometry'
import { constraintsFor } from './load'
import { LibrarySchema, RoomSchema, ThemeSchema } from './schema'
import { THEME_INFO } from './themes'

const themeFiles = import.meta.glob('../../../../assets/themes/*/theme.json', { eager: true, import: 'default' })
const roomFiles = import.meta.glob('../../../../assets/themes/*/room.json', { eager: true, import: 'default' })
const library = LibrarySchema.parse(
  Object.values(import.meta.glob('../../../../assets/library/index.json', { eager: true, import: 'default' }))[0],
)
const file = (files: Record<string, unknown>, id: string, name: string) => files[`../../../../assets/themes/${id}/${name}`]

const charts = (n: number): LayoutItem[] => Array.from({ length: n }, (_, i) => ({ id: String(i), kind: 'chart', aspect: 1.5 }))

describe.each(THEMES)('theme %s', (id) => {
  const theme = ThemeSchema.parse(file(themeFiles, id, 'theme.json'))
  const room = RoomSchema.parse(file(roomFiles, id, 'room.json'))
  const bundle = { theme, room, library }

  test('identity and assets', () => {
    expect(theme.id).toBe(id)
    expect(theme.name).toBe(THEME_INFO[id].name)
    expect(library.hdris).toContain(theme.lighting.environment)
    if (theme.lighting.view) expect(library.views).toContain(theme.lighting.view)
    const surfaces = Object.values(theme.surfaces).filter((s) => s && typeof s === 'object') as { material: string | null }[]
    for (const s of surfaces) if (s.material) expect(library.materials).toContain(s.material)
    for (const f of room.furniture) expect(library.models).toHaveProperty(f.model)
    if (room.pendants) expect(library.models).toHaveProperty(room.pendants.model)
    // Windows and skylights show a view; without one the opening would show black.
    if (room.windows.length || room.skylight) expect(theme.lighting.view).not.toBeNull()
  })

  test.each([1, 2])('furniture stays clear of walls, doors and exhibits (%i doors)', (doors) => {
    for (const grow of [0, 2, 6]) {
      const [W, D] = [room.minSize[0] + grow, room.minSize[1] + grow]
      const g = roomGeometry(room, library, W, D, doors)
      for (const f of g.furniture) {
        const r = f.footprint
        expect(r.x0, f.spec.model).toBeGreaterThanOrEqual(-W / 2 - 1e-6)
        expect(r.x1, f.spec.model).toBeLessThanOrEqual(W / 2 + 1e-6)
        expect(r.z0, f.spec.model).toBeGreaterThanOrEqual(-D / 2 - 1e-6)
        expect(r.z1, f.spec.model).toBeLessThanOrEqual(D / 2 + 1e-6)
        expect(f.top, f.spec.model).toBeLessThan(room.height)
      }
      for (const a of doorPositions(doors)) {
        const entrance = { x0: -a - DOOR.width / 2 - 0.6, x1: -a + DOOR.width / 2 + 0.6, z0: D / 2 - 2.4, z1: D / 2 }
        for (const o of g.obstacles) expect(overlapsRect(o, entrance)).toBe(false)
      }
      const solid = g.furniture.filter((f) => f.spec.collide)
      for (const p of solid)
        for (const q of solid) if (p !== q) expect(overlapsRect(p.footprint, q.footprint), `${p.spec.model} / ${q.spec.model}`).toBe(false)
      const layout = layoutRoom([], {}, doors, constraintsFor(bundle, doors))
      expect(exhibitFits(0, 0, W, D, layout.doors, g.obstacles, [])).toBe(true)
    }
  })

  test('twelve charts fit without overflow, at readable size', () => {
    const layout = layoutRoom(charts(12), {}, 2, constraintsFor(bundle, 2))
    expect(layout.overflow).toEqual([])
    expect(layout.height).toBe(room.height)
    for (const d of layout.displays) expect(d.y + d.height / 2).toBeLessThan(room.height)
  })
})
