import { Environment } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { BoxGeometry, Color, type Object3D, PlaneGeometry, type SpotLight } from 'three'
import { asset } from '../app/assets'
import type { QualitySettings } from '../app/quality'
import { ROTATION, type RoomLayout, toWorld, type Vec3, type Wall, wallLength } from '../layouts/wallLayout'
import type { PlacedFurniture, RoomGeometry } from '../themes/geometry'
import type { ThemeBundle } from '../themes/load'
import { tileUv, useModel, useSurface, useView } from '../themes/loaders'
import type { SurfaceSpec } from '../themes/schema'
import { labelTexture } from './textures'

const WALLS: Wall[] = ['north', 'east', 'south', 'west']

interface Props {
  bundle: ThemeBundle
  layout: RoomLayout
  geometry: RoomGeometry
  doorLabels: (string | null)[]
  quality: QualitySettings
}

/** A themed room: textured shell, windows with a view, fixtures, furniture and lighting. */
export function ThemedRoom(props: Props) {
  const { bundle, layout, geometry } = props
  const { theme, room } = bundle
  return (
    <>
      <Floor W={layout.width} D={layout.depth} spec={theme.surfaces.floor} />
      <Ceiling layout={layout} spec={theme.surfaces.ceiling} skylight={room.skylight} bounce={theme.lighting.ceilingBounce} />
      <Walls layout={layout} geometry={geometry} spec={theme.surfaces.walls} />
      {theme.surfaces.wainscot && <Wainscot layout={layout} geometry={geometry} spec={theme.surfaces.wainscot} />}
      <Trim layout={layout} color={theme.surfaces.trim} />
      <Windows geometry={geometry} layout={layout} />
      {geometry.pilasters.length > 0 && room.pilasters && <Pilasters layout={layout} geometry={geometry} color={room.pilasters.color} width={room.pilasters.width} depth={room.pilasters.depth} />}
      {room.beams && <Beams layout={layout} spacing={room.beams.spacing} depth={room.beams.depth} color={room.beams.color} />}
      {geometry.rug && theme.surfaces.rug && <Rug rect={geometry.rug} spec={theme.surfaces.rug} />}
      {room.benches && <Benches rects={geometry.benches} color={room.benches.color} seat={room.benches.seat} />}
      {geometry.furniture.map((f, i) => (
        <Furniture key={i} item={f} />
      ))}
      {layout.doors.map((d, i) => (
        <Door key={i} x={d.position[0]} width={d.width} height={d.height} z={layout.depth / 2} label={props.doorLabels[i]} color={theme.door.color} frame={theme.door.frame} />
      ))}
      <Lighting {...props} />
    </>
  )
}

function Floor({ W, D, spec }: { W: number; D: number; spec: SurfaceSpec }) {
  const material = useSurface(spec)
  const geo = useMemo(() => tileUv(new PlaneGeometry(1, 1), W, D, spec.tile), [W, D, spec.tile])
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={material} rotation-x={-Math.PI / 2} scale={[W, D, 1]} receiveShadow />
}

function Ceiling({ layout, spec, skylight, bounce }: { layout: RoomLayout; spec: SurfaceSpec; skylight: ThemeBundle['room']['skylight']; bounce: number }) {
  const { width: W, depth: D, height: H } = layout
  const material = useSurface(spec, { emissive: '#' + new Color(spec.color).multiplyScalar(bounce).getHexString() })
  // Pieces in (x, z) around an optional skylight opening.
  const pieces = useMemo(() => {
    if (!skylight) return [[-W / 2, W / 2, -D / 2, D / 2]]
    const [sx, sz] = [(skylight.size[0] * W) / 2, (skylight.size[1] * D) / 2]
    return [
      [-W / 2, W / 2, -D / 2, -sz],
      [-W / 2, W / 2, sz, D / 2],
      [-W / 2, -sx, -sz, sz],
      [sx, W / 2, -sz, sz],
    ]
  }, [W, D, skylight])
  return (
    <>
      {pieces.map(([x0, x1, z0, z1], i) => (
        <SurfaceRect key={i} material={material} tile={spec.tile} w={x1 - x0} h={z1 - z0} u0={x0} v0={z0} position={[(x0 + x1) / 2, H, (z0 + z1) / 2]} rotation={[Math.PI / 2, 0, 0]} />
      ))}
      {skylight && <Skylight W={W} D={D} H={H} spec={skylight} />}
    </>
  )
}

