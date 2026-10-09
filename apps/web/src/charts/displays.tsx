import { useThree } from '@react-three/fiber'
import { useContext, useEffect, useMemo, useState } from 'react'
import { AdditiveBlending, type CanvasTexture, type Texture } from 'three'
import { DASHBOARD, dashboardGrid } from '../layouts/items'
import type { PlacedDisplay } from '../layouts/wallLayout'
import { canvasTexture, labelTexture } from '../scenes/textures'
import { DisplayContext } from '../themes/context'
import type { DisplayStyle, Theme } from '../themes/schema'
import { type Dashboard, displayName, type Visualization } from '../state/schema'
import { useViewer } from '../state/store'
import { loadPreviewTexture } from './preview'

const BEZEL = 0.05 // plaque spacing below the frame
export type FrameState = 'normal' | 'focused' | 'selected' | 'invalid'
const HIGHLIGHT: Record<Exclude<FrameState, 'normal'>, [string, string]> = {
  focused: ['#c08a2e', '#7a4f10'],
  selected: ['#3b82f6', '#1d4ed8'],
  invalid: ['#dc2626', '#991b1b'],
}

const DEFAULT_DISPLAY: Theme['display'] = {
  style: 'premium',
  frame: '#1b1c1f',
  plaque: { background: '#f4f1ea', text: '#222222' },
  spotlight: false,
  glow: null,
}

/** Frame geometry per display style (meters). */
const STYLE: Record<DisplayStyle, { border: number; depth: number; roughness: number; metalness: number; mat?: number; glass?: boolean; backing?: number; fillet?: string; underglow?: boolean }> = {
  premium: { border: 0.07, depth: 0.05, roughness: 0.45, metalness: 0.1, fillet: '#b08d57' },
  monitor: { border: 0.02, depth: 0.035, roughness: 0.25, metalness: 0.4 },
  gallery: { border: 0.03, depth: 0.04, roughness: 0.6, metalness: 0, mat: 0.09 },
  gallery_dark: { border: 0.035, depth: 0.04, roughness: 0.5, metalness: 0.1 },
  steel: { border: 0.045, depth: 0.04, roughness: 0.45, metalness: 1 },
  frameless: { border: 0.008, depth: 0.02, roughness: 0.6, metalness: 0 },
  museum: { border: 0.055, depth: 0.05, roughness: 0.3, metalness: 1 },
  glass: { border: 0.06, depth: 0.03, roughness: 0.05, metalness: 0, glass: true },
  floating: { border: 0.1, depth: 0.04, roughness: 0.8, metalness: 0, backing: 0.05 },
  led: { border: 0.015, depth: 0.04, roughness: 0.4, metalness: 0.8, underglow: true },
}

export const useDisplayStyle = () => useContext(DisplayContext) ?? DEFAULT_DISPLAY

/** Outer margin that a frame adds around the chart, for the plaque position. */
export const frameMargin = (spec: Theme['display']) => STYLE[spec.style].border + (STYLE[spec.style].mat ?? 0)

