// Resolves a theme's room.json for a concrete room size: furniture positions, colliders,
// and the wall intervals that displays must avoid. Pure and deterministic.
import { DOOR, doorPositions, ROTATION, type Vec3, type Wall, wallLength } from '../layouts/wallLayout'
import type { FurnitureSpec, Library, RoomSpec } from './schema'

export interface Rect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface PlacedFurniture {
  spec: FurnitureSpec
  position: Vec3 // model origin
  rotationY: number
  footprint: Rect
  top: number // height of the item's top above the floor
}

export interface RoomGeometry {
  rug: Rect | null
  width: number
  depth: number
  height: number
  furniture: PlacedFurniture[]
  benches: Rect[]
  pilasters: { wall: Wall; a: number }[]
  windows: { wall: Wall; a0: number; a1: number; sill: number; head: number; mullions: number; frame: string; displayable: boolean }[]
  blocked: Record<Wall, [number, number][]> // along-wall intervals that displays must avoid
  obstacles: Rect[] // floor footprints with colliders
}

const BLOCK_HEIGHT = 0.8 // furniture taller than this, against a wall, blocks displays above it
const NEAR_WALL = 0.6

const rad = (deg: number) => (deg * Math.PI) / 180

/** Rotated axis-aligned footprint (width along x, depth along z) and origin offset. */
function footprintOf(spec: FurnitureSpec, lib: Library, rotationY: number) {
  const b = lib.models[spec.model]
  if (!b) throw new Error(`Unknown model "${spec.model}"`)
  const s = spec.scale
  const [w, h, d] = [0, 1, 2].map((k) => (b.max[k] - b.min[k]) * s)
  const c = Math.abs(Math.cos(rotationY))
  const sn = Math.abs(Math.sin(rotationY))
  // Offset of the bounding-box center from the origin, rotated about Y.
  const cx = ((b.min[0] + b.max[0]) / 2) * s
  const cz = ((b.min[2] + b.max[2]) / 2) * s
  const ox = cx * Math.cos(rotationY) + cz * Math.sin(rotationY)
  const oz = -cx * Math.sin(rotationY) + cz * Math.cos(rotationY)
  return { w: w * c + d * sn, d: w * sn + d * c, h, ox, oz, bottom: b.min[1] * s }
}

/** Center of a w x d footprint (x and z extents) at an anchor. */
function anchorCenter(a: FurnitureSpec['anchor'], pw: number, pd: number, W: number, D: number): [number, number] {
  let cx: number
  let cz: number
  if ('corner' in a) {
    cx = a.corner.endsWith('w') ? -W / 2 + a.inset + pw / 2 : W / 2 - a.inset - pw / 2
    cz = a.corner.startsWith('n') ? -D / 2 + a.inset + pd / 2 : D / 2 - a.inset - pd / 2
  } else if ('wall' in a) {
    const along = (a.at - 0.5) * wallLength(a.wall, W, D)
    if (a.wall === 'north') [cx, cz] = [along, -D / 2 + a.inset + pd / 2]
    else if (a.wall === 'south') [cx, cz] = [-along, D / 2 - a.inset - pd / 2]
    else if (a.wall === 'east') [cx, cz] = [W / 2 - a.inset - pw / 2, along]
    else [cx, cz] = [-W / 2 + a.inset + pw / 2, -along]
  } else {
    cx = -W / 2 + a.x * W
    cz = -D / 2 + a.z * D
  }
  return [cx, cz]
}

export function placeFurniture(spec: FurnitureSpec, lib: Library, W: number, D: number): PlacedFurniture {
  const a = spec.anchor
  const rotationY = 'wall' in a ? ROTATION[a.wall] + rad(spec.rotation) : rad(spec.rotation)
  const f = footprintOf(spec, lib, rotationY)
  const pw = spec.plinth ? Math.max(f.w, spec.plinth.size[0]) : f.w
  const pd = spec.plinth ? Math.max(f.d, spec.plinth.size[2]) : f.d
  const [cx, cz] = anchorCenter(a, pw, pd, W, D)
  const lift = spec.elevation + (spec.plinth?.size[1] ?? 0)
  return {
    spec,
    position: [cx - f.ox, lift - f.bottom, cz - f.oz],
    rotationY,
    footprint: { x0: cx - pw / 2, x1: cx + pw / 2, z0: cz - pd / 2, z1: cz + pd / 2 },
    top: lift + f.h,
  }
}