function Skylight({ W, D, H, spec }: { W: number; D: number; H: number; spec: NonNullable<ThemeBundle['room']['skylight']> }) {
  const [sx, sz] = [spec.size[0] * W, spec.size[1] * D]
  const bars = Array.from({ length: spec.mullions }, (_, k) => -sx / 2 + ((k + 1) * sx) / (spec.mullions + 1))
  return (
    <group position={[0, H + 0.02, 0]}>
      <mesh rotation-x={Math.PI / 2}>
        <planeGeometry args={[sx, sz]} />
        <meshStandardMaterial color="#d8e4ea" transparent opacity={0.12} roughness={0.05} metalness={0.1} depthWrite={false} />
      </mesh>
      {bars.map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.06, 0.1, sz]} />
          <meshStandardMaterial color={spec.frame} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0, (s * sz) / 2]}>
          <boxGeometry args={[sx + 0.1, 0.14, 0.1]} />
          <meshStandardMaterial color={spec.frame} roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

/** A flat rectangle of a tiled surface; u0/v0 align the texture with neighbouring pieces. */
function SurfaceRect(p: { material: THREE_MATERIAL; tile: number; w: number; h: number; u0: number; v0: number; position: Vec3; rotation: Vec3 }) {
  const geo = useMemo(() => tileUv(new PlaneGeometry(p.w, p.h), p.w, p.h, p.tile, p.u0, p.v0), [p.w, p.h, p.tile, p.u0, p.v0])
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={p.material} position={p.position} rotation={p.rotation} receiveShadow castShadow />
}
type THREE_MATERIAL = ReturnType<typeof useSurface>

/** Wall faces split around window openings, so that the view shows through. */
function Walls({ layout, geometry, spec }: { layout: RoomLayout; geometry: RoomGeometry; spec: SurfaceSpec }) {
  const { width: W, depth: D, height: H } = layout
  const material = useSurface(spec)
  return (
    <>
      {WALLS.map((wall) => {
        const L = wallLength(wall, W, D)
        const openings = geometry.windows.filter((w) => w.wall === wall).sort((a, b) => a.a0 - b.a0)
        const rects: [number, number, number, number][] = []
        let a = -L / 2
        for (const o of openings) {
          if (o.a0 > a) rects.push([a, o.a0, 0, H])
          if (o.sill > 0) rects.push([o.a0, o.a1, 0, o.sill])
          if (o.head < H) rects.push([o.a0, o.a1, o.head, H])
          a = o.a1
        }
        if (a < L / 2) rects.push([a, L / 2, 0, H])
        return rects.map(([a0, a1, y0, y1], i) => (
          <SurfaceRect
            key={`${wall}${i}`}
            material={material}
            tile={spec.tile}
            w={a1 - a0}
            h={y1 - y0}
            u0={a0}
            v0={y0}
            position={toWorld(wall, (a0 + a1) / 2, (y0 + y1) / 2, W, D, 0)}
            rotation={[0, ROTATION[wall], 0]}
          />
        ))
      })}
    </>
  )
}

