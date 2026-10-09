import { useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Euler } from 'three'
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js'
import { useViewer } from '../state/store'
import { markDragged } from './input'

const DRAG_SPEED = 0.003 // rad per pixel at sensitivity 1
const DRAG_THRESHOLD = 4 // pixels before a press becomes a drag

/** Mouse look for the whole canvas. It lives outside the per-room content, so a room
 *  change (walking through a door keeps the pointer locked) never loses the lock state.
 *  Without Pointer Lock (embedded or locked-down browsers), drag with the left button. */
export function MouseLook() {
  const camera = useThree((s) => s.camera)
  const gl = useThree((s) => s.gl)
  const sensitivity = useViewer((s) => s.sensitivity)
  const controls = useRef<PointerLockControls>(null)

  useEffect(() => {
    const el = gl.domElement
    const c = new PointerLockControls(camera, el)
    c.isLocked = document.pointerLockElement === el
    c.addEventListener('lock', () => useViewer.getState().setOverlay(null))
    c.addEventListener('unlock', () => {
      const { overlay, arranging, setOverlay } = useViewer.getState()
      if (overlay === null && !arranging) setOverlay('lobby') // Esc while walking pauses
    })
    controls.current = c

    const euler = new Euler(0, 0, 0, 'YXZ')
    let drag: { x: number; y: number; moved: boolean } | null = null
    const down = (e: PointerEvent) => {
      const { overlay, arranging, presenting } = useViewer.getState()
      if (e.button !== 0 || document.pointerLockElement || overlay !== null || arranging || presenting) return
      drag = { x: e.clientX, y: e.clientY, moved: false }
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      drag.moved = true
      const k = DRAG_SPEED * c.pointerSpeed
      euler.setFromQuaternion(camera.quaternion)
      euler.y -= dx * k
      euler.x = Math.min(Math.max(euler.x - dy * k, -1.4), 1.4)
      camera.quaternion.setFromEuler(euler)
      drag.x = e.clientX
      drag.y = e.clientY
    }
    const up = () => {
      if (drag?.moved) markDragged() // a drag is not a click on a chart
      drag = null
    }
    el.addEventListener('pointerdown', down)
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    return () => {
      c.dispose()
      el.removeEventListener('pointerdown', down)
      removeEventListener('pointermove', move)
      removeEventListener('pointerup', up)
    }
  }, [camera, gl])

  useEffect(() => {
    if (controls.current) controls.current.pointerSpeed = sensitivity
  }, [sensitivity])

  return null
}