/** Along-wall interval covered by a floor rectangle that stands against `wall`. */
function wallSpan(r: Rect, wall: Wall, W: number, D: number): [number, number] | null {
  switch (wall) {
    case 'north':
      return r.z0 < -D / 2 + NEAR_WALL ? [r.x0, r.x1] : null
    case 'south':
      return r.z1 > D / 2 - NEAR_WALL ? [-r.x1, -r.x0] : null
    case 'east':
      return r.x1 > W / 2 - NEAR_WALL ? [r.z0, r.z1] : null
    case 'west':
      return r.x0 < -W / 2 + NEAR_WALL ? [-r.z1, -r.z0] : null
  }
}

export function roomGeometry(spec: RoomSpec, lib: Library, W: number, D: number, doorCount = 1): RoomGeometry {
  const walls: Wall[] = ['north', 'east', 'south', 'west']
  const blocked: RoomGeometry['blocked'] = { north: [], east: [], south: [], west: [] }
  const furniture = spec.furniture.map((f) => placeFurniture(f, lib, W, D))
  const obstacles: Rect[] = []

  for (const p of furniture) {
    if (p.spec.collide) obstacles.push(p.footprint)
    if (p.top <= BLOCK_HEIGHT) continue
    for (const wall of walls) {
      const s = wallSpan(p.footprint, wall, W, D)
      if (s) blocked[wall].push([s[0] - 0.1, s[1] + 0.1])
    }
  }

  const windows = spec.windows.map((w) => {
    const L = wallLength(w.wall, W, D)
    const a0 = (w.from - 0.5) * L
    const a1 = (w.to - 0.5) * L
    if (!w.displayable) blocked[w.wall].push([a0, a1])
    return { ...w, a0, a1 }
  })

  const pilasters: RoomGeometry['pilasters'] = []
  if (spec.pilasters) {
    const doorZones = doorPositions(doorCount).map((a) => [a - DOOR.width / 2 - 0.6, a + DOOR.width / 2 + 0.6])
    for (const wall of walls) {
      const L = wallLength(wall, W, D)
      const n = Math.max(1, Math.floor(L / spec.pilasters.spacing))
      for (let k = 1; k < n; k++) {
        const a = -L / 2 + (k * L) / n
        if (wall === 'south' && doorZones.some(([d0, d1]) => a > d0 - spec.pilasters!.width && a < d1 + spec.pilasters!.width)) continue
        pilasters.push({ wall, a })
        blocked[wall].push([a - spec.pilasters.width / 2 - 0.15, a + spec.pilasters.width / 2 + 0.15])
      }
    }
  }

  // Gallery benches: north half of the room, clear of the exhibit line and the entrance.
  const benches: Rect[] = []
  if (spec.benches) {
    const z = -D / 4
    const n = W >= 14 ? 2 : 1
    for (let k = 0; k < n; k++) {
      const x = n === 1 ? 0 : (k === 0 ? -1 : 1) * W * 0.2
      benches.push({ x0: x - 0.9, x1: x + 0.9, z0: z - 0.22, z1: z + 0.22 })
    }
    obstacles.push(...benches)
  }

  let rug: Rect | null = null
  if (spec.rug) {
    // Rug size is (along the wall, out from it); for other anchors, (x, z).
    const [s0, s1] = spec.rug.size
    const a = spec.rug.anchor
    const [w, d] = 'wall' in a && (a.wall === 'east' || a.wall === 'west') ? [s1, s0] : [s0, s1]
    const [cx, cz] = anchorCenter(a, w, d, W, D)
    rug = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 }
  }

  return { width: W, depth: D, height: spec.height, furniture, benches, pilasters, windows, blocked, obstacles, rug }
}

export const overlapsRect = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1
