// Arrange mode inside the 3D room: drag displays along the walls, resize them from the corner
// handle, see alignment guides. The pointer is not locked; right-drag or arrow keys look around.
import { type ThreeEvent, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { Euler } from 'three'
import { exhibitFits, type PlacedDisplay, ROTATION, type RoomLayout, toWorld, type Vec3, type Wall, wallLength } from '../layouts/wallLayout'
import { floorPlacement } from './arrangeOps'
import { type DragPreview, useViewer } from '../state/store'
import { hitWall, proposeMove, proposeResize } from './placement'

type Handlers = {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
  onPointerMove?: (e: ThreeEvent<PointerEvent>) => void
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void
}

const capture = (e: ThreeEvent<PointerEvent>, on: boolean) => {
  const t = e.target as unknown as Element
  if (on) t.setPointerCapture(e.pointerId)
  else t.releasePointerCapture(e.pointerId)
}

const roomState = () => {
  const s = useViewer.getState()
  return s.report?.rooms.find((r) => r.id === s.roomId)
}

function commit() {
  const { drag, roomId, edit, set } = useViewer.getState()
  set({ drag: null })
  if (drag?.valid)
    edit((r) => {
      r.rooms.find((x) => x.id === roomId)!.placements[drag.id] = drag.placement
    })
}

/** Pointer handlers for a display group, or none outside arrange mode. */
export function useArrangeHandlers(layout: RoomLayout): (d: PlacedDisplay) => Handlers {
  const arranging = useViewer((s) => s.arranging)
  const grab = useRef<{ da: number; dy: number } | null>(null)
  if (!arranging) return () => ({})
  return (d) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      useViewer.getState().set({ selectedId: d.id })
      const hit = hitWall(e.ray.origin, e.ray.direction, layout.width, layout.depth, layout.height)
      if (!hit || roomState()?.placements[d.id]?.locked) return
      grab.current = { da: d.a - hit.a, dy: d.y - hit.y }
      capture(e, true)
    },
    onPointerMove: (e) => {
      if (!grab.current) return
      const hit = hitWall(e.ray.origin, e.ray.direction, layout.width, layout.depth, layout.height)
      if (hit) useViewer.getState().set({ drag: proposeMove(layout, d, hit, grab.current) })
    },
    onPointerUp: (e) => {
      if (!grab.current) return
      grab.current = null
      capture(e, false)
      commit()
    },
  })
}

/** Pointer handlers for a freestanding exhibit: drag it across the floor. */
export function useExhibitHandlers(layout: RoomLayout): (id: string, position: Vec3) => Handlers {
  const arranging = useViewer((s) => s.arranging)
  const grab = useRef<{ dx: number; dz: number } | null>(null)
  if (!arranging) return () => ({})
  const floor = (e: ThreeEvent<PointerEvent>) => {
    const { origin: o, direction: d } = e.ray
    if (d.y >= -1e-6) return null
    const t = -o.y / d.y
    return { x: o.x + d.x * t, z: o.z + d.z * t }
  }
  return (id, position) => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return
      e.stopPropagation()
      useViewer.getState().set({ selectedId: id, arrangeMessage: null })
      const hit = floor(e)
      if (!hit || roomState()?.placements[id]?.locked) return
      grab.current = { dx: position[0] - hit.x, dz: position[2] - hit.z }
      capture(e, true)
    },
    onPointerMove: (e) => {
      const hit = grab.current && floor(e)
      if (!hit) return
      const [x, z] = [hit.x + grab.current!.dx, hit.z + grab.current!.dz]
      const others = layout.exhibits.filter((o) => o.id !== id).map((o) => o.position)
      const valid = exhibitFits(x, z, layout.width, layout.depth, layout.doors, layout.obstacles, others)
      useViewer.getState().set({ drag: { id, placement: floorPlacement(x, z, layout), valid, guides: {} } })
    },
    onPointerUp: (e) => {
      if (!grab.current) return
      grab.current = null
      capture(e, false)
      commit()
    },
  })
}

/** Right-drag rotates the view while the pointer is free. */
function useLookDrag() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    const el = gl.domElement
    const euler = new Euler(0, 0, 0, 'YXZ')
    let last: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 2) return
      last = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!last) return
      euler.setFromQuaternion(camera.quaternion)
      euler.y -= (e.clientX - last.x) * 0.004
      euler.x = Math.min(Math.max(euler.x - (e.clientY - last.y) * 0.004, -1.4), 1.4)
      camera.quaternion.setFromEuler(euler)
      last = { x: e.clientX, y: e.clientY }
    }
    const up = () => void (last = null)
    const menu = (e: Event) => e.preventDefault()
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('contextmenu', menu)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('contextmenu', menu)
    }
  }, [gl, camera])
}

function Guides({ drag, layout }: { drag: DragPreview; layout: RoomLayout }) {
  if (drag.placement.wall === 'floor') return null
  const wall = drag.placement.wall as Wall
  const L = wallLength(wall, layout.width, layout.depth)
  const line = (a: number, y: number, size: [number, number]) => (
    <mesh position={toWorld(wall, a, y, layout.width, layout.depth, 0.03)} rotation-y={ROTATION[wall]}>
      <planeGeometry args={size} />
      <meshBasicMaterial color="#3b82f6" toneMapped={false} />
    </mesh>
  )
  return (
    <>
      {drag.guides.y !== undefined && line(0, drag.guides.y, [L, 0.015])}
      {drag.guides.a !== undefined && line(0, layout.height / 2, [0.015, layout.height])}
    </>
  )
}

/** Resize handle on the selected display, plus alignment guides while dragging. */
export function ArrangeLayer({ layout }: { layout: RoomLayout }) {
  const selectedId = useViewer((s) => s.selectedId)
  const drag = useViewer((s) => s.drag)
  const resizing = useRef(false)
  useLookDrag()
  const d = layout.displays.find((x) => x.id === selectedId)
  const locked = d ? roomState()?.placements[d.id]?.locked : false
  return (
    <>
      {drag && <Guides drag={drag} layout={layout} />}
      {d && !locked && (
        <group position={d.position} rotation-y={d.rotationY}>
          <mesh
            position={[d.width / 2 + 0.04, -d.height / 2 - 0.04, 0.03]}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              e.stopPropagation()
              resizing.current = true
              capture(e, true)
            }}
            onPointerMove={(e) => {
              if (!resizing.current) return
              const hit = hitWall(e.ray.origin, e.ray.direction, layout.width, layout.depth, layout.height)
              const p = hit && proposeResize(layout, d, hit)
              if (p) useViewer.getState().set({ drag: p })
            }}
            onPointerUp={(e) => {
              if (!resizing.current) return
              resizing.current = false
              capture(e, false)
              commit()
            }}
          >
            <planeGeometry args={[0.16, 0.16]} />
            <meshBasicMaterial color="#3b82f6" toneMapped={false} />
          </mesh>
        </group>
      )}
    </>
  )
}
