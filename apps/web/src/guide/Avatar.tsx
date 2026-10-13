// The guide's face: a small procedural head (no model file, no new dependency). Mouth, eyes,
// and brows take ARKit blendshape weights: Audio2Face-3D frames drive them directly, the lip
// sync fallback drives the jaw. A VRM avatar (@pixiv/three-vrm) could take the same weights.
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type Group, MathUtils, type Mesh } from 'three'
import type { Phase } from './session'
import { sampleFace } from './speech'

const SKIN = '#e7c09b'
const HAIR = '#3a2b24'
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Blinks by itself every 2 to 5 seconds, unless Audio2Face sends the eyelids. */
function useBlink() {
  const s = useRef({ next: 1.5, start: -1 })
  return (t: number, given: number) => {
    if (given >= 0) return given
    if (t > s.current.next) s.current = { start: t, next: t + 2 + Math.random() * 3 }
    const b = (t - s.current.start) / 0.16
    return b >= 0 && b < 1 ? Math.sin(Math.PI * b) : 0
  }
}

function Head({ phase, accent }: { phase: Phase; accent: string }) {
  const head = useRef<Group>(null!)
  const mouth = useRef<Mesh>(null!)
  const eyes = useRef<(Group | null)[]>([])
  const brows = useRef<(Mesh | null)[]>([])
  const w = useRef({ jaw: 0, funnel: 0, smile: 0.15, brow: 0 })
  const blink = useBlink()
  const still = useMemo(() => reducedMotion(), [])

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime
    const target = sampleFace(performance.now())
    const k = 1 - Math.exp(-dt * 20) // fast enough for syllables, smooth enough for 30 fps data
    const s = w.current
    s.jaw += (target.jawOpen - s.jaw) * k
    s.funnel += (target.mouthFunnel - s.funnel) * k
    s.smile += ((phase === 'error' ? 0 : 0.15 + target.mouthSmile) - s.smile) * k * 0.5
    s.brow += ((phase === 'listening' ? 0.6 : phase === 'error' ? -0.4 : target.browInnerUp) - s.brow) * k * 0.4
    const m = mouth.current
    m.scale.set(0.24 * (1 + s.smile * 0.35 - s.funnel * 0.45), 0.035 + s.jaw * 0.2, 0.08)
    const lid = Math.max(0.08, 1 - blink(t, target.eyeBlink))
    for (const e of eyes.current) e?.scale.set(1, lid, 1)
    brows.current.forEach((b, i) => {
      if (!b) return
      b.position.y = 0.5 + s.brow * 0.07
      b.rotation.z = Math.PI / 2 + (i ? 1 : -1) * (0.06 - Math.min(0, s.brow) * 0.4) // capsules stand upright: lay them along the brow
    })
    // Posture by state: a tilt while listening, a look up while thinking or loading.
    const h = head.current
    const sway = still ? 0 : 1
    const tilt = phase === 'listening' ? 0.16 : 0
    const up = phase === 'thinking' || phase === 'loading' ? -0.14 : phase === 'error' ? 0.1 : 0
    h.rotation.z = MathUtils.damp(h.rotation.z, tilt, 4, dt)
    h.rotation.x = MathUtils.damp(h.rotation.x, up + Math.sin(t * 0.9) * 0.03 * sway + s.jaw * 0.05, 4, dt)
    h.rotation.y = MathUtils.damp(h.rotation.y, Math.sin(t * 0.55) * 0.12 * sway, 4, dt)
    h.position.y = 0.15 + Math.sin(t * 1.4) * 0.015 * sway // breathing
  })

  return (
    <>
      <group ref={head} position={[0, 0.15, 0]}>
        <mesh scale={[0.9, 1.02, 0.92]}>
          <sphereGeometry args={[1, 48, 48]} />
          <meshStandardMaterial color={SKIN} roughness={0.65} />
        </mesh>
        <mesh scale={[0.93, 1.03, 0.95]} position={[0, 0.06, -0.05]} rotation={[-0.42, 0, 0]}>
          <sphereGeometry args={[1, 48, 24, 0, Math.PI * 2, 0, 1.3]} />
          <meshStandardMaterial color={HAIR} roughness={0.85} />
        </mesh>
        {[-1, 1].map((side, i) => (
          <group key={side}>
            <mesh position={[side * 0.88, 0.05, 0]} scale={[0.5, 1, 0.8]}>
              <sphereGeometry args={[0.17, 16, 16]} />
              <meshStandardMaterial color={SKIN} roughness={0.7} />
            </mesh>
            <group ref={(g) => void (eyes.current[i] = g)} position={[side * 0.31, 0.22, 0.76]}>
              <mesh scale={[1, 1.12, 0.55]}>
                <sphereGeometry args={[0.15, 24, 24]} />
                <meshStandardMaterial color="#fbfaf7" roughness={0.3} />
              </mesh>
              <mesh position={[0, -0.01, 0.07]}>
                <sphereGeometry args={[0.08, 20, 20]} />
                <meshStandardMaterial color="#22232a" roughness={0.2} />
              </mesh>
              <mesh position={[0.025, 0.03, 0.135]}>
                <sphereGeometry args={[0.022, 8, 8]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            </group>
            <mesh ref={(b) => void (brows.current[i] = b)} position={[side * 0.31, 0.5, 0.8]} rotation={[0, 0, Math.PI / 2]}>
              <capsuleGeometry args={[0.03, 0.2, 4, 8]} />
              <meshStandardMaterial color={HAIR} roughness={0.9} />
            </mesh>
          </group>
        ))}
        <mesh position={[0, 0.0, 0.9]} scale={[1, 1.25, 1]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshStandardMaterial color="#d9ab84" roughness={0.7} />
        </mesh>
        <mesh ref={mouth} position={[0, -0.38, 0.79]} rotation={[0.25, 0, 0]}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshStandardMaterial color="#6e2732" roughness={0.5} />
        </mesh>
      </group>
      <mesh position={[0, -0.95, -0.05]}>
        <cylinderGeometry args={[0.3, 0.34, 0.6, 24]} />
        <meshStandardMaterial color={SKIN} roughness={0.7} />
      </mesh>
      <mesh position={[0, -1.5, -0.05]} rotation={[0, 0, Math.PI / 2]}>
        <capsuleGeometry args={[0.55, 1.1, 8, 24]} />
        <meshStandardMaterial color={accent} roughness={0.75} />
      </mesh>
    </>
  )
}

function accentColor() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#d9a441'
}

