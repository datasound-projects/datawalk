import { useEffect, useMemo, useRef } from 'react'
import { computeLayout, doorTargets } from '../layouts/items'
import { constraintsFor, loadedTheme } from '../themes/load'
import { toWorld } from '../layouts/wallLayout'
import { pose, requestTeleport, standInFront } from '../navigation/pose'
import { displayName, type Report, type Room } from '../state/schema'
import { roomTheme, useViewer } from '../state/store'
import { plural, t } from '../i18n'
import { walk } from './Overlays'

/** Top-down room map. Click a display or exhibit to stand in front of it; click a door to go through. */
export function MapOverlay({ report, room }: { report: Report; room: Room }) {
  const { enterRoom, previewTheme } = useViewer()
  const bundle = loadedTheme(roomTheme(report, room, previewTheme))
  const doors = doorTargets(report, room.id).length
  const layout = useMemo(() => computeLayout(report, room, null, constraintsFor(bundle, doors)), [report, room, bundle, doors])
  const marker = useRef<SVGPathElement>(null)
  const W = layout.width
  const D = layout.depth
  const targets = doorTargets(report, room.id)
  const name = (id: string) => {
    const v = report.visualizations.find((x) => x.id === id)
    return v ? displayName(v) : (report.dashboards.find((x) => x.id === id)?.name ?? '')
  }
  const items = [
    // Far enough back that the whole display fits in view.
    ...layout.displays.map((d) => ({ id: d.id, go: () => standInFront(d.position, d.rotationY, Math.max(2.2, d.width * 0.8 + 0.5)) })),
    ...layout.exhibits.map((e) => ({ id: e.id, go: () => standInFront(e.position, 0, 2.4) })),
  ]
  const teleport = (go: () => ReturnType<typeof standInFront>) => {
    requestTeleport(go())
    walk()
  }

  useEffect(() => {
    let raf = 0
    const tick = () => {
      // Heading: yaw 0 faces north (up on the map).
      marker.current?.setAttribute('transform', `translate(${pose.x} ${pose.z}) rotate(${(-pose.yaw * 180) / Math.PI})`)
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className="overlay map" role="dialog" aria-label={t('map.label')}>
      <div className="card wide map-card">
        <h2>{room.name}</h2>
        <div className="map-body">
          <svg viewBox={`${-W / 2 - 1.2} ${-D / 2 - 1.2} ${W + 2.4} ${D + 2.4}`} className="map-svg">
            <rect x={-W / 2} y={-D / 2} width={W} height={D} className="map-floor" />
            {layout.obstacles.map((o, i) => (
              <rect key={i} x={o.x0} y={o.z0} width={o.x1 - o.x0} height={o.z1 - o.z0} className="map-furniture" />
            ))}
            {layout.doors.map((d, i) => {
              const [x] = d.position
              const target = targets[i]
              return (
                <g
                  key={i}
                  className={target ? 'map-door link' : 'map-door'}
                  onClick={target ? () => (enterRoom(target, room.id), walk()) : undefined}
                >
                  <rect x={x - d.width / 2} y={D / 2 - 0.15} width={d.width} height={0.3} />
                  {target && (
                    // Two doors: labels grow outward from each door so that they never overlap.
                    <text
                      x={x === 0 ? 0 : x + Math.sign(x) * -d.width / 2}
                      y={D / 2 + 0.85}
                      textAnchor={x === 0 ? 'middle' : x < 0 ? 'end' : 'start'}
                    >
                      → {report.rooms.find((r) => r.id === target)?.name}
                    </text>
                  )}
                </g>
              )
            })}
            {layout.displays.map((d) => {
              const [x1, , z1] = toWorld(d.wall, d.a - d.width / 2, 0, W, D, 0.15)
              const [x2, , z2] = toWorld(d.wall, d.a + d.width / 2, 0, W, D, 0.15)
              const [lx, , lz] = toWorld(d.wall, d.a, 0, W, D, 0.75)
              const n = items.findIndex((it) => it.id === d.id) + 1
              return (
                <g key={d.id} className="map-item link" onClick={() => teleport(items[n - 1].go)}>
                  <line x1={x1} y1={z1} x2={x2} y2={z2} className={`map-display ${d.kind}`} />
                  <circle cx={lx} cy={lz} r={0.35} />
                  <text x={lx} y={lz + 0.13} textAnchor="middle">
                    {n}
                  </text>
                </g>
              )
            })}
            {layout.exhibits.map((e) => {
              const n = items.findIndex((it) => it.id === e.id) + 1
              return (
                <g key={e.id} className="map-item link" onClick={() => teleport(items[n - 1].go)}>
                  <rect x={e.position[0] - 0.6} y={-0.6} width={1.2} height={1.2} className="map-exhibit" />
                  <text x={e.position[0]} y={0.13} textAnchor="middle">
                    {n}
                  </text>
                </g>
              )
            })}
            <path ref={marker} d="M0,-0.45 L0.3,0.3 L0,0.15 L-0.3,0.3 Z" className="map-player" />
          </svg>
          <ol className="map-list">
            {items.map((it, i) => (
              <li key={it.id}>
                <button className="link" onClick={() => teleport(it.go)} autoFocus={i === 0}>
                  {name(it.id)}
                </button>
              </li>
            ))}
          </ol>
        </div>
        {layout.overflow.length > 0 && (
          <p className="warn">
            {plural('map.overflow', layout.overflow.length, { names: layout.overflow.map(name).join(', ') })}
          </p>
        )}
        <p className="muted">{t('map.hint')}</p>
      </div>
    </div>
  )
}
