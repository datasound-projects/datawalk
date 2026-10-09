import { expect, test } from 'vitest'
import { type LayoutItem, layoutRoom } from '../layouts/wallLayout'
import { cycle, moveBy, resizeBy, toNextWall } from './arrangeOps'

const items: LayoutItem[] = [
  { id: 'a', kind: 'chart', aspect: 1.5 },
  { id: 'b', kind: 'chart', aspect: 1.5 },
  { id: 'x', kind: 'exhibit', aspect: 1 },
]
const room = layoutRoom(items)

test('move, resize and change walls with validation', () => {
  const a = room.displays.find((d) => d.id === 'a')!
  const moved = moveBy(room, 'a', 0.5, 0.1)
  expect('placement' in moved && moved.placement.wall).toBe(a.wall)
  expect('placement' in moved && moved.placement.u).toBeCloseTo((a.a + 0.5) / room.width + 0.5)
  expect('error' in moveBy(room, 'a', 100, 0)).toBe(false) // clamped to the wall end, still valid
  const bigger = resizeBy(room, 'a', 1.2)
  expect('placement' in bigger && bigger.placement.width).toBeCloseTo(a.width * 1.2)
  const next = toNextWall(room, 'a')
  expect('placement' in next && next.placement.wall).toBe('east')
})

test('exhibits move on the floor and stay clear of walls', () => {
  const ok = moveBy(room, 'x', 1, -0.5)
  expect('placement' in ok && ok.placement.wall).toBe('floor')
  expect(moveBy(room, 'x', 0, 10)).toEqual({ error: expect.stringContaining('Too close') })
})

test('cycle walks through walls, then exhibits', () => {
  expect(cycle(room, null, 1)).toBe(room.displays[0].id)
  expect(cycle(room, room.displays.at(-1)!.id, 1)).toBe('x')
  expect(cycle(room, room.displays[0].id, -1)).toBe('x')
})
