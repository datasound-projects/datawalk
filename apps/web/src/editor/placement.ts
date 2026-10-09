// Arrange-mode geometry: pointer ray -> wall position -> snapped, validated placement.
import { DISPLAY_CENTER_Y, EDGE, type PlacedDisplay, type RoomLayout, type Wall, wallLength } from '../layouts/wallLayout'
import type { Placement } from '../state/schema'
import type { DragPreview } from '../state/store'

type V = { x: number; y: number; z: number }
export interface WallHit {
  wall: Wall
  a: number // along-wall position, viewer's right positive
  y: number
}

export const SNAP = 0.06 // meters
export const MIN_WIDTH = 0.5

/** First wall that a ray from inside the room hits. */
export function hitWall(origin: V, dir: V, width: number, depth: number, height = 3.2): WallHit | null {
  const planes: [Wall, number][] = []
  if (dir.z < 0) planes.push(['north', (-depth / 2 - origin.z) / dir.z])
  if (dir.z > 0) planes.push(['south', (depth / 2 - origin.z) / dir.z])
  if (dir.x > 0) planes.push(['east', (width / 2 - origin.x) / dir.x])
  if (dir.x < 0) planes.push(['west', (-width / 2 - origin.x) / dir.x])
  let best: WallHit | null = null
  let bestT = Infinity
  for (const [wall, t] of planes) {
    if (t <= 0 || t >= bestT) continue
    const p = { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t }
    const a = wall === 'north' ? p.x : wall === 'south' ? -p.x : wall === 'east' ? p.z : -p.z
    if (p.y < 0 || p.y > height || Math.abs(a) > wallLength(wall, width, depth) / 2) continue
    best = { wall, a, y: p.y }
    bestT = t
  }
  return best
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1

/** Place a display of `width` with its center at (a, y) on `wall`: snap, clamp, validate.
 *  Doors, windows, pilasters, tall furniture and other manual displays are obstacles;
 *  automatic displays move out of the way. */
export function propose(
  layout: RoomLayout,
  id: string,
  wall: Wall,
  a: number,
  y: number,
  width: number,
  aspect: number,
  locked = false,
): DragPreview {
  const L = wallLength(wall, layout.width, layout.depth)
  const w = Math.min(Math.max(width, MIN_WIDTH), L - 2 * EDGE)
  const h = w / aspect
  const guides: DragPreview['guides'] = {}
  // Alignment: the wall center, the standard display height, other displays' centers.
  if (Math.abs(a) < SNAP) a = guides.a = 0
  const heights = [DISPLAY_CENTER_Y, ...layout.displays.filter((d) => d.id !== id).map((d) => d.y)]
  const snapY = heights.find((sy) => Math.abs(y - sy) < SNAP)
  if (snapY !== undefined) y = guides.y = snapY
  a = clamp(a, -L / 2 + EDGE + w / 2, L / 2 - EDGE - w / 2)
  const H = layout.height
  y = clamp(y, h / 2 + 0.2, H - h / 2 - 0.1)

  const [a0, a1] = [a - w / 2, a + w / 2]
  const blocked = [
    ...layout.blocked[wall],
    ...layout.displays.filter((d) => d.manual && d.id !== id && d.wall === wall).map((d) => [d.a - d.width / 2, d.a + d.width / 2]),
  ]
  const valid = h <= H - 0.3 && !blocked.some(([b0, b1]) => overlaps(a0, a1, b0, b1))
  const placement: Placement = { wall, u: a / L + 0.5, v: y / H, width: w, locked }
  return { id, placement, valid, guides }
}

/** Move: keep the offset between the grab point and the display center. */
export function proposeMove(layout: RoomLayout, d: PlacedDisplay, hit: WallHit, grab: { da: number; dy: number }, locked = false) {
  const sameWall = hit.wall === d.wall
  return propose(layout, d.id, hit.wall, hit.a + (sameWall ? grab.da : 0), hit.y + grab.dy, d.width, d.width / d.height, locked)
}

/** Resize from the corner handle: the center stays, the aspect ratio stays. */
export function proposeResize(layout: RoomLayout, d: PlacedDisplay, hit: WallHit, locked = false) {
  if (hit.wall !== d.wall) return null
  return propose(layout, d.id, d.wall, d.a, d.y, 2 * Math.abs(hit.a - d.a), d.width / d.height, locked)
}
