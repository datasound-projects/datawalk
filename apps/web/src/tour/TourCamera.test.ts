import { describe, expect, it, vi } from 'vitest'
import type { PlacedDisplay, RoomLayout } from '../layouts/wallLayout'
import { entrySpot, exitDoor, exitPose, roomBehind, stopPose } from './TourCamera'

vi.mock('../navigation/input', () => ({ unlockPointer: () => {} })) // keyboard listeners need a browser

const display = (id: string, width: number, height: number): PlacedDisplay => ({
  id,
  kind: 'chart' as PlacedDisplay['kind'],
  wall: 'north',
  a: 0,
  y: 1.7,
  position: [0, 1.7, -5], // on the north wall, facing south (into the room)
  rotationY: 0,
  width,
  height,
  manual: false,
})

const layout: RoomLayout = {
  width: 12,
  depth: 10,
  height: 4,
  displays: [display('chart', 1.6, 1.0), display('note', 0.8, 0.45), display('dashboard', 5, 1.6)],
  exhibits: [],
  doors: [
    { a: -1.8, position: [1.8, 0, 5], spawn: [1.8, 0.9, 3.4], width: 1, height: 2.1 },
    { a: 1.8, position: [-1.8, 0, 5], spawn: [-1.8, 0.9, 3.4], width: 1, height: 2.1 },
  ],
  spawn: [0, 0.9, 3.4],
  blocked: { north: [], east: [], south: [], west: [] },
  obstacles: [],
  overflow: [],
}
const cam = { fov: 70, aspect: 16 / 10 }
const tan = Math.tan((35 * Math.PI) / 180)
const distance = (id: string, side = 1) => {
  const p = stopPose(layout, id, cam, undefined, side)
  return Math.hypot(p.x - 0, p.z - -5)
}
/** The share of the view's height that a display (with its frame) fills from where the camera stands. */
const fills = (id: string) => (layout.displays.find((d) => d.id === id)!.height + 0.3) / (2 * distance(id) * tan)

describe('tour camera: where it stands', () => {
  it('frames a chart to be read, with the room still around it', () => {
    expect(fills('chart')).toBeGreaterThan(0.4)
    expect(fills('chart')).toBeLessThanOrEqual(0.56)
  })

  it('keeps its distance from a small panel, so that it does not look like a page', () => {
    expect(distance('note')).toBeGreaterThan(1.4 - 1e-9)
    expect(fills('note')).toBeLessThan(0.55)
  })

  it('fits a wide dashboard in about two thirds of the width', () => {
    const width = 2 * distance('dashboard') * tan * cam.aspect
    expect((5 + 0.3) / width).toBeLessThanOrEqual(0.66)
  })

  it('stands a little to the side, one side and then the other, facing the display', () => {
    const left = stopPose(layout, 'chart', cam, undefined, -1)
    const right = stopPose(layout, 'chart', cam, undefined, 1)
    expect(Math.sign(left.x)).toBe(-Math.sign(right.x))
    expect(Math.abs(right.x)).toBeGreaterThan(0.1)
    expect(Math.abs(right.yaw)).toBeLessThan(0.2) // still almost straight on: readable
    expect(right.pitch).toBeLessThan(0) // aims a little low: the display sits above the tour bar
  })

  it('introduces a room a few steps in from the door the visitor came through', () => {
    const entry = entrySpot(layout, ['prev', 'next'], 'next')
    expect(entry).toEqual([-1.8, 3.4])
    const pose = stopPose(layout, null, cam, entry)
    expect([pose.x, pose.z, pose.yaw]).toEqual([-1.8, 3.4 - 1.2, 0])
    expect(entrySpot(layout, ['prev', 'next'], null)).toEqual([0, 3.4]) // the tour began here
  })
})

describe('tour camera: from room to room', () => {
  const rooms = ['a', 'b', 'c', 'd', 'e', 'f']

  it('walks out through the door that leads toward the next stop', () => {
    expect(exitDoor(['a', 'c'], rooms, 'b', 'c')).toBe(1)
    expect(exitDoor(['a', 'c'], rooms, 'b', 'a')).toBe(0)
    expect(exitDoor(['a', 'c'], rooms, 'b', 'e')).toBe(1) // further on: the door on that side
    expect(exitDoor(['f', 'b'], rooms, 'a', 'f')).toBe(0) // the rooms form a ring
    const pose = exitPose(layout, 1)
    expect([pose.x, pose.yaw]).toEqual([-1.8, Math.PI]) // in front of that door, facing it
  })

  it('walks through up to two rooms in between, and goes straight past more', () => {
    expect(roomBehind(['a', 'c'], rooms, 'b', 'c', 1)).toBe('c')
    expect(roomBehind(['a', 'c'], rooms, 'b', 'd', 1)).toBe('c') // through c
    expect(roomBehind(['a', 'c'], rooms, 'b', 'e', 1)).toBe('c') // through c and d
    expect(roomBehind(['a', 'c'], rooms, 'b', 'f', 1)).toBe('f') // three between: straight there
  })
})
