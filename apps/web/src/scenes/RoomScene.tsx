import { Canvas } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { AgXToneMapping, type Group } from 'three'
import { QUALITY } from '../app/quality'
import { DashboardDisplay, type FrameState, WallDisplay } from '../charts/displays'
import { Exhibit3D, PEDESTAL_HALF } from '../charts/Exhibit3D'
import { ArrangeLayer, useArrangeHandlers, useExhibitHandlers } from '../editor/Arrange'
import { activeMembers, computeLayout, doorTargets } from '../layouts/items'
import { type PlacedDisplay, resolvePlacement, type Wall } from '../layouts/wallLayout'
import { Focus } from '../navigation/Focus'
import { MouseLook } from '../navigation/MouseLook'
import { type Portal, Player } from '../navigation/Player'
import type { Report, Room } from '../state/schema'
import { roomTheme, useViewer } from '../state/store'
import { DisplayContext } from '../themes/context'
import { TourCamera } from '../tour/TourCamera'
import { roomGeometry } from '../themes/geometry'
import { constraintsFor, useTheme } from '../themes/load'
import { ContactShadows } from './ContactShadows'
import { ThemedRoom } from './ThemedRoom'

/** One WebGL canvas per quality level; room content remounts (and disposes) per room. */
export function RoomScene({ report, room }: { report: Report; room: Room }) {
  const quality = useViewer((s) => s.quality)
  // The inspector and the editor cover the whole screen: draw no frames behind them (on weak
  // or software GPUs, a frame can take longer than the interface may wait).
  const covered = useViewer((s) => s.overlay === 'inspector' || s.overlay === 'editor')
  const q = QUALITY[quality]
  return (
    <Canvas
      key={quality}
      frameloop={covered ? 'never' : 'always'}
      shadows={q.shadows ? 'percentage' : false}
      dpr={q.dpr}
      camera={{ fov: 70, near: 0.05, far: 150 }}
      onCreated={({ gl }) => {
        gl.toneMapping = AgXToneMapping
        // Read-only renderer statistics for performance and leak tests.
        Object.assign(window, { datawalkRenderer: { info: () => gl.info, gpu: () => gl.getContext().getParameter(gl.getContext().VERSION) } })
      }}
    >
      <Suspense fallback={<Loading />}>
        <RoomContent key={room.id} report={report} room={room} />
      </Suspense>
      <MouseLook />
    </Canvas>
  )
}

/** While theme assets download: the page shows "Loading the room" (the canvas stays black). */
function Loading() {
  useEffect(() => {
    useViewer.setState({ roomLoading: true })
    return () => useViewer.setState({ roomLoading: false })
  }, [])
  return null
}

function RoomContent({ report, room }: { report: Report; room: Room }) {
  const targets = useRef<Group>(null)
  const drag = useViewer((s) => s.drag)
  const arranging = useViewer((s) => s.arranging)
  const selectedId = useViewer((s) => s.selectedId)
  const quality = QUALITY[useViewer((s) => s.quality)]
  const themeId = roomTheme(report, room, useViewer((s) => s.previewTheme))
  const bundle = useTheme(themeId)
  const [arrivedFrom] = useMemo(() => [useViewer.getState().arrivedFrom], [])
  const doorRooms = doorTargets(report, room.id)
  const constraints = useMemo(() => constraintsFor(bundle, doorRooms.length), [bundle, doorRooms.length])
  const layout = useMemo(() => computeLayout(report, room, drag, constraints), [report, room, drag, constraints])
  const geometry = useMemo(
    () => roomGeometry(bundle.room, bundle.library, layout.width, layout.depth, doorRooms.length),
    [bundle, layout.width, layout.depth, doorRooms.length],
  )
  const vizById = useMemo(() => new Map(report.visualizations.map((v) => [v.id, v])), [report])
  // A customer brand overrides the theme's frame and plaque colors.
  const brand = report.brand
  const display = useMemo(
    () => ({
      ...bundle.theme.display,
      frame: brand?.frame ?? bundle.theme.display.frame,
      plaque: { background: brand?.plaque ?? bundle.theme.display.plaque.background, text: brand?.plaque_text ?? bundle.theme.display.plaque.text },
    }),
    [bundle, brand],
  )
  const handlers = useArrangeHandlers(layout)
  const exhibitHandlers = useExhibitHandlers(layout)

  const doorLabels = doorRooms.map((id) => report.rooms.find((r) => r.id === id)?.name ?? null)
  const portals: Portal[] = layout.doors.flatMap((d, i) => {
    const target = doorRooms[i]
    return target ? [{ x: d.position[0], z: layout.depth / 2, width: d.width, target }] : []
  })
  const spawn = layout.doors[arrivedFrom ? doorRooms.indexOf(arrivedFrom) : -1]?.spawn ?? layout.spawn
  // What blocks walking: furniture footprints and the pedestals of 3D exhibits.
  const world = useMemo(
    () => ({
      width: layout.width,
      depth: layout.depth,
      boxes: [
        ...geometry.obstacles,
        ...layout.exhibits.map(({ position: [x, , z] }) => ({ x0: x - PEDESTAL_HALF, x1: x + PEDESTAL_HALF, z0: z - PEDESTAL_HALF, z1: z + PEDESTAL_HALF })),
      ],
    }),
    [layout, geometry],
  )

  const item = (d0: PlacedDisplay) => {
    let d = d0
    let state: FrameState | undefined
    if (arranging && d.id === selectedId) state = 'selected'
    // An invalid drag shows where the display would go, in red, without moving the others.
    if (drag && !drag.valid && drag.id === d.id && drag.placement.wall !== 'floor') {
      const g = resolvePlacement(drag.placement, d.width / d.height, layout.width, layout.depth, layout.height)
      d = { ...d, ...g, wall: drag.placement.wall as Wall }
      state = 'invalid'
    }
    const viz = vizById.get(d.id)
    const dashboard = report.dashboards.find((x) => x.id === d.id)
    return (
      <group key={d.id} {...handlers(d0)}>
        {viz ? (
          <WallDisplay d={d} viz={viz} state={state} />
        ) : dashboard ? (
          <DashboardDisplay d={d} dashboard={dashboard} members={activeMembers(report, d.id)} state={state} />
        ) : null}
      </group>
    )
  }

  return (
    <DisplayContext.Provider value={display}>
      <>
        <ThemedRoom
          key={`${themeId}:${layout.width}x${layout.depth}`}
          bundle={bundle}
          layout={layout}
          geometry={geometry}
          doorLabels={doorLabels}
          quality={quality}
        />
        <Player spawn={spawn} portals={portals} roomId={room.id} world={world} />
        <group ref={targets}>
          {layout.displays.map(item)}
          {layout.exhibits.map((e) => (
            <group key={e.id} {...exhibitHandlers(e.id, e.position)}>
              <Exhibit3D viz={vizById.get(e.id)!} position={e.position} selected={arranging && e.id === selectedId} />
            </group>
          ))}
        </group>
      </>
      {quality.ao && <ContactShadows key={`${layout.width}x${layout.depth}`} width={layout.width} depth={layout.depth} />}
      <Focus targets={targets} />
      <TourCamera layout={layout} roomId={room.id} doorRooms={doorRooms} />
      {arranging && <ArrangeLayer layout={layout} />}
    </DisplayContext.Provider>
  )
}