let poolTexture: CanvasTexture | null = null
function lightPool() {
  poolTexture ??= canvasTexture(256, 256, (ctx) => {
    const g = ctx.createRadialGradient(128, 110, 10, 128, 128, 128)
    g.addColorStop(0, 'rgba(255,236,205,0.9)')
    g.addColorStop(0.55, 'rgba(255,230,190,0.35)')
    g.addColorStop(1, 'rgba(255,230,190,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 256, 256)
  })
  return poolTexture
}

/** A warm pool of light on the wall around a display, as from a gallery spotlight. */
function LightPool({ width, height }: { width: number; height: number }) {
  return (
    <mesh position={[0, 0.08, -0.055]}>
      <planeGeometry args={[width + 1.4, height + 1.6]} />
      <meshBasicMaterial map={lightPool()} transparent blending={AdditiveBlending} depthWrite={false} opacity={0.5} />
    </mesh>
  )
}

function usePreviewTexture(viz: Visualization) {
  const gl = useThree((s) => s.gl)
  // Table and text panels draw UI text: redraw them in a new language (charts keep their texture).
  const lang = useViewer((s) => (['table', 'text'].includes(viz.source.chart_type) ? s.lang : null))
  // A text panel names the charts it cites: redraw it when a name changes.
  const names = useViewer((s) => (viz.source.chart_type === 'text' ? s.report?.visualizations.map(displayName).join('\n') : null))
  const [texture, setTexture] = useState<Texture | null>(null)
  // What the texture shows. Every edit copies the report: reload only when this changes.
  const content = [viz.id, viz.source.has_preview, viz.source.has_payload, viz.source.aspect, displayName(viz), lang, names].join('|')
  useEffect(() => {
    let alive = true
    loadPreviewTexture(viz, gl.capabilities.getMaxAnisotropy())
      .then((t) => (alive ? setTexture(t) : t?.dispose()))
      .catch((e) => console.error(`Preview for ${viz.key} failed`, e))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `content` lists what `viz` shows
  }, [content, gl])
  useEffect(() => () => texture?.dispose(), [texture]) // the replaced texture, once the new one shows
  return texture
}

function useLabel(text: string) {
  const { plaque } = useDisplayStyle()
  const label = useMemo(() => labelTexture(text, plaque.background, plaque.text), [text, plaque.background, plaque.text])
  useEffect(() => () => label.dispose(), [label])
  return label
}

/** Chart surface. Unlit and not tone-mapped: colors stay exactly as the source library drew them. */
function Screen({ viz, width, height, z = 0.001 }: { viz: Visualization; width: number; height: number; z?: number }) {
  const texture = usePreviewTexture(viz)
  return (
    <mesh position-z={z} userData={{ vizId: viz.id }}>
      <planeGeometry args={[width, height]} />
      {/* Keyed: adding a map to an existing material needs a shader recompile. */}
      <meshBasicMaterial key={texture?.id ?? 0} map={texture} color={texture ? '#ffffff' : '#d9d9d9'} toneMapped={false} />
    </mesh>
  )
}

function Frame({ width, height, state }: { width: number; height: number; state: FrameState }) {
  const spec = useDisplayStyle()
  const st = STYLE[spec.style]
  const [color, emissive] = state === 'normal' ? [spec.frame, '#000000'] : HIGHLIGHT[state]
  const mat = st.mat ?? 0
  const outerW = width + 2 * (st.border + mat)
  const outerH = height + 2 * (st.border + mat)
  return (
    <>
      {spec.spotlight && state === 'normal' && <LightPool width={outerW} height={outerH} />}
      {st.backing !== undefined && (
        <mesh position-z={-st.backing} castShadow receiveShadow>
          <boxGeometry args={[outerW, outerH, 0.03]} />
          <meshStandardMaterial color={state === 'normal' ? '#f7f7f5' : color} emissive={emissive} roughness={0.8} />
        </mesh>
      )}
      {st.glass ? (
        <>
          <mesh position-z={-0.012}>
            <boxGeometry args={[outerW, outerH, 0.02]} />
            <meshStandardMaterial color="#cfe9f2" transparent opacity={0.18} roughness={0.05} depthWrite={false} />
          </mesh>
          {/* Glowing edges (or the highlight color when focused or selected). */}
          {[
            [0, outerH / 2, outerW, 0.012],
            [0, -outerH / 2, outerW, 0.012],
            [outerW / 2, 0, 0.012, outerH],
            [-outerW / 2, 0, 0.012, outerH],
          ].map(([x, y, w, h], i) => (
            <mesh key={i} position={[x, y, 0]}>
              <boxGeometry args={[w, h, 0.012]} />
              <meshBasicMaterial color={state === 'normal' ? (spec.glow ?? '#7fdcff') : color} toneMapped={false} />
            </mesh>
          ))}
        </>
      ) : (
        st.backing === undefined && (
          <mesh position-z={-st.depth / 2} castShadow>
            <boxGeometry args={[outerW, outerH, st.depth]} />
            <meshStandardMaterial color={color} emissive={emissive} metalness={st.metalness} roughness={st.roughness} />
          </mesh>
        )
      )}
      {mat > 0 && (
        <mesh position-z={0.0004}>
          <planeGeometry args={[width + 2 * mat, height + 2 * mat]} />
          <meshStandardMaterial color="#fbfbf8" roughness={0.9} />
        </mesh>
      )}
      {st.fillet && (
        // Behind the chart surface (z = 0.001): a thin brass line around it.
        <mesh position-z={-0.01}>
          <boxGeometry args={[width + 0.03, height + 0.03, 0.012]} />
          <meshStandardMaterial color={st.fillet} metalness={1} roughness={0.3} />
        </mesh>
      )}
      {st.underglow && spec.glow && (
        <mesh position={[0, -outerH / 2 - 0.03, 0.01]}>
          <boxGeometry args={[outerW * 0.9, 0.012, 0.012]} />
          <meshBasicMaterial color={spec.glow} toneMapped={false} />
        </mesh>
      )}
    </>
  )
}

function Plaque({ text, y, width }: { text: string; y: number; width: number }) {
  const { plaque } = useDisplayStyle()
  const label = useMemo(() => labelTexture(text, plaque.background, plaque.text), [text, plaque.background, plaque.text])
  useEffect(() => () => label.dispose(), [label])
  const w = Math.min(width, 2.2)
  return (
    <mesh position={[0, y, 0]}>
      <planeGeometry args={[w, w / 8]} />
      <meshStandardMaterial map={label} roughness={0.8} />
    </mesh>
  )
}

/** A single chart, KPI or table on the wall, with a name plaque below. */
export function WallDisplay({ d, viz, state }: { d: PlacedDisplay; viz: Visualization; state?: FrameState }) {
  const focused = useViewer((s) => s.focusedId === viz.id)
  const spec = useDisplayStyle()
  return (
    <group position={d.position} rotation-y={d.rotationY} userData={{ vizId: viz.id, displayId: d.id }}>
      <Frame width={d.width} height={d.height} state={state ?? (focused ? 'focused' : 'normal')} />
      <Screen viz={viz} width={d.width} height={d.height} />
      <Plaque text={displayName(viz)} y={-d.height / 2 - frameMargin(spec) - BEZEL - 0.12} width={d.width} />
    </group>
  )
}

/** Several charts on one panel. Each cell is separately focusable and inspectable. */
export function DashboardDisplay({
  d,
  dashboard,
  members,
  state,
}: {
  d: PlacedDisplay
  dashboard: Dashboard
  members: Visualization[]
  state?: FrameState
}) {
  const focusedMember = useViewer((s) => members.some((m) => m.id === s.focusedId))
  const { cols, rows } = dashboardGrid(members.length)
  const unit = d.height / (rows + (rows + 1) * DASHBOARD.pad + DASHBOARD.title)
  const cellW = (d.width - (cols + 1) * DASHBOARD.pad * unit) / cols
  const cellH = unit
  const titleH = DASHBOARD.title * unit
  const title = useLabel(dashboard.name)
  return (
    <group position={d.position} rotation-y={d.rotationY} userData={{ displayId: d.id }}>
      <Frame width={d.width} height={d.height} state={state ?? (focusedMember ? 'focused' : 'normal')} />
      <mesh position-z={0.0005}>
        <planeGeometry args={[d.width, d.height]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.9} />
      </mesh>
      <mesh position={[0, d.height / 2 - titleH / 2 - DASHBOARD.pad * unit * 0.5, 0.002]}>
        <planeGeometry args={[titleH * 8, titleH]} />
        <meshBasicMaterial map={title} toneMapped={false} />
      </mesh>
      {members.map((m, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        const x = -d.width / 2 + DASHBOARD.pad * unit * (col + 1) + cellW * (col + 0.5)
        const y = d.height / 2 - titleH - DASHBOARD.pad * unit * (row + 1) - cellH * (row + 0.5)
        // Letterbox each chart in its cell at its own aspect ratio.
        const fit = Math.min(cellW / (cellH * m.source.aspect), 1)
        const w = cellH * m.source.aspect * fit
        const h = cellH * fit
        return (
          <group key={m.id} position={[x, y, 0]} userData={{ vizId: m.id }}>
            <Screen viz={m} width={w} height={h} z={0.003} />
          </group>
        )
      })}
    </group>
  )
}
