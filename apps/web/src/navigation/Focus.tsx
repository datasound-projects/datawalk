import { useFrame } from '@react-three/fiber'
import { type RefObject, useMemo, useRef } from 'react'
import { type Group, Matrix4, type Object3D, Raycaster, Vector2 } from 'three'
import { useViewer } from '../state/store'

const CENTER = new Vector2(0, 0)
const REACH = 12 // meters: displays across a large themed room stay inspectable

/** Tracks the visualization under the crosshair (objects carry userData.vizId),
 *  and the exhibit point under it (objects carry userData.describe). */
export function Focus({ targets }: { targets: RefObject<Group | null> }) {
  const ray = useMemo(() => {
    const r = new Raycaster()
    r.far = REACH
    r.params.Points.threshold = 0.03 // aiming tolerance at exhibit points (meters)
    r.params.Line.threshold = 0.01 // default (1 m) would let exhibit edges swallow hits
    return r
  }, [])

  const last = useRef({ view: new Matrix4(), children: -1, frame: 0 })

  useFrame(({ camera }) => {
    const { overlay, arranging, focusedId, pointInfo, focus, setPointInfo } = useViewer.getState()
    if (overlay !== null || arranging || !targets.current) return
    // Aim again only when the view or the room content changed, at most every second frame:
    // a hit test against a 300k-point exhibit takes several milliseconds.
    const seen = last.current
    const children = targets.current.children.length
    if (seen.frame++ % 2 || (camera.matrixWorld.equals(seen.view) && children === seen.children)) return
    seen.view.copy(camera.matrixWorld)
    seen.children = children
    ray.setFromCamera(CENTER, camera)
    const hits = ray.intersectObjects(targets.current.children, true)
    let hit = hits[0]
    // In a point cloud, read the point nearest to the crosshair, not the nearest in depth.
    if (hit?.object.type === 'Points')
      for (const h of hits)
        if (h.object === hit.object && (h.distanceToRay ?? Infinity) < (hit.distanceToRay ?? Infinity)) hit = h
    let o: Object3D | null = hit?.object ?? null
    const describe = o?.userData.describe as ((i: number) => string) | undefined
    const index = hit?.index ?? hit?.face?.a // points report index; meshes report a face vertex
    const info = describe && index !== undefined ? describe(index) : null
    while (o && !o.userData.vizId) o = o.parent
    const id: string | null = o?.userData.vizId ?? null
    if (id !== focusedId) focus(id)
    if (info !== pointInfo) setPointInfo(info)
  })
  return null
}
