import { expect, test } from 'vitest'
import { layoutRoom } from '../layouts/wallLayout'
import { hitWall, propose, proposeMove } from './placement'

const room = layoutRoom([
  { id: 'a', kind: 'chart', aspect: 1.5 },
  { id: 'b', kind: 'chart', aspect: 1.5 },
])

test('pointer rays hit the nearest wall in wall-local coordinates', () => {
  const eye = { x: 1, y: 1.6, z: 0 }
  expect(hitWall(eye, { x: 0, y: 0, z: -1 }, 10, 8)).toEqual({ wall: 'north', a: 1, y: 1.6 })
  expect(hitWall(eye, { x: 1, y: 0, z: 0 }, 10, 8)).toEqual({ wall: 'east', a: 0, y: 1.6 })
  expect(hitWall(eye, { x: -1, y: 0, z: 0 }, 10, 8)).toEqual({ wall: 'west', a: -0, y: 1.6 })
  expect(hitWall(eye, { x: 0, y: 0, z: 1 }, 10, 8)).toEqual({ wall: 'south', a: -1, y: 1.6 })
  expect(hitWall(eye, { x: 0, y: 1, z: 0 }, 10, 8)).toBeNull() // ceiling
})

test('snaps to the wall center and standard height, and clamps to the wall', () => {
  const p = propose(room, 'a', 'east', 0.04, 1.63, 2, 1.5)
  expect(p.guides).toEqual({ a: 0, y: 1.6 })
  expect(p.placement).toEqual({ wall: 'east', u: 0.5, v: 0.5, width: 2, locked: false })
  const edge = propose(room, 'a', 'east', 99, 1.2, 2, 1.5)
  expect(edge.placement.u * room.depth - room.depth / 2 + 1).toBeCloseTo(room.depth / 2 - 0.1)
})

test('rejects overlap with doors and manual displays; automatic displays do not block', () => {
  expect(propose(room, 'a', 'south', 0, 1.6, 1, 1.5).valid).toBe(false) // the door
  expect(propose(room, 'a', 'north', 0, 1.6, 2, 1.5).valid).toBe(true) // over automatic "b"
  const withManual = layoutRoom(
    [
      { id: 'a', kind: 'chart', aspect: 1.5 },
      { id: 'b', kind: 'chart', aspect: 1.5 },
    ],
    { b: { wall: 'west', u: 0.5, v: 0.5, width: 2, locked: false } },
  )
  expect(propose(withManual, 'a', 'west', 0.5, 1.6, 2, 1.5).valid).toBe(false)
  const b = withManual.displays.find((d) => d.id === 'b')!
  // Moving a display keeps the grab offset on the same wall.
  const moved = proposeMove(withManual, b, { wall: 'west', a: 1, y: 1.6 }, { da: -0.5, dy: 0 })
  expect(moved.placement.u).toBeCloseTo(0.5 / withManual.depth + 0.5)
})
