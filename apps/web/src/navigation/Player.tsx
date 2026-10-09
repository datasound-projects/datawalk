import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Euler, Vector3 } from 'three'
import type { Vec3 } from '../layouts/wallLayout'
import { useViewer } from '../state/store'
import { move, type World } from './collision'
import { pressed } from './input'
import { pose, takeTeleport } from './pose'

const EYE = 1.6 // eye height in meters
const RESPONSE = 10 // 1/s; how fast velocity approaches the target (acceleration feel)
const TURN_SPEED = 1.8 // rad/s for arrow-key turning
const UP = new Vector3(0, 1, 0)
const euler = new Euler(0, 0, 0, 'YXZ')
const forward = new Vector3()
const right = new Vector3()
const target = new Vector3()

export interface Portal {
  x: number
  z: number // wall surface
  width: number
  target: string
}

/** First-person walker on the floor plan (collision.ts; mouse look is in MouseLook).
 *  Walking into a portal door enters the room behind it. */
export function Player({ spawn, portals, roomId, world }: { spawn: Vec3; portals: Portal[]; roomId: string; world: World }) {
  const [start] = useState(spawn) // edits that change the layout must not teleport the player
  const body = useRef({ x: start[0], z: start[2] })
  const velocity = useRef(new Vector3())
  const leaving = useRef(false)
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    camera.quaternion.identity() // face north on every room entry
  }, [camera])

  useFrame((_, dt) => {
    const b = body.current
    dt = Math.min(dt, 0.1)
    const t = takeTeleport()
    if (t) {
      ;[b.x, b.z] = [t.x, t.z]
      velocity.current.set(0, 0, 0)
      camera.quaternion.setFromEuler(euler.set(0, t.yaw, 0))
    }
    const { overlay, speed, presenting } = useViewer.getState()
    if (presenting) {
      // The tour camera moves; the walker follows, so walking resumes where the tour ends.
      ;[b.x, b.z] = [camera.position.x, camera.position.z]
      velocity.current.set(0, 0, 0)
      pose.x = camera.position.x
      pose.z = camera.position.z
      pose.yaw = euler.setFromQuaternion(camera.quaternion).y
      return
    }
    target.set(0, 0, 0)
    // Alt+arrows move displays in arrange mode; they must not also walk or turn.
    const alt = pressed.has('AltLeft') || pressed.has('AltRight')
    if (overlay === null && !alt) {
      // Arrow keys turn and walk too: keyboard-only use, and browsers without Pointer Lock.
      const turn = Number(pressed.has('ArrowLeft')) - Number(pressed.has('ArrowRight'))
      if (turn) {
        euler.setFromQuaternion(camera.quaternion)
        euler.y += turn * TURN_SPEED * dt
        camera.quaternion.setFromEuler(euler)
      }
      const f =
        Number(pressed.has('KeyW') || pressed.has('ArrowUp')) - Number(pressed.has('KeyS') || pressed.has('ArrowDown'))
      const r = Number(pressed.has('KeyD')) - Number(pressed.has('KeyA'))
      camera.getWorldDirection(forward).setY(0).normalize()
      right.crossVectors(forward, UP)
      target.addScaledVector(forward, f).addScaledVector(right, r)
      const run = pressed.has('ShiftLeft') || pressed.has('ShiftRight') ? 2 : 1
      if (target.lengthSq() > 0) target.normalize().multiplyScalar(speed * run)
    }
    // Exponential smoothing is frame-rate independent.
    velocity.current.lerp(target, 1 - Math.exp(-RESPONSE * dt))
    const v = velocity.current
    ;[b.x, b.z] = move(world, b.x, b.z, v.x * dt, v.z * dt)
    camera.position.set(b.x, EYE, b.z)
    pose.x = b.x
    pose.z = b.z
    pose.yaw = euler.setFromQuaternion(camera.quaternion).y

    const portal = portals.find((d) => b.z > d.z - 0.5 && Math.abs(b.x - d.x) < d.width / 2)
    if (portal && !leaving.current && overlay === null) {
      leaving.current = true
      useViewer.getState().enterRoom(portal.target, roomId)
    }
  })

  return null
}
