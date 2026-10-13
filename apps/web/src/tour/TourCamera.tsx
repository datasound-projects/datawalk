// Moves the camera to the current tour stop: a glide on a clear path inside the room, with
// ease-in-out and a capped speed; no roll, no bob. Reduced motion cuts directly. A stop in
// another room remounts the room, so the camera cuts there behind the room fade (0.45 s).
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
const FILL = 0.7 // the target fills about 70 % of the viewport height
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

/** Where the camera stands for a stop: the target fills ~70 % of the height (and fits the width). */
export function stopPose(layout: RoomLayout, targetId: string | null, cam: { fov: number; aspect: number }): Pose {
  const floor = { width: layout.width, depth: layout.depth, obstacles: layout.obstacles }
  const tanV = Math.tan(MathUtils.degToRad(cam.fov / 2))
  const display = layout.displays.find((d) => d.id === targetId)
  if (display) {
    const fit = Math.max(display.height / FILL / (2 * tanV), display.width / 0.9 / (2 * tanV * cam.aspect), 0.8)
    const n: P2 = [Math.sin(display.rotationY), Math.cos(display.rotationY)]
    // Step back from the wall until the spot is clear (furniture), then look at the display.
    let spot: P2 = [display.position[0] + n[0] * fit, display.position[2] + n[1] * fit]
    for (let k = 0; k < 20 && !isFree(floor, spot); k++) spot = [spot[0] + n[0] * 0.2, spot[1] + n[1] * 0.2]
    return lookAt(nearestFree(floor, spot), display.position[1], display.position)
  }
  const exhibit = layout.exhibits.find((e) => e.id === targetId)
  if (exhibit) {
    const [x, , z] = exhibit.position
    const center: [number, number, number] = [x, EXHIBIT_CENTER_Y, z]
    // The data cube's bounding sphere fills ~70 % of the height. A three-quarter view from the
    // entrance side shows the depth of the data.
    const r = (EXHIBIT_SIZE * Math.sqrt(3)) / 2
    const d = r / Math.sin(Math.atan(FILL * tanV))
    const a = MathUtils.degToRad(25)
    let spot: P2 = [x + Math.sin(a) * d, z + Math.cos(a) * d]
    if (!isFree(floor, spot)) spot = [x - Math.sin(a) * d, z + Math.cos(a) * d]
    return lookAt(nearestFree(floor, spot), EXHIBIT_CENTER_Y, center)
  }
  // The room itself: from the entrance, looking at the wall that faces it.
  const [sx, , sz] = layout.spawn
  return { x: sx, y: EYE, z: sz, yaw: 0, pitch: 0 }
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
}

export function TourCamera({ layout }: { layout: RoomLayout }) {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const glide = useRef<Glide | null>(null)

  useFrame(({ clock }) => {
    const { presenting } = useViewer.getState()
    const stop = presenting ? currentStop() : null
    if (!stop) {
      glide.current = null
      return
    }
    const key = `${stop.stop.id}:${layout.width}x${layout.depth}`
    const now = clock.elapsedTime
    if (glide.current?.key !== key) {
      const to = stopPose(layout, stop.targetId, camera)
      const from: Pose = glide.current
        ? { ...glide.current.to, x: camera.position.x, z: camera.position.z }
        : { x: to.x, y: to.y, z: to.z, yaw: to.yaw, pitch: to.pitch } // first frame in this room: cut
      if (glide.current) {
        euler.setFromQuaternion(camera.quaternion)
        Object.assign(from, { y: camera.position.y, yaw: euler.y, pitch: euler.x })
      }
      const floor = { width: layout.width, depth: layout.depth, obstacles: layout.obstacles }
      const path = findPath(floor, nearestFree(floor, [from.x, from.z]), [to.x, to.z])
      const length = pathLength(path)
      const turn = Math.abs(MathUtils.euclideanModulo(to.yaw - from.yaw + Math.PI, 2 * Math.PI) - Math.PI)
      const cut = reducedMotion() || !glide.current
      // Capped speed: the fastest point of the ease (slope π/2) stays under the limits.
      // Screen sharing compresses video: slower moves stay readable for the audience.
      const slow = useViewer.getState().screenShare ? 1.8 : 1
      const duration = cut ? 0 : slow * Math.max(0.8, ((Math.PI / 2) * length) / MAX_SPEED, ((Math.PI / 2) * turn) / TURN_SPEED)
      glide.current = { key, path, length, from, to, t0: now, duration, arrived: false }
    }
    const g = glide.current
    const p = g.duration ? ease(Math.min(1, (now - g.t0) / g.duration)) : 1
    const [x, z] = pointAt(g.path, p * g.length)
    const dyaw = MathUtils.euclideanModulo(g.to.yaw - g.from.yaw + Math.PI, 2 * Math.PI) - Math.PI
    camera.position.set(x, MathUtils.lerp(g.from.y, g.to.y, p), z)
    camera.quaternion.setFromEuler(euler.set(MathUtils.lerp(g.from.pitch, g.to.pitch, p), g.from.yaw + dyaw * p, 0))
    ;(window as { datawalkTourMoving?: boolean }).datawalkTourMoving = p < 1
    if (p >= 1 && !g.arrived) {
      g.arrived = true // once per glide: the AI guide speaks when the camera stands still
      useViewer.setState({ tourArrived: stop.stop.id })
    }
  })
  return null
}