function Wainscot({ layout, geometry, spec }: { layout: RoomLayout; geometry: RoomGeometry; spec: SurfaceSpec & { height: number } }) {
  const { width: W, depth: D } = layout
  const material = useSurface(spec)
  const h = spec.height
  return (
    <>
      {WALLS.map((wall) => {
        const L = wallLength(wall, W, D)
        // Skip spans where a window comes down below the wainscot.
        const gaps = geometry.windows.filter((w) => w.wall === wall && w.sill < h).map((w) => [w.a0, w.a1])
        const spans: [number, number][] = []
        let a = -L / 2
        for (const [g0, g1] of gaps.sort((x, y) => x[0] - y[0])) {
          if (g0 > a) spans.push([a, g0])
          a = g1
        }
        if (a < L / 2) spans.push([a, L / 2])
        return spans.map(([a0, a1], i) => (
          <group key={`${wall}${i}`} position={toWorld(wall, (a0 + a1) / 2, h / 2, W, D, 0.012)} rotation-y={ROTATION[wall]}>
            <SurfaceRect material={material} tile={spec.tile} w={a1 - a0} h={h} u0={a0} v0={0} position={[0, 0, 0]} rotation={[0, 0, 0]} />
            <mesh position={[0, h / 2, 0.01]}>
              <boxGeometry args={[a1 - a0, 0.04, 0.03]} />
              <meshStandardMaterial color={spec.color} roughness={0.5} />
            </mesh>
          </group>
        ))
      })}
    </>
  )
}

function Trim({ layout, color }: { layout: RoomLayout; color: string }) {
  const { width: W, depth: D, height: H } = layout
  const boxes: [Vec3, Vec3][] = []
  for (const [y, h, t] of [[0.07, 0.14, 0.025], [H - 0.06, 0.12, 0.05]] as const)
    boxes.push(
      [[0, y, -D / 2 + t / 2], [W, h, t]],
      [[0, y, D / 2 - t / 2], [W, h, t]],
      [[W / 2 - t / 2, y, 0], [t, h, D]],
      [[-W / 2 + t / 2, y, 0], [t, h, D]],
    )
  return (
    <>
      {boxes.map(([p, s], i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={s} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
      ))}
    </>
  )
}

function Windows({ geometry, layout }: { geometry: RoomGeometry; layout: RoomLayout }) {
  const { width: W, depth: D } = layout
  return (
    <>
      {geometry.windows.map((w, i) => {
        const width = w.a1 - w.a0
        const height = w.head - w.sill
        const mullions = Array.from({ length: w.mullions }, (_, k) => -width / 2 + ((k + 1) * width) / (w.mullions + 1))
        const metal = <meshStandardMaterial color={w.frame} roughness={0.45} metalness={0.5} />
        return (
          <group key={i} position={toWorld(w.wall, (w.a0 + w.a1) / 2, (w.sill + w.head) / 2, W, D, -0.04)} rotation-y={ROTATION[w.wall]}>
            <mesh>
              <planeGeometry args={[width, height]} />
              <meshStandardMaterial color="#dfe8ec" transparent opacity={0.1} roughness={0.04} metalness={0.2} depthWrite={false} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={`v${s}`} position={[(s * width) / 2, 0, 0.02]}>
                <boxGeometry args={[0.07, height + 0.07, 0.12]} />
                {metal}
              </mesh>
            ))}
            {[-1, 1].map((s) => (
              <mesh key={`h${s}`} position={[0, (s * height) / 2, 0.02]}>
                <boxGeometry args={[width + 0.07, 0.07, 0.12]} />
                {metal}
              </mesh>
            ))}
            {mullions.map((x) => (
              <mesh key={x} position={[x, 0, 0.02]}>
                <boxGeometry args={[0.045, height, 0.08]} />
                {metal}
              </mesh>
            ))}
          </group>
        )
      })}
    </>
  )
}

