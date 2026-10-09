import { describe, expect, it } from 'vitest'
import { move, RADIUS } from './collision'

const world = { width: 10, depth: 8, boxes: [{ x0: 1, x1: 2, z0: -1, z1: 1 }] }

describe('walking collisions', () => {
  it('stops at the walls, one radius away', () => {
    expect(move(world, 0, 0, -20, 0)).toEqual([-5 + RADIUS, 0])
    expect(move(world, 0, 0, 0, 20)).toEqual([0, 4 - RADIUS])
  })

  it('stops at furniture and slides along it', () => {
    const [x, z] = move(world, 0, 0, 3, 0.5)
    expect(x).toBeCloseTo(1 - RADIUS)
    expect(z).toBeCloseTo(0.5) // the free axis keeps moving
  })

  it('does not tunnel through thin furniture in one large step', () => {
    const thin = { width: 10, depth: 8, boxes: [{ x0: 1, x1: 1.05, z0: -2, z1: 2 }] }
    expect(move(thin, 0, 0, 4, 0)[0]).toBeLessThan(1)
  })

  it('lets a visitor inside a box walk out', () => {
    const [x] = move(world, 1.5, 0, 2, 0)
    expect(x).toBeCloseTo(3.5)
  })
})
