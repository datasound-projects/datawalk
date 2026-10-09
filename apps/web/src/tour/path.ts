// Camera paths for the guided tour: inside the walkable area, around furniture and exhibits.
// Grid A* (8-connected) followed by line-of-sight smoothing. Rooms are at most 24 x 22 m,
// so a 0.25 m grid has under 10 000 cells.
import type { FloorRect } from '../layouts/wallLayout'

export type P2 = [number, number] // x, z

const CELL = 0.25
export const CLEARANCE = 0.45 // camera distance from walls and furniture

export interface Floor {
  width: number
  depth: number
  obstacles: FloorRect[]
}

function blockedAt(f: Floor, x: number, z: number) {
  const hw = f.width / 2 - CLEARANCE
  const hd = f.depth / 2 - CLEARANCE
  if (x < -hw || x > hw || z < -hd || z > hd) return true
  return f.obstacles.some((o) => x > o.x0 - CLEARANCE && x < o.x1 + CLEARANCE && z > o.z0 - CLEARANCE && z < o.z1 + CLEARANCE)
}

export const isFree = (f: Floor, p: P2) => !blockedAt(f, p[0], p[1])

/** Straight segment that stays clear (sampled every 5 cm). */
export function lineOfSight(f: Floor, a: P2, b: P2) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    if (blockedAt(f, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false
  }
  return true
}

/** The free point nearest to p (spiral search on the grid); p itself when free. */
export function nearestFree(f: Floor, p: P2): P2 {
  if (isFree(f, p)) return p
  for (let r = 1; r < 200; r++)
    for (let k = 0; k < 8 * r; k++) {
      const a = (k / (8 * r)) * 2 * Math.PI
      const q: P2 = [p[0] + Math.cos(a) * r * CELL * 0.5, p[1] + Math.sin(a) * r * CELL * 0.5]
      if (isFree(f, q)) return q
    }
  return [0, 0]
}

/** Shortest clear path from a to b, smoothed; [a, b] when the straight line is clear. */
export function findPath(f: Floor, a: P2, b: P2): P2[] {
  if (lineOfSight(f, a, b)) return [a, b]
  const nx = Math.ceil(f.width / CELL)
  const nz = Math.ceil(f.depth / CELL)
  const toCell = (p: P2): [number, number] => [
    Math.min(nx - 1, Math.max(0, Math.floor((p[0] + f.width / 2) / CELL))),
    Math.min(nz - 1, Math.max(0, Math.floor((p[1] + f.depth / 2) / CELL))),
  ]
  const center = (i: number, j: number): P2 => [(i + 0.5) * CELL - f.width / 2, (j + 0.5) * CELL - f.depth / 2]
  const free = new Uint8Array(nx * nz)
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) free[i * nz + j] = isFree(f, center(i, j)) ? 1 : 0
  const [si, sj] = toCell(a)
  const [gi, gj] = toCell(b)
  const start = si * nz + sj
  const goal = gi * nz + gj
  free[start] = free[goal] = 1 // the end points are checked by the caller
  const g = new Float64Array(nx * nz).fill(Infinity)
  const from = new Int32Array(nx * nz).fill(-1)
  const h = (c: number) => Math.hypot(Math.floor(c / nz) - gi, (c % nz) - gj)
  const open = new Map<number, number>([[start, h(start)]]) // cell -> f score
  g[start] = 0
  while (open.size) {
    let cur = -1
    let best = Infinity
    for (const [c, s] of open) if (s < best) [cur, best] = [c, s] // ponytail: linear scan; a heap if rooms grow
    open.delete(cur)
    if (cur === goal) break
    const ci = Math.floor(cur / nz)
    const cj = cur % nz
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const i = ci + di
        const j = cj + dj
        if ((!di && !dj) || i < 0 || j < 0 || i >= nx || j >= nz) continue
        const n = i * nz + j
        // Diagonal steps may not cut a blocked corner.
        if (!free[n] || (di && dj && (!free[ci * nz + j] || !free[i * nz + cj]))) continue
        const cost = g[cur] + (di && dj ? Math.SQRT2 : 1)
        if (cost < g[n]) {
          g[n] = cost
          from[n] = cur
          open.set(n, cost + h(n))
        }
      }
  }
  if (from[goal] === -1) return [a, b] // unreachable: the caller cuts instead of gliding
  const cells: P2[] = []
  for (let c = goal; c !== start; c = from[c]) cells.push(center(Math.floor(c / nz), c % nz))
  const raw: P2[] = [a, ...cells.reverse().slice(0, -1), b]
  // Smooth: from each point, jump to the farthest point in sight.
  const out: P2[] = [a]
  let i = 0
  while (i < raw.length - 1) {
    let j = raw.length - 1
    while (j > i + 1 && !lineOfSight(f, raw[i], raw[j])) j--
    out.push(raw[j])
    i = j
  }
  return out
}

export function pathLength(path: P2[]) {
  let l = 0
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1])
  return l
}

/** Point at distance s along the path. */
export function pointAt(path: P2[], s: number): P2 {
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1]
    const [x1, z1] = path[i]
    const l = Math.hypot(x1 - x0, z1 - z0)
    if (s <= l || i === path.length - 1) {
      const t = l ? Math.min(1, s / l) : 1
      return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]
    }
    s -= l
  }
  return path[path.length - 1]
}
