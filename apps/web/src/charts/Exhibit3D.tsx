import { useEffect, useMemo, useState } from 'react'
import { BoxGeometry, BufferAttribute, BufferGeometry, DoubleSide, EdgesGeometry, type Texture } from 'three'
import { loadPayload } from '../app/api'
import { t } from '../i18n'
import type { Vec3 } from '../layouts/wallLayout'
import { canvasTexture, labelTexture } from '../scenes/textures'
import { displayName, type Visualization } from '../state/schema'
import { useViewer } from '../state/store'
import { buildExhibit, EXHIBIT_SIZE as S, type ExhibitData } from './exhibitData'

const PEDESTAL = { size: 1.2, height: 0.9 }
export const PEDESTAL_HALF = PEDESTAL.size / 2 // walking collisions (RoomScene)
const CENTER_Y = PEDESTAL.height + 0.15 + S / 2
export const EXHIBIT_CENTER_Y = CENTER_Y // height of the data cube center (tour framing)

const fmt = (v: number) => (Math.abs(v) >= 1e4 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : +v.toPrecision(4) + '')

function TextSprite({ text, position, scale = 0.06 }: { text: string; position: Vec3; scale?: number }) {
  const tex = useMemo(
    () =>
      canvasTexture(512, 96, (ctx) => {
        ctx.font = '600 52px system-ui, sans-serif'
        ctx.fillStyle = '#1b1b1b'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, 256, 50, 500)
      }),
    [text],
  )
  useEffect(() => () => tex.dispose(), [tex])
  return (
    <sprite position={position} scale={[scale * (512 / 96), scale, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  )
}

/** Axis titles and min / mid / max ticks, in original units. */
function Axes({ data }: { data: ExhibitData }) {
  const h = S / 2
  const [x, y, z] = data.axes
  const mid = (a: ExhibitData['axes'][number]) => (a.log ? Math.sqrt(a.min * a.max) : (a.min + a.max) / 2)
  const ticks = (a: ExhibitData['axes'][number]) => [a.min, mid(a), a.max]
  return (
    <>
      {ticks(x).map((v, i) => (
        <TextSprite key={`x${i}`} text={fmt(v)} position={[-h + i * h, -h - 0.03, h + 0.12]} />
      ))}
      {/* Above the pedestal top (0.15 m below the cube), so that it is not hidden. */}
      <TextSprite text={x.label} position={[0, -h - 0.1, h + 0.2]} scale={0.075} />
      {ticks(y).map((v, i) => (
        <TextSprite key={`y${i}`} text={fmt(v)} position={[h + 0.12, -h - 0.06, h - i * h]} />
      ))}
      <TextSprite text={y.label} position={[h + 0.3, -h - 0.16, 0]} scale={0.075} />
      {ticks(z).map((v, i) => (
        <TextSprite key={`z${i}`} text={fmt(v)} position={[-h - 0.14, -h + i * h, h]} />
      ))}
      <TextSprite text={z.label} position={[-h - 0.2, h + 0.12, h]} scale={0.075} />
    </>
  )
}

function DataGeometry({ data, vizId }: { data: ExhibitData; vizId: string }) {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(data.positions, 3))
    g.setAttribute('color', new BufferAttribute(data.colors, 3))
    if (data.index) {
      g.setIndex(new BufferAttribute(data.index, 1))
      g.computeVertexNormals()
    }
    return g
  }, [data])
  useEffect(() => () => geometry.dispose(), [geometry])
  const userData = { vizId, describe: data.describe }
  return data.kind === 'points' ? (
    <points geometry={geometry} userData={userData}>
      <pointsMaterial size={0.022} vertexColors sizeAttenuation />
    </points>
  ) : (
    <mesh geometry={geometry} userData={userData}>
      <meshStandardMaterial vertexColors side={DoubleSide} roughness={0.6} />
    </mesh>
  )
}

/** A freestanding pedestal with a native 3D rendering of a Plotly 3D figure. */
export function Exhibit3D({ viz, position, selected = false }: { viz: Visualization; position: Vec3; selected?: boolean }) {
  const [data, setData] = useState<ExhibitData | null | undefined>(undefined)
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(S, S, S)), [])
  const title = displayName(viz)
  const name = useMemo(() => labelTexture(title), [title])
  const [note, setNote] = useState<Texture | null>(null)
  const lang = useViewer((s) => s.lang) // the note is drawn text: redraw in a new language

  const ax = viz.source.axes[0]
  const labels = [ax?.x.label || 'x', ax?.y.label || 'y', ax?.z?.label || 'z'].join('\n')
  useEffect(() => {
    // Rebuilt only when the data or the axis labels change, not on every edit.
    let alive = true
    loadPayload(viz.id).then((p) => {
      if (!alive) return
      const built = p.kind === 'plotly' ? buildExhibit(p.figure, labels.split('\n') as [string, string, string]) : null
      setData(built)
      if (!built) setNote(labelTexture(t('exhibit.unavailable')))
    }, console.error)
    return () => {
      alive = false
    }
  }, [viz.id, labels, lang])
  useEffect(() => () => edges.dispose(), [edges])
  useEffect(() => () => name.dispose(), [name])
  useEffect(() => () => note?.dispose(), [note])

  return (
    <>
      {/* Outside the transformed group: a rigid body takes its pose from its props. */}
      <group position={position} userData={{ vizId: viz.id }}>
        <mesh position-y={PEDESTAL.height / 2} castShadow receiveShadow>
          <boxGeometry args={[PEDESTAL.size, PEDESTAL.height, PEDESTAL.size]} />
          <meshStandardMaterial color={selected ? '#3b82f6' : '#2a2b2f'} emissive={selected ? '#1d4ed8' : '#000000'} roughness={0.4} metalness={0.2} />
        </mesh>
        <mesh position={[0, PEDESTAL.height * 0.62, PEDESTAL.size / 2 + 0.001]}>
          <planeGeometry args={[1.1, 1.1 / 8]} />
          <meshStandardMaterial map={name} roughness={0.8} />
        </mesh>
        <group position-y={CENTER_Y}>
          <lineSegments geometry={edges}>
            <lineBasicMaterial color="#8a8a8a" />
          </lineSegments>
          {data && <DataGeometry data={data} vizId={viz.id} />}
          {data && <Axes data={data} />}
          {data === null && note && (
            <mesh userData={{ vizId: viz.id }}>
              <planeGeometry args={[S, S / 8]} />
              <meshBasicMaterial map={note} toneMapped={false} />
            </mesh>
          )}
        </group>
      </group>
    </>
  )
}
