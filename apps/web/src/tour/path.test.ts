import { describe, expect, it } from 'vitest'
import { findPath, isFree, lineOfSight, nearestFree, pathLength, pointAt } from './path'

const room = { width: 10, depth: 8, obstacles: [{ x0: -1, x1: 1, z0: -2, z1: 2 }] } // a wall of furniture in the middle

describe('tour camera path', () => {
  it('goes straight when the line is clear', () => {
    expect(findPath(room, [-3, -3.2], [3, -3.2])).toEqual([
      [-3, -3.2],
      [3, -3.2],
    ])
  })

  it('goes around furniture and never through it', () => {
    const path = findPath(room, [-3, 0], [3, 0])
    expect(path.length).toBeGreaterThan(2)
    for (let i = 1; i < path.length; i++) expect(lineOfSight(room, path[i - 1], path[i])).toBe(true)
    // Around the end of the obstacle (|z| > 2), not through it.
    expect(path.some(([, z]) => Math.abs(z) > 2)).toBe(true)
    expect(pathLength(path)).toBeLessThan(14)
  })

  it('finds a free point next to a blocked one, and interpolates', () => {
    const p = nearestFree(room, [0, 0])
    expect(isFree(room, p)).toBe(true)
    expect(Math.abs(p[0])).toBeGreaterThan(1)
    expect(pointAt([[0, 0], [2, 0], [2, 2]], 3)).toEqual([2, 1])
  })
})