function Pilasters({ layout, geometry, color, width, depth }: { layout: RoomLayout; geometry: RoomGeometry; color: string; width: number; depth: number }) {
  const { width: W, depth: D, height: H } = layout
  return (
    <>
      {geometry.pilasters.map((p, i) => (
        <mesh key={i} position={toWorld(p.wall, p.a, H / 2, W, D, depth / 2)} rotation-y={ROTATION[p.wall]} castShadow receiveShadow>
          <boxGeometry args={[width, H, depth]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      ))}
    </>
  )
}

function Beams({ layout, spacing, depth, color }: { layout: RoomLayout; spacing: number; depth: number; color: string }) {
  const { width: W, depth: D, height: H } = layout
  const n = Math.max(1, Math.round(D / spacing))
  return (
    <>
      {Array.from({ length: n - 1 }, (_, k) => -D / 2 + ((k + 1) * D) / n).map((z) => (
        <mesh key={z} position={[0, H - depth / 2, z]} castShadow>
          <boxGeometry args={[W, depth, 0.22]} />
          <meshStandardMaterial color={color} roughness={0.6} metalness={0.4} />
        </mesh>
      ))}
    </>
  )
}

function Rug({ rect, spec }: { rect: NonNullable<RoomGeometry['rug']>; spec: SurfaceSpec }) {
  const material = useSurface(spec)
  const [w, d] = [rect.x1 - rect.x0, rect.z1 - rect.z0]
  const geo = useMemo(() => tileUv(new BoxGeometry(w, 0.012, d), w, d, spec.tile), [w, d, spec.tile])
  useEffect(() => () => geo.dispose(), [geo])
  return <mesh geometry={geo} material={material} position={[(rect.x0 + rect.x1) / 2, 0.006, (rect.z0 + rect.z1) / 2]} receiveShadow />
}

function Benches({ rects, color, seat }: { rects: RoomGeometry['benches']; color: string; seat: string }) {
  return (
    <>
      {rects.map((r, i) => {
        const [cx, cz, w, d] = [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, r.x1 - r.x0, r.z1 - r.z0]
        return (
          <group key={i} position={[cx, 0, cz]}>
            <mesh position={[0, 0.43, 0]} castShadow receiveShadow>
              <boxGeometry args={[w, 0.05, d]} />
              <meshStandardMaterial color={seat} roughness={0.55} />
            </mesh>
            {[-1, 1].map((s) => (
              <mesh key={s} position={[(s * (w - 0.16)) / 2, 0.2, 0]} castShadow>
                <boxGeometry args={[0.05, 0.4, d - 0.06]} />
                <meshStandardMaterial color={color} roughness={0.35} metalness={0.8} />
              </mesh>
            ))}
          </group>
        )
      })}
    </>
  )
}

function Furniture({ item }: { item: PlacedFurniture }) {
  const gltf = useModel(item.spec.model)
  const scene = useMemo(() => {
    const s = gltf.scene.clone(true)
    s.traverse((o: Object3D) => {
      o.castShadow = true
      o.receiveShadow = true
    })
    return s
  }, [gltf])
  const plinth = item.spec.plinth
  const f = item.footprint
  return (
    <>
      <primitive object={scene} position={item.position} rotation-y={item.rotationY} scale={item.spec.scale} />
      {plinth && (
        <mesh position={[(f.x0 + f.x1) / 2, plinth.size[1] / 2, (f.z0 + f.z1) / 2]} castShadow receiveShadow>
          <boxGeometry args={plinth.size} />
          <meshStandardMaterial color={plinth.color} roughness={0.6} />
        </mesh>
      )}
    </>
  )
}

/** Panelled door, flush with the inner face of the south wall, with the target room's name above. */
function Door({ x, width, height, z, label, color, frame }: { x: number; width: number; height: number; z: number; label: string | null; color: string; frame: string }) {
  const f = 0.08
  const sign = useMemo(() => (label ? labelTexture(`→ ${label}`) : null), [label])
  useEffect(() => () => sign?.dispose(), [sign])
  return (
    <group position={[x, 0, z - 0.03]} rotation-y={Math.PI}>
      {sign && (
        <mesh position={[0, height + 0.3, 0.02]}>
          <planeGeometry args={[1.6, 0.2]} />
          <meshStandardMaterial map={sign} roughness={0.8} />
        </mesh>
      )}
      <mesh position={[0, height / 2, 0]} castShadow>
        <boxGeometry args={[width, height, 0.05]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
      {[0.28, 0.68].map((k) => (
        <mesh key={k} position={[0, height * k, 0.03]}>
          <boxGeometry args={[width * 0.7, height * 0.3, 0.01]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (width + f)) / 2, height / 2, 0.01]}>
          <boxGeometry args={[f, height + f, 0.08]} />
          <meshStandardMaterial color={frame} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, height + f / 2, 0.01]}>
        <boxGeometry args={[width + 2 * f, f, 0.08]} />
        <meshStandardMaterial color={frame} roughness={0.5} />
      </mesh>
      <mesh position={[width / 2 - 0.12, 1.0, 0.06]}>
        <sphereGeometry args={[0.035, 16, 12]} />
        <meshStandardMaterial color="#c9a85c" metalness={1} roughness={0.25} />
      </mesh>
    </group>
  )
}

/** Ceiling fixture positions on a grid of about 3.5 m, clear of a skylight. */
export function fixtureGrid(layout: RoomLayout, skylight: ThemeBundle['room']['skylight'], spacing = 3.5): Vec3[] {
  const { width: W, depth: D, height: H } = layout
  const nx = Math.max(1, Math.round(W / spacing))
  const nz = Math.max(1, Math.round(D / spacing))
  const out: Vec3[] = []
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const x = -W / 2 + (W * (i + 0.5)) / nx
      const z = -D / 2 + (D * (j + 0.5)) / nz
      if (skylight && Math.abs(x) < (skylight.size[0] * W) / 2 + 0.3 && Math.abs(z) < (skylight.size[1] * D) / 2 + 0.3) continue
      out.push([x, H - 0.01, z])
    }
  return out
}

