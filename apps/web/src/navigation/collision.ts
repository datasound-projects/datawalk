// Walking collisions on the floor plan: the visitor is a circle; the room walls, furniture
// footprints, and exhibit pedestals are rectangles. Movement slides along what it touches.
// The same rectangles drive the layout and the tour camera's paths (one source of truth).
import type { FloorRect } from '../layouts/wallLayout'

export interface World {
  width: number
  depth: number
  boxes: FloorRect[] // furniture and pedestals
}

export const RADIUS = 0.3 // visitor radius in meters
const STEP = 0.1 // longest sub-step: no tunneling through thin furniture

const inside = (b: FloorRect, x: number, z: number) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1

/** Rectangles grown by the radius, so that the visitor becomes a point. */
function grown(world: World, r: number): FloorRect[] {
  return world.boxes.map((b) => ({ x0: b.x0 - r, x1: b.x1 + r, z0: b.z0 - r, z1: b.z1 + r }))
}

/** Move from (x, z) by (dx, dz). Each axis moves on its own, so a blocked axis slides. */
export function move(world: World, x: number, z: number, dx: number, dz: number, r = RADIUS): [number, number] {
  const boxes = grown(world, r)
  const hw = world.width / 2 - r
  const hd = world.depth / 2 - r
  // A box that already contains the visitor (an exhibit moved onto them) does not block.
  const active = boxes.filter((b) => !inside(b, x, z))
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / STEP))
  for (let i = 0; i < n; i++) {
    let nx = Math.min(hw, Math.max(-hw, x + dx / n))
    for (const b of active)
      if (inside(b, nx, z)) nx = dx > 0 ? Math.min(nx, b.x0) : Math.max(nx, b.x1)
    x = nx
    let nz = Math.min(hd, Math.max(-hd, z + dz / n))
    for (const b of active)
      if (inside(b, x, nz)) nz = dz > 0 ? Math.min(nz, b.z0) : Math.max(nz, b.z1)
    z = nz
  }
  return [x, z]
}
