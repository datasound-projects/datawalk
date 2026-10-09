import { describe, expect, test } from 'vitest'
import type { Placement } from '../state/schema'
import { DOOR, GAP, type LayoutItem, layoutRoom, type RoomLayout, SIZE } from './wallLayout'

const charts = (n: number): LayoutItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: String(i), kind: 'chart', aspect: [1.56, 2, 0.8, 1.33][i % 4] }))

const span = (d: RoomLayout['displays'][number]): [number, number] => [d.a - d.width / 2, d.a + d.width / 2]

function checkValid(room: RoomLayout) {
  for (const d of room.displays) {
    const [a, b] = span(d)
    const half = (d.wall === 'north' || d.wall === 'south' ? room.width : room.depth) / 2
    expect(a).toBeGreaterThan(-half)
    expect(b).toBeLessThan(half)
    expect(d.y - d.height / 2).toBeGreaterThan(0)
    expect(d.y + d.height / 2).toBeLessThan(room.height)
    if (d.wall === 'south')
      for (const door of room.doors) expect(b <= door.a - DOOR.width / 2 || a >= door.a + DOOR.width / 2).toBe(true)
    for (const o of room.displays) {
      if (o === d || o.wall !== d.wall) continue
      const [c, e] = span(o)
      expect(b <= c || e <= a).toBe(true)
    }
  }
}

describe('automatic layout', () => {
  test.each([1, 5, 12, 20])('%i charts: all placed, no overlap, inside walls, doors clear', (n) => {
    for (const doors of [1, 2]) {
      const room = layoutRoom(charts(n), {}, doors)
      expect(room.displays.map((d) => d.id).sort()).toEqual(charts(n).map((d) => d.id).sort())
      expect(room.overflow).toEqual([])
      for (const d of room.displays) expect(d.height).toBeLessThanOrEqual(SIZE.chart[1])
      checkValid(room)
    }
  })

  test('deterministic, and the first display faces the entrance', () => {
    expect(layoutRoom(charts(7))).toEqual(layoutRoom(charts(7)))
    expect(layoutRoom(charts(7)).displays[0].wall).toBe('north')
  })

  test('never shrinks displays: too many items overflow instead', () => {
    const room = layoutRoom(charts(200))
    expect(room.width).toBe(24)
    expect(room.overflow.length).toBeGreaterThan(0)
    expect(room.displays.length + room.overflow.length).toBe(200)
    checkValid(room)
  })
})

describe('manual placement and exhibits', () => {
  const east: Placement = { wall: 'east', u: 0.5, v: 0.5, width: 2, locked: false }

  test('a manual placement is kept and automatic displays flow around it', () => {
    const room = layoutRoom(charts(9), { '0': east })
    const manual = room.displays.find((d) => d.id === '0')!
    expect(manual).toMatchObject({ wall: 'east', a: 0, y: 1.6, width: 2, manual: true })
    for (const d of room.displays.filter((d) => d.wall === 'east' && d !== manual)) {
      const [a, b] = span(d)
      expect(b <= -1 - GAP + 1e-9 || a >= 1 + GAP - 1e-9).toBe(true)
    }
    checkValid(room)
  })

  test('overlapping manual placements grow the room, then fall back to automatic', () => {
    const wide: Placement = { wall: 'north', u: 0.5, v: 0.5, width: 3, locked: false }
    const room = layoutRoom(charts(2), { '0': wide, '1': { ...wide, u: 0.55 } })
    expect(room.displays.filter((d) => d.manual).length).toBe(1)
    checkValid(room)
  })

  test('exhibits stand on the center line, apart from each other', () => {
    const items: LayoutItem[] = [...charts(3), ...['x', 'y', 'z'].map((id) => ({ id, kind: 'exhibit' as const, aspect: 1 }))]
    const room = layoutRoom(items)
    const xs = room.exhibits.map((e) => e.position[0])
    expect(xs).toEqual([0, -3.4, 3.4]) // the center first, then outward
    expect(room.exhibits.every((e) => e.position[2] === 0)).toBe(true)
    expect(room.width / 2 - 3.4).toBeGreaterThanOrEqual(2.2)
  })
})

test('exhibits: manual floor positions, and automatic slots avoid furniture', () => {
  const items: LayoutItem[] = [{ id: 'x', kind: 'exhibit', aspect: 1 }, { id: 'y', kind: 'exhibit', aspect: 1 }]
  // Normalized coordinates: in a 10 x 8 room, u 0.3 is x = -2 m and v 0.35 is z = -1.2 m.
  const manual = layoutRoom(items.slice(0, 1), { x: { wall: 'floor', u: 0.3, v: 0.35, width: 1.2, locked: false } })
  expect(manual.exhibits[0]).toMatchObject({ id: 'x', manual: true })
  expect(manual.exhibits[0].position[0]).toBeCloseTo(-2)
  expect(manual.exhibits[0].position[2]).toBeCloseTo(-1.2)
  const blocked = layoutRoom(items, {}, 1, { height: 3.2, minWidth: 10, minDepth: 8, obstacles: () => [{ x0: -1, x1: 1, z0: -1, z1: 1 }] })
  expect(blocked.exhibits.map((e) => e.position[0])).toEqual([-3.4, 3.4])
})