function Lighting({ bundle, layout, quality }: Props) {
  const { theme, room } = bundle
  const L = theme.lighting
  const { width: W, depth: D, height: H } = layout
  const get = useThree((s) => s.get)
  const fixtures = useMemo(() => fixtureGrid(layout, room.skylight), [layout, room.skylight])
  // Pendants hang lower and are larger: fewer of them, on a coarser grid.
  const pendantSpots = useMemo(() => fixtureGrid(layout, room.skylight, 5), [layout, room.skylight])
  // Lights at the fixtures nearest the room center, up to the quality budget.
  const lit = useMemo(
    () => [...fixtures].sort((a, b) => Math.hypot(a[0], a[2]) - Math.hypot(b[0], b[2])).slice(0, quality.maxLights),
    [fixtures, quality.maxLights],
  )
  useEffect(() => {
    get().gl.toneMappingExposure = L.exposure
  }, [get, L.exposure])
  const sun = L.sun
  const sunPos = sun ? (sun.direction.map((v) => v * 20) as Vec3) : null
  return (
    <>
      <Environment files={asset(`library/hdri/${L.environment}.hdr`)} environmentIntensity={L.environmentIntensity} />
      {L.view && <Background id={L.view} intensity={L.viewIntensity} rotation={L.viewRotation} />}
      {!L.view && <color attach="background" args={['#050505']} />}
      <hemisphereLight args={[L.ambient.sky, L.ambient.ground, L.ambient.intensity]} />
      {sun && sunPos && (
        <directionalLight
          position={sunPos}
          color={sun.color}
          intensity={sun.intensity}
          castShadow={quality.shadows}
          shadow-mapSize={[quality.shadowMapSize, quality.shadowMapSize]}
          shadow-bias={-0.0004}
          shadow-normalBias={0.03}
          shadow-camera-left={-Math.max(W, D)}
          shadow-camera-right={Math.max(W, D)}
          shadow-camera-top={Math.max(W, D)}
          shadow-camera-bottom={-Math.max(W, D)}
          shadow-camera-near={1}
          shadow-camera-far={60}
        />
      )}
      {L.fixtures !== 'none' && L.fixtures !== 'strips' && (
        <Fixtures kind={L.fixtures} positions={L.fixtures === 'pendants' ? pendantSpots : fixtures} color={L.fixtureColor} pendants={room.pendants} />
      )}
      {lit.map((p, i) => (
        <Downlight key={i} position={[p[0], H - 0.05, p[2]]} color={L.fixtureColor} intensity={L.fixtureIntensity * 6} distance={H * 3} />
      ))}
      {(L.fixtures === 'strips' || L.accent) && <Strips layout={layout} color={L.accent?.color ?? L.fixtureColor} intensity={L.accent?.intensity ?? 2} />}
    </>
  )
}

