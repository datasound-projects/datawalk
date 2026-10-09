// Deterministic display placement for a rectangular room. Units: meters.
// The visitor enters through a door in the south wall and faces north (-z).
// Along-wall coordinate `a`: 0 at the wall center, positive to the right of a viewer facing the wall.
import type { Placement } from '../state/schema'

export type Wall = 'north' | 'east' | 'south' | 'west'
export type Vec3 = [number, number, number]
export type DisplayKind = 'chart' | 'dashboard' | 'kpi' | 'table' | 'text'
export type ItemKind = DisplayKind | 'exhibit'

export interface LayoutItem {
  id: string
  kind: ItemKind
  aspect: number
}

export interface PlacedDisplay {
  id: string
  kind: DisplayKind
  wall: Wall
  a: number
  y: number
  position: Vec3 // center of the display surface
  rotationY: number
  width: number
  height: number
  manual: boolean
}

export interface Door {
  a: number
  position: Vec3 // bottom center, on the inner wall face
  spawn: Vec3 // player start in front of the door
  width: number
  height: number
}

export interface FloorRect {
  x0: number
  x1: number
  z0: number
  z1: number
}

/** Theme geometry that the layout must respect, for a given room size. */
export interface RoomConstraints {
  height: number
  minWidth: number
  minDepth: number
  blocked?: (width: number, depth: number) => Record<Wall, [number, number][]> // windows, pilasters, tall furniture
  obstacles?: (width: number, depth: number) => FloorRect[] // furniture footprints
}

export interface RoomLayout {
  width: number // x extent
  depth: number // z extent
  height: number
  displays: PlacedDisplay[]
  exhibits: { id: string; position: Vec3; manual: boolean }[] // freestanding, on the floor
  doors: Door[]
  spawn: Vec3 // player capsule center
  blocked: Record<Wall, [number, number][]> // doors and theme obstacles, for arrange validation
  obstacles: FloorRect[]
  overflow: string[] // items that do not fit even in the largest room
}

export const ROOM_HEIGHT = 3.2
export const DISPLAY_CENTER_Y = 1.6
export const GAP = 0.9
export const EDGE = 0.1 // minimum distance from a manual display to a wall end
export const DOOR = { width: 1.2, height: 2.3, clearance: 0.6 }
export const EXHIBIT = { footprint: 1.2, spacing: 3.4, wallClearance: 2.2 } // 1.6 m walkway past a pedestal
const CORNER = 0.8
const MAX = { width: 24, depth: 22 }
export const DEFAULT_CONSTRAINTS: RoomConstraints = { height: ROOM_HEIGHT, minWidth: 10, minDepth: 8 }

// [max width, max height]: the readable size of each kind of display.
export const SIZE: Record<DisplayKind, [number, number]> = {
  chart: [3.0, 1.5],
  dashboard: [5.2, 2.1],
  kpi: [1.5, 0.9],
  table: [2.6, 1.5],
  text: [2.2, 1.5],
}

// rotationY such that the display faces into the room.
export const ROTATION: Record<Wall, number> = { north: 0, east: -Math.PI / 2, west: Math.PI / 2, south: Math.PI }

export const wallLength = (wall: Wall, width: number, depth: number) =>
  wall === 'north' || wall === 'south' ? width : depth

export function toWorld(wall: Wall, a: number, y: number, width: number, depth: number, inset = 0.06): Vec3 {
  switch (wall) {
    case 'north':
      return [a, y, -depth / 2 + inset]
    case 'south':
      return [-a, y, depth / 2 - inset]
    case 'east':
      return [width / 2 - inset, y, a]
    case 'west':
      return [-width / 2 + inset, y, -a]
  }
}

export function displaySize(kind: DisplayKind, aspect: number): { width: number; height: number } {
  const [maxW, maxH] = SIZE[kind]
  let height = maxH
  let width = height * aspect
  if (width > maxW) {
    width = maxW
    height = width / aspect
  }
  return { width, height }
}

/** Door positions (along the south wall) for a room with 1 or 2 doors. */
export const doorPositions = (count: number) => (count >= 2 ? [-1.8, 1.8] : [0])