/** The 3D face (WebGL), or a flat face when the browser has no WebGL. */
export function Avatar({ phase, webgl }: { phase: Phase; webgl: boolean }) {
  const accent = useMemo(() => accentColor(), [])
  if (!webgl) return <FlatFace />
  return (
    <Canvas className="guide-canvas" dpr={[1, 2]} camera={{ position: [0, -0.3, 5.4], fov: 28 }} gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}>
      <ambientLight intensity={1.1} />
      <directionalLight position={[2, 3, 4]} intensity={1.8} />
      <directionalLight position={[-3, 1, -2]} intensity={0.8} color={accent} />
      <Head phase={phase} accent={accent} />
    </Canvas>
  )
}

/** Without WebGL: the same face in SVG; the mouth follows the same weights. */
function FlatFace() {
  const mouth = useRef<SVGEllipseElement>(null)
  useEffect(() => {
    let frame = 0
    const tick = () => {
      const w = sampleFace(performance.now())
      mouth.current?.setAttribute('ry', String(1.5 + w.jawOpen * 7))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <svg className="guide-canvas" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="34" r="22" fill={SKIN} />
      <path d="M11 30a21 21 0 0 1 42 0c-6-8-14-10-21-10s-15 2-21 10z" fill={HAIR} />
      <circle cx="24" cy="33" r="3" fill="#22232a" />
      <circle cx="40" cy="33" r="3" fill="#22232a" />
      <ellipse ref={mouth} cx="32" cy="45" rx="6" ry="1.5" fill="#6e2732" />
    </svg>
  )
}