function Background({ id, intensity, rotation }: { id: string; intensity: number; rotation: number }) {
  const view = useView(id)
  const get = useThree((s) => s.get)
  useEffect(() => {
    const scene = get().scene
    scene.backgroundIntensity = intensity
    scene.backgroundRotation.set(0, (rotation * Math.PI) / 180, 0)
  }, [get, intensity, rotation])
  return <primitive object={view} attach="background" />
}

function Fixtures({ kind, positions, color, pendants }: { kind: 'downlights' | 'panels' | 'tracks' | 'pendants'; positions: Vec3[]; color: string; pendants: ThemeBundle['room']['pendants'] }) {
  return (
    <>
      {positions.map((p, i) => {
        if (kind === 'pendants' && pendants) return <Pendant key={i} position={p} model={pendants.model} drop={pendants.drop} />
        if (kind === 'panels')
          return (
            <mesh key={i} position={p} rotation-x={Math.PI / 2}>
              <planeGeometry args={[1.2, 1.2]} />
              <meshBasicMaterial color={color} toneMapped={false} />
            </mesh>
          )
        if (kind === 'tracks')
          return (
            <group key={i} position={p}>
              <mesh position={[0, -0.03, 0]}>
                <boxGeometry args={[2.4, 0.04, 0.05]} />
                <meshStandardMaterial color="#1c1c1e" roughness={0.4} metalness={0.7} />
              </mesh>
              {[-0.9, 0, 0.9].map((x) => (
                <mesh key={x} position={[x, -0.12, 0]} rotation-x={0.5}>
                  <cylinderGeometry args={[0.045, 0.055, 0.16, 16]} />
                  <meshStandardMaterial color="#1c1c1e" roughness={0.4} metalness={0.7} emissive={color} emissiveIntensity={0.05} />
                </mesh>
              ))}
            </group>
          )
        return (
          <mesh key={i} position={[p[0], p[1] - 0.005, p[2]]} rotation-x={Math.PI / 2}>
            <circleGeometry args={[0.09, 24]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        )
      })}
    </>
  )
}

function Pendant({ position, model, drop }: { position: Vec3; model: string; drop: number }) {
  const gltf = useModel(model)
  const scene = useMemo(() => gltf.scene.clone(true), [gltf])
  return <primitive object={scene} position={[position[0], position[1] - drop, position[2]]} />
}

/** LED strips along the top of the walls. */
function Strips({ layout, color, intensity }: { layout: RoomLayout; color: string; intensity: number }) {
  const { width: W, depth: D, height: H } = layout
  const strips: [Vec3, Vec3][] = [
    [[0, H - 0.25, -D / 2 + 0.03], [W, 0.03, 0.02]],
    [[0, H - 0.25, D / 2 - 0.03], [W, 0.03, 0.02]],
    [[W / 2 - 0.03, H - 0.25, 0], [0.02, 0.03, D]],
    [[-W / 2 + 0.03, H - 0.25, 0], [0.02, 0.03, D]],
    [[0, 0.16, -D / 2 + 0.03], [W, 0.02, 0.02]],
    [[W / 2 - 0.03, 0.16, 0], [0.02, 0.02, D]],
    [[-W / 2 + 0.03, 0.16, 0], [0.02, 0.02, D]],
  ]
  return (
    <>
      {strips.map(([p, s], i) => (
        <mesh key={i} position={p}>
          <boxGeometry args={s} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={intensity} toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}

/** A spotlight aimed straight down, as from a ceiling fixture: it lights the room, not the ceiling. */
function Downlight({ position, color, intensity, distance }: { position: Vec3; color: string; intensity: number; distance: number }) {
  const ref = useRef<SpotLight>(null)
  useEffect(() => {
    const light = ref.current
    if (!light) return
    light.target.position.set(0, -1, 0)
    light.add(light.target) // a child target follows the light
  }, [])
  return <spotLight ref={ref} position={position} color={color} intensity={intensity} distance={distance} angle={1.05} penumbra={1} decay={2} />
}
