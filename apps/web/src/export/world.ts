// 3D world file export (GLB, USDZ): a static snapshot of the rooms with the chart images.
// Rooms stand side by side without ceilings, so a model viewer shows them from above.
// GLB screens use KHR_materials_unlit (MeshBasicMaterial): chart colors stay exact. USDZ has
// no unlit material: screens are emissive. Names are node names; explanations are extras.
import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  type Texture,
} from 'three'
import { loadPreviewTexture } from '../charts/preview'
import { activeMembers, computeLayout, dashboardGrid, doorTargets } from '../layouts/items'
import type { PlacedDisplay } from '../layouts/wallLayout'
import { displayName, type Report, type Visualization } from '../state/schema'
import { roomTheme } from '../state/store'
import { constraintsFor, loadTheme } from '../themes/load'

type Format = 'glb' | 'usdz'
const GAP = 4 // meters between rooms
const WALL = 0.15

function imageOf(t: Texture): CanvasImageSource {
  return t.image as CanvasImageSource
}

/** One image for a dashboard: its charts in the grid that the wall display uses. */
async function dashboardTexture(report: Report, id: string, name: string): Promise<CanvasTexture> {
  const members = activeMembers(report, id)
  const { cols, rows } = dashboardGrid(members.length)
  const cell = { w: 800, h: 533 }
  const title = 90
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell.w
  canvas.height = rows * cell.h + title
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#222'
  ctx.font = '600 52px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(name, canvas.width / 2, 64)
  const textures = await Promise.all(members.map((v) => loadPreviewTexture(v, 1)))
  textures.forEach((t, i) => {
    if (!t) return
    const img = imageOf(t) as HTMLImageElement
    const iw = img.width || 1
    const ih = img.height || 1
    const s = Math.min((cell.w - 20) / iw, (cell.h - 20) / ih)
    const x = (i % cols) * cell.w + (cell.w - iw * s) / 2
    const y = title + Math.floor(i / cols) * cell.h + (cell.h - ih * s) / 2
    ctx.drawImage(img, x, y, iw * s, ih * s)
  })
  const tex = new CanvasTexture(canvas)
  tex.colorSpace = SRGBColorSpace
  return tex
}

function screenMaterial(map: Texture, format: Format) {
  // USDZ: black base and an emissive map show the image as is under any lighting.
  return format === 'glb' ? new MeshBasicMaterial({ map }) : new MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: map, roughness: 1 })
}

function extras(v: Visualization, room: string) {
  const ex = v.overrides.explanation
  const out: Record<string, unknown> = { kind: 'chart', key: v.key, room, mode: v.source.mode, library: v.source.library }
  if (v.overrides.description) out.description = v.overrides.description
  for (const [k, value] of Object.entries(ex)) if (Array.isArray(value) ? value.length : value) out[k] = value
  return out
}

/** The world as a GLB or USDZ file. */
export async function buildWorld(report: Report, format: Format): Promise<Uint8Array> {
  const scene = new Scene()
  scene.name = report.name
  scene.userData = {
    report: report.name,
    description: report.description,
    revision: report.revision,
    generator: 'datawalk',
    ...(report.classification ? { classification: report.classification } : {}),
  }
  const byId = new Map(report.visualizations.map((v) => [v.id, v]))
  let x0 = 0
  for (const room of report.rooms) {
    const themeId = roomTheme(report, room, null)
    const bundle = await loadTheme(themeId)
    const doors = doorTargets(report, room.id).length
    const layout = computeLayout(report, room, null, constraintsFor(bundle, doors))
    const { width: W, depth: D, height: H } = layout
    const group = new Group()
    group.name = `Room: ${room.name}`
    group.userData = { kind: 'room', key: room.key, theme: themeId, ...(room.description ? { description: room.description } : {}) }
    group.position.x = x0 + W / 2
    const surface = (name: 'floor' | 'walls') => {
      const s = bundle.theme.surfaces[name]
      return new MeshStandardMaterial({ color: s?.color ?? '#dddddd', roughness: 0.9 })
    }
    const floor = new Mesh(new BoxGeometry(W, 0.1, D), surface('floor'))
    floor.name = `${room.name} floor`
    floor.position.y = -0.05
    group.add(floor)
    const wallMat = surface('walls')
    for (const [name, w, d, px, pz] of [
      ['north wall', W, WALL, 0, -D / 2 - WALL / 2],
      ['south wall', W, WALL, 0, D / 2 + WALL / 2],
      ['west wall', WALL, D, -W / 2 - WALL / 2, 0],
      ['east wall', WALL, D, W / 2 + WALL / 2, 0],
    ] as const) {
      const wall = new Mesh(new BoxGeometry(w, H, d), wallMat)
      wall.name = `${room.name} ${name}`
      wall.position.set(px, H / 2, pz)
      group.add(wall)
    }
    const display = async (d: PlacedDisplay) => {
      const v = byId.get(d.id)
      const dash = report.dashboards.find((x) => x.id === d.id)
      const map = v ? await loadPreviewTexture(v, 1) : dash ? await dashboardTexture(report, dash.id, dash.name) : null
      if (!map) return
      const screen = new Mesh(new PlaneGeometry(d.width, d.height), screenMaterial(map, format))
      screen.name = v ? `Chart: ${displayName(v)}` : `Dashboard: ${dash!.name}`
      screen.userData = v
        ? extras(v, room.name)
        : { kind: 'dashboard', room: room.name, charts: activeMembers(report, d.id).map(displayName), ...(dash!.description ? { description: dash!.description } : {}) }
      screen.position.set(...d.position)
      screen.rotation.y = d.rotationY
      // Out of the wall surface, so the image never z-fights with the wall.
      screen.translateZ(0.03)
      group.add(screen)
    }
    for (const d of layout.displays) await display(d)
    for (const e of layout.exhibits) {
      const v = byId.get(e.id)!
      const pedestal = new Mesh(new BoxGeometry(1.2, 0.9, 1.2), new MeshStandardMaterial({ color: '#2b2d31', roughness: 0.6 }))
      pedestal.name = `Pedestal: ${displayName(v)}`
      pedestal.position.set(e.position[0], 0.45, e.position[2])
      group.add(pedestal)
      const map = await loadPreviewTexture(v, 1)
      if (!map) continue
      // A 3D exhibit is interactive data in DataWalk; the world file shows its image.
      const h = 1.2
      const panel = new Mesh(new PlaneGeometry(h * v.source.aspect, h), screenMaterial(map, format))
      panel.name = `Chart: ${displayName(v)}`
      panel.userData = { ...extras(v, room.name), note: 'A 3D exhibit in DataWalk; an image in this file.' }
      panel.position.set(e.position[0], 0.9 + 0.1 + h / 2, e.position[2] + 0.61)
      group.add(panel)
    }
    scene.add(group)
    x0 += W + GAP
  }
  if (format === 'glb') {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js')
    const buffer = (await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 2048 })) as ArrayBuffer
    return new Uint8Array(buffer)
  }
  const { USDZExporter } = await import('three/addons/exporters/USDZExporter.js')
  return new USDZExporter().parseAsync(scene, { quickLookCompatible: true, maxTextureSize: 2048 })
}
