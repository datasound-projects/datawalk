// Moves the camera to the current tour stop like a visitor walking: a glide on a clear path,
// with ease-in-out and a capped speed; no roll, no bob. A stop in another room is reached
// through the door: the camera walks to the door, the next room fades in, and the camera walks
// in from that room's door. Reduced motion cuts directly.
import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { Euler, MathUtils, type PerspectiveCamera } from 'three'
import { EXHIBIT_CENTER_Y } from '../charts/Exhibit3D'
import { EXHIBIT_SIZE } from '../charts/exhibitData'
import type { RoomLayout } from '../layouts/wallLayout'
import { useViewer } from '../state/store'
import { findPath, isFree, nearestFree, type P2, pathLength, pointAt } from './path'
import { currentStop } from './tour'

const EYE = 1.6
const MAX_SPEED = 1.8 // m/s at the fastest point of a glide
const TURN_SPEED = 1.6 // rad/s at the fastest point
// A display fills about this much of the view: large enough to read its labels, small enough
// that the wall, the floor, and the neighbors stay in view (a room, not a page).
const FILL_HEIGHT = 0.55
const FILL_WIDTH = 0.65
const FRAME = 0.3 // m around a display that belong to it: the frame, and the plaque below
const NEAREST = 1.4 // m: closer, a small panel looks like a page held to the face
const SIDE = MathUtils.degToRad(6) // stand a little to the side, as people do in a gallery
const LOWER = 0.07 // aim below the center by this share of the view: the tour bar is at the bottom
const INTO_ROOM = 1.2 // m from the door: where the guide introduces a room
const WALK_THROUGH = 2 // rooms in between that the tour walks through; more: straight there
const euler = new Euler(0, 0, 0, 'YXZ')