/** Geometry of a manual wall placement, without validity checks. */
export function resolvePlacement(p: Placement, aspect: number, width: number, depth: number, height = ROOM_HEIGHT) {
  const wall = p.wall as Wall
  const L = wallLength(wall, width, depth)
  let w = Math.min(p.width, L - 2 * EDGE)
  let h = w / aspect
  if (h > height - 0.4) {
    h = height - 0.4
    w = h * aspect
  }
  const a = (p.u - 0.5) * L
  const y = Math.min(Math.max(p.v * height, h / 2 + 0.2), height - h / 2 - 0.1)
  return { a, y, width: w, height: h, position: toWorld(wall, a, y, width, depth), rotationY: ROTATION[wall] }
}

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1
const rectsOverlap = (a: FloorRect, b: FloorRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1

/** Subtract blocked intervals from [from, to]. */
function freeIntervals(from: number, to: number, blocked: [number, number][]): [number, number][] {
  const out: [number, number][] = []
  let start = from
  for (const [b0, b1] of [...blocked].sort((x, y) => x[0] - y[0])) {
    if (b0 > start) out.push([start, Math.min(b0, to)])
    start = Math.max(start, b1)
  }
  if (start < to) out.push([start, to])
  return out.filter(([a, b]) => b > a)
}

/** Floor area that an exhibit at (x, z) covers, with walking clearance. */
export const exhibitRect = (x: number, z: number, pad = 0.6): FloorRect => {
  const h = EXHIBIT.footprint / 2 + pad
  return { x0: x - h, x1: x + h, z0: z - h, z1: z + h }
}

/** Whether an exhibit may stand at (x, z): inside the room, clear of doors, furniture and other exhibits. */
export function exhibitFits(x: number, z: number, width: number, depth: number, doors: Door[], obstacles: FloorRect[], others: Vec3[]) {
  const c = EXHIBIT.wallClearance
  if (Math.abs(x) > width / 2 - c || Math.abs(z) > depth / 2 - c) return false
  const r = exhibitRect(x, z, 0)
  for (const d of doors) if (rectsOverlap(r, { x0: d.spawn[0] - 1.4, x1: d.spawn[0] + 1.4, z0: depth / 2 - 3, z1: depth / 2 })) return false
  if (obstacles.some((o) => rectsOverlap(exhibitRect(x, z, 0.5), o))) return false
  return others.every((p) => Math.hypot(p[0] - x, p[2] - z) >= EXHIBIT.spacing - 1e-9)
}

function pack(
  items: LayoutItem[],
  placements: Record<string, Placement>,
  doorCount: number,
  width: number,
  depth: number,
  c: RoomConstraints,
): { layout: RoomLayout; manualOk: boolean } {
  const displays: PlacedDisplay[] = []
  const themeBlocked = c.blocked?.(width, depth) ?? { north: [], east: [], south: [], west: [] }
  const obstacles = c.obstacles?.(width, depth) ?? []
  // Occupied intervals per wall, with the extra spacing that automatic displays keep.
  const taken: Record<Wall, { a0: number; a1: number; pad: number }[]> = { north: [], east: [], south: [], west: [] }
  for (const wall of Object.keys(themeBlocked) as Wall[])
    for (const [a0, a1] of themeBlocked[wall]) taken[wall].push({ a0, a1, pad: 0.1 })
  const doors = doorPositions(doorCount).map((a) => {
    taken.south.push({ a0: a - DOOR.width / 2 - DOOR.clearance, a1: a + DOOR.width / 2 + DOOR.clearance, pad: 0 })
    return {
      a,
      position: toWorld('south', a, 0, width, depth, 0),
      spawn: [-a, 0.9, depth / 2 - 1.6] as Vec3,
      width: DOOR.width,
      height: DOOR.height,
    }
  })
  const blocked: RoomLayout['blocked'] = { north: [], east: [], south: [], west: [] }
  for (const wall of Object.keys(taken) as Wall[]) blocked[wall] = taken[wall].map((t) => [t.a0, t.a1])

  let manualOk = true
  const auto: LayoutItem[] = []
  const exhibits: LayoutItem[] = []
  for (const item of items) {
    if (item.kind === 'exhibit') {
      exhibits.push(item)
      continue
    }
    const p = placements[item.id]
    if (p && p.wall !== 'floor') {
      const g = resolvePlacement(p, item.aspect, width, depth, c.height)
      const wall = p.wall as Wall
      const L = wallLength(wall, width, depth)
      const a0 = g.a - g.width / 2
      const a1 = g.a + g.width / 2
      const fits = a0 >= -L / 2 + EDGE - 1e-9 && a1 <= L / 2 - EDGE + 1e-9
      if (fits && !taken[wall].some((t) => overlaps(a0, a1, t.a0, t.a1))) {
        displays.push({ id: item.id, kind: item.kind, wall, ...g, manual: true })
        taken[wall].push({ a0, a1, pad: GAP })
        continue
      }
      manualOk = false // retry in a larger room; place automatically if it never fits
    }
    auto.push(item)
  }

  let i = 0
  for (const wall of ['north', 'east', 'west', 'south'] as Wall[]) {
    const half = wallLength(wall, width, depth) / 2
    const intervals = taken[wall].map((t): [number, number] => [t.a0 - t.pad, t.a1 + t.pad])
    for (const [from, to] of freeIntervals(-half + CORNER, half - CORNER, intervals)) {
      const row: { item: LayoutItem; width: number; height: number }[] = []
      let used = 0
      while (i < auto.length) {
        const item = auto[i] as LayoutItem & { kind: DisplayKind }
        const size = displaySize(item.kind, item.aspect)
        const next = used + (row.length ? GAP : 0) + size.width
        if (next > to - from) break
        row.push({ item, ...size })
        used = next
        i++
      }
      let a = from + (to - from - used) / 2 // center the row in the free interval
      for (const d of row) {
        const center = a + d.width / 2
        displays.push({
          id: d.item.id,
          kind: d.item.kind as DisplayKind,
          wall,
          a: center,
          y: DISPLAY_CENTER_Y,
          position: toWorld(wall, center, DISPLAY_CENTER_Y, width, depth),
          rotationY: ROTATION[wall],
          width: d.width,
          height: d.height,
          manual: false,
        })
        a += d.width + GAP
      }
    }
  }
  const overflow = auto.slice(i).map((x) => x.id)

  // Exhibits: manual floor positions first, then free slots on the center line (outward).
  const placed: RoomLayout['exhibits'] = []
  const autoExhibits: LayoutItem[] = []
  for (const item of exhibits) {
    const p = placements[item.id]
    if (p?.wall === 'floor') {
      const x = -width / 2 + p.u * width
      const z = -depth / 2 + p.v * depth
      if (exhibitFits(x, z, width, depth, doors, obstacles, placed.map((e) => e.position))) {
        placed.push({ id: item.id, position: [x, 0, z], manual: true })
        continue
      }
      manualOk = false
    }
    autoExhibits.push(item)
  }
  const slots: number[] = [0]
  for (let k = 1; k * EXHIBIT.spacing <= width / 2; k++) slots.push(-k * EXHIBIT.spacing, k * EXHIBIT.spacing)
  for (const item of autoExhibits) {
    const x = slots.find((sx) => exhibitFits(sx, 0, width, depth, doors, obstacles, placed.map((e) => e.position)))
    if (x === undefined) overflow.push(item.id)
    else placed.push({ id: item.id, position: [x, 0, 0], manual: false })
  }
  // Keep the order of the room's items, for the map and the tour.
  placed.sort((p, q) => exhibits.indexOf(exhibits.find((e) => e.id === p.id)!) - exhibits.indexOf(exhibits.find((e) => e.id === q.id)!))

  return {
    layout: {
      width,
      depth,
      height: c.height,
      displays,
      exhibits: placed,
      doors,
      spawn: [0, 0.9, depth / 2 - 1.6],
      blocked,
      obstacles,
      overflow,
    },
    manualOk,
  }
}

/** Grow the room in 2 m steps until every item fits at full readable size.
 *  Items that do not fit in the largest room are listed in `overflow`. */
export function layoutRoom(
  items: LayoutItem[],
  placements: Record<string, Placement> = {},
  doorCount = 1,
  constraints: RoomConstraints = DEFAULT_CONSTRAINTS,
): RoomLayout {
  let width = constraints.minWidth
  let depth = constraints.minDepth
  for (;;) {
    const { layout, manualOk } = pack(items, placements, doorCount, width, depth, constraints)
    const largest = width >= MAX.width && depth >= MAX.depth
    if ((layout.overflow.length === 0 && manualOk) || largest) return layout
    width = Math.min(width + 2, MAX.width)
    depth = Math.min(depth + 2, MAX.depth)
  }
}
