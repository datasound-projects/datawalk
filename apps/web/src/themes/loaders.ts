import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { clear, suspend } from 'suspend-react'
import {
  type BufferGeometry,
  DoubleSide,
  EquirectangularReflectionMapping,
  LoadingManager,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  type WebGLRenderer,
} from 'three'
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { asset } from '../app/assets'
import type { SurfaceSpec } from './schema'

// One manager for all loaders: every URL goes through asset() (inline data in single-file exports).
const manager = new LoadingManager()
manager.setURLModifier((url) => asset(url))

let ktx2: KTX2Loader | null = null
function ktx2Loader(gl: WebGLRenderer) {
  ktx2 ??= new KTX2Loader(manager).setTranscoderPath('vendor/basis/').detectSupport(gl)
  return ktx2
}

function gltfLoader(gl: WebGLRenderer) {
  const l = new GLTFLoader(manager)
  l.setKTX2Loader(ktx2Loader(gl))
  l.setMeshoptDecoder(MeshoptDecoder)
  return l
}

/** Library model (suspends). Callers clone the scene for each placement. */
export function useModel(id: string): GLTF {
  const gl = useThree((s) => s.gl)
  return suspend(() => gltfLoader(gl).loadAsync(`library/models/${id}.glb`), ['model', id])
}

const views = new Map<string, { users: number; timer?: ReturnType<typeof setTimeout> }>()

/** Equirectangular window view (suspends). A view takes about 32 MB of GPU memory: it is
 *  released 30 s after no room shows it (theme previews), not between rooms of one theme. */
export function useView(id: string): Texture {
  const texture = suspend(async () => {
    const t = await new TextureLoader(manager).loadAsync(`library/views/${id}.jpg`)
    t.mapping = EquirectangularReflectionMapping
    t.colorSpace = SRGBColorSpace
    return t
  }, ['view', id])
  useEffect(() => {
    const v = views.get(id) ?? { users: 0 }
    views.set(id, v)
    v.users++
    clearTimeout(v.timer)
    return () => {
      if (--v.users > 0) return
      v.timer = setTimeout(() => {
        if (v.users > 0) return
        views.delete(id)
        clear(['view', id])
        texture.dispose()
      }, 30_000)
    }
  }, [id, texture])
  return texture
}

interface MaterialMaps {
  color: Texture
  normal: Texture
  arm: Texture
}

function useMaps(id: string | null): MaterialMaps | null {
  const gl = useThree((s) => s.gl)
  return suspend(async () => {
    if (!id) return null
    const [color, normal, arm] = await Promise.all(
      ['color', 'normal', 'arm'].map((m) => ktx2Loader(gl).loadAsync(`library/materials/${id}/${m}.ktx2`)),
    )
    for (const t of [color, normal, arm]) t.wrapS = t.wrapT = RepeatWrapping
    return { color, normal, arm }
  }, ['material', id ?? '-'])
}

const materials = new Map<string, MeshStandardMaterial>()

/** Shared PBR material for a surface spec. Geometry carries world-scale UVs (see tileUv). */
export function useSurface(spec: SurfaceSpec | null, opts: { emissive?: string } = {}): MeshStandardMaterial {
  const maps = useMaps(spec?.material ?? null)
  const key = JSON.stringify([spec, opts])
  let m = materials.get(key)
  if (!m) {
    m = new MeshStandardMaterial({
      color: spec?.color ?? '#ffffff',
      roughness: spec?.roughness ?? 1,
      metalness: spec?.metalness ?? 0,
      map: maps?.color ?? null,
      normalMap: maps?.normal ?? null,
      aoMap: maps?.arm ?? null,
      roughnessMap: maps?.arm ?? null,
      metalnessMap: spec && spec.metalness > 0 ? (maps?.arm ?? null) : null,
      emissive: opts.emissive ?? '#000000',
      shadowSide: DoubleSide,
    })
    if (spec) m.normalScale.setScalar(spec.normalScale)
    materials.set(key, m)
  }
  return m
}

/** Replace a geometry's UVs with world-scale coordinates: one texture repeat per `tile` meters.
 *  `u0`, `v0` offset the pattern so that neighbouring pieces of one surface line up. */
export function tileUv(g: BufferGeometry, width: number, height: number, tile: number, u0 = 0, v0 = 0) {
  const uv = g.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (u0 + uv.getX(i) * width) / tile, (v0 + uv.getY(i) * height) / tile)
  uv.needsUpdate = true
  return g
}