export interface Pose {
  x: number
  y: number
  z: number
  yaw: number // 0 faces north (-z)
  pitch: number
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

function lookAt(from: P2, y: number, target: [number, number, number]): Pose {
  const dx = target[0] - from[0]
  const dz = target[2] - from[1]
  return { x: from[0], y, z: from[1], yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(target[1] - y, Math.hypot(dx, dz)) }
}

/** Where the camera stands for a stop. A display fills about 55 % of the height (and 65 % of
 *  the width), seen from a little to one side (`side`: -1 or 1); a room is introduced a few
 *  steps in from the door (`entry`: where the visitor came in). */
export function stopPose(layout: RoomLayout, targetId: string | null, cam: { fov: number; aspect: number }, entry: P2 = [layout.spawn[0], layout.spawn[2]], side = 1): Pose {
  const floor = { width: layout.width, depth: layout.depth, obstacles: layout.obstacles }
  const tanV = Math.tan(MathUtils.degToRad(cam.fov / 2))
  const display = layout.displays.find((d) => d.id === targetId)
  if (display) {
    const fit = Math.max((display.height + FRAME) / FILL_HEIGHT / (2 * tanV), (display.width + FRAME) / FILL_WIDTH / (2 * tanV * cam.aspect), NEAREST)
    const angle = display.rotationY + side * SIDE
    // Step back from the wall until the spot is clear (furniture); the other side, then
    // straight on, when the first side is blocked.
    const spotAt = (a: number) => {
      const n: P2 = [Math.sin(a), Math.cos(a)]
      let spot: P2 = [display.position[0] + n[0] * fit, display.position[2] + n[1] * fit]
      for (let k = 0; k < 20 && !isFree(floor, spot); k++) spot = [spot[0] + n[0] * 0.2, spot[1] + n[1] * 0.2]
      return spot
    }
    const spot = [angle, display.rotationY - side * SIDE, display.rotationY].map(spotAt).find((p) => isFree(floor, p)) ?? spotAt(display.rotationY)
    const at = nearestFree(floor, spot)
    const distance = Math.hypot(at[0] - display.position[0], at[1] - display.position[2])
    const aim: [number, number, number] = [display.position[0], display.position[1] - LOWER * 2 * distance * tanV, display.position[2]]
    return lookAt(at, display.position[1], aim)
  }
  const exhibit = layout.exhibits.find((e) => e.id === targetId)
  if (exhibit) {
    const [x, , z] = exhibit.position
    const center: [number, number, number] = [x, EXHIBIT_CENTER_Y, z]
    // The data cube's bounding sphere fills ~55 % of the height. A three-quarter view from the
    // entrance side shows the depth of the data.
    const r = (EXHIBIT_SIZE * Math.sqrt(3)) / 2
    const d = r / Math.sin(Math.atan(FILL_HEIGHT * tanV))
    const a = MathUtils.degToRad(25)
    let spot: P2 = [x + Math.sin(a) * d, z + Math.cos(a) * d]
    if (!isFree(floor, spot)) spot = [x - Math.sin(a) * d, z + Math.cos(a) * d]
    return lookAt(nearestFree(floor, spot), EXHIBIT_CENTER_Y, center)
  }
  // The room itself: a few steps in from the door, looking into the room.
  const [x, z] = nearestFree(floor, [entry[0], entry[1] - INTO_ROOM])
  return { x, y: EYE, z, yaw: 0, pitch: 0 }
}

/** The door to walk out through to reach `toRoom`: its own door, else the door on that side
 *  of the report's room order. `doorRooms[i]` is the room behind door i. */
export function exitDoor(doorRooms: (string | null)[], rooms: string[], fromRoom: string, toRoom: string): number {
  const own = doorRooms.indexOf(toRoom)
  if (own >= 0) return own
  const forward = rooms.indexOf(toRoom) > rooms.indexOf(fromRoom)
  const toward = doorRooms.indexOf(rooms[(rooms.indexOf(fromRoom) + (forward ? 1 : -1) + rooms.length) % rooms.length])
  return Math.max(0, toward)
}

/** The room that door `i` leads into on the way to `toRoom`: a visitor walks through the rooms
 *  in between (at most two, silently); a longer jump (a presenter's End key) goes straight
 *  to `toRoom` behind the door. */
export function roomBehind(doorRooms: (string | null)[], rooms: string[], fromRoom: string, toRoom: string, i: number): string {
  const via = doorRooms[i]
  const between = Math.abs(rooms.indexOf(toRoom) - rooms.indexOf(fromRoom)) - 1
  return via && between <= WALK_THROUGH ? via : toRoom
}

/** In front of door `i`, facing it (south). */
export function exitPose(layout: RoomLayout, i: number): Pose {
  const floor = { width: layout.width, depth: layout.depth, obstacles: layout.obstacles }
  const door = layout.doors[i] ?? layout.doors[0]
  const [x, z] = nearestFree(floor, [door.spawn[0], layout.depth / 2 - 0.9])
  return { x, y: EYE, z, yaw: Math.PI, pitch: 0 }
}

/** Where a visitor stands on entering: in front of the door from `fromRoom`, else the room's
 *  own start. */
export function entrySpot(layout: RoomLayout, doorRooms: (string | null)[], fromRoom: string | null): P2 {
  const door = fromRoom ? layout.doors[doorRooms.indexOf(fromRoom)] : undefined
  const s = door?.spawn ?? layout.spawn
  return [s[0], s[2]]
}

const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2 // ease-in-out; peak slope π/2

interface Glide {
  key: string
  path: P2[]
  length: number
  from: Pose
  to: Pose
  t0: number
  duration: number
  arrived: boolean
  leaving: string | null // the room that this glide walks into (through a door)
}

// The room that the tour walks into: its camera starts at the door, not where the last one was.
let entering: string | null = null

export function TourCamera({ layout, roomId, doorRooms }: { layout: RoomLayout; roomId: string; doorRooms: (string | null)[] }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const glide = useRef<Glide | null>(null)
  const walked = useRef(false) // the visitor walked here: the camera's pose belongs to this room

  useFrame(({ clock }) => {
    const s = useViewer.getState()
    const stop = s.presenting ? currentStop() : null
    if (!stop) {
      glide.current = null
      walked.current = true
      return
    }
    if (stop.roomId !== roomId && !layout.doors.length) {
      s.enterRoom(stop.roomId, roomId) // no door to walk through: straight there
      return
    }
    const now = clock.elapsedTime
    const leaving = stop.roomId !== roomId ? stop.roomId : null
    const key = leaving ? `exit:${leaving}` : `${stop.stop.id}:${s.stopIndex}:${layout.width}x${layout.depth}`
    if (glide.current?.key !== key) {
      const entry = entrySpot(layout, doorRooms, s.arrivedFrom)
      const rooms = s.report?.rooms.map((r) => r.id) ?? []
      const door = leaving ? exitDoor(doorRooms, rooms, roomId, leaving) : 0
      const to = leaving ? exitPose(layout, door) : stopPose(layout, stop.targetId, camera, entry, s.stopIndex % 2 ? -1 : 1)
      const through = leaving && roomBehind(doorRooms, rooms, roomId, leaving, door)
      let from: Pose = to // nothing to walk from: cut
      if (glide.current || walked.current) {
        euler.setFromQuaternion(camera.quaternion)
        from = { x: camera.position.x, y: camera.position.y, z: camera.position.z, yaw: euler.y, pitch: euler.x }
      } else if (entering === roomId) {
        from = { x: entry[0], y: EYE, z: entry[1], yaw: 0, pitch: 0 } // in through the door
      }
      entering = null
      walked.current = false
      const floor = { width: layout.width, depth: layout.depth, obstacles: layout.obstacles }
      const path = findPath(floor, nearestFree(floor, [from.x, from.z]), [to.x, to.z])
      const length = pathLength(path)
      const turn = Math.abs(MathUtils.euclideanModulo(to.yaw - from.yaw + Math.PI, 2 * Math.PI) - Math.PI)
      const cut = reducedMotion() || from === to
      // Capped speed: the fastest point of the ease (slope π/2) stays under the limits.
      // Screen sharing compresses video: slower moves stay readable for the audience.
      const slow = s.screenShare ? 1.8 : 1
      const duration = cut ? 0 : slow * Math.max(0.8, ((Math.PI / 2) * length) / MAX_SPEED, ((Math.PI / 2) * turn) / TURN_SPEED)
      glide.current = { key, path, length, from, to, t0: now, duration, arrived: false, leaving: through || null }
    }
    const g = glide.current
    const p = g.duration ? ease(Math.min(1, (now - g.t0) / g.duration)) : 1
    const [x, z] = pointAt(g.path, p * g.length)
    const dyaw = MathUtils.euclideanModulo(g.to.yaw - g.from.yaw + Math.PI, 2 * Math.PI) - Math.PI
    camera.position.set(x, MathUtils.lerp(g.from.y, g.to.y, p), z)
    camera.quaternion.setFromEuler(euler.set(MathUtils.lerp(g.from.pitch, g.to.pitch, p), g.from.yaw + dyaw * p, 0))
    ;(window as { datawalkTourMoving?: boolean }).datawalkTourMoving = p < 1 || !!g.leaving
    if (p >= 1 && !g.arrived) {
      g.arrived = true // once per glide
      if (g.leaving) {
        entering = g.leaving // through the door: the next room fades in, and the walk goes on there
        s.enterRoom(g.leaving, roomId)
      } else useViewer.setState({ tourArrived: stop.stop.id }) // the AI guide speaks when the camera stands still
    }
  })
  return null
}
