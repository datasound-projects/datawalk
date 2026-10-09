// Keyboard and button placement operations for arrange mode. Each returns a validated
// proposal (see placement.ts) or a reason why the move is not possible.
import { t } from '../i18n'
import { computeLayout, doorTargets } from '../layouts/items'
import { EXHIBIT, exhibitFits, type RoomLayout, type Wall, wallLength } from '../layouts/wallLayout'
import type { Placement } from '../state/schema'
import { type DragPreview, roomTheme, useViewer } from '../state/store'
import { constraintsFor, loadedTheme } from '../themes/load'
import { propose } from './placement'

const WALL_ORDER: Wall[] = ['north', 'east', 'south', 'west']

export type Proposal = DragPreview | { error: string }

export function floorPlacement(x: number, z: number, layout: RoomLayout, locked = false): Placement {
  return { wall: 'floor', u: x / layout.width + 0.5, v: z / layout.depth + 0.5, width: EXHIBIT.footprint, locked }
}

/** Move a wall display by (da, dy) meters, or an exhibit by (dx, dz) meters. */
export function moveBy(layout: RoomLayout, id: string, d1: number, d2: number, locked = false): Proposal {
  const d = layout.displays.find((x) => x.id === id)
  if (d) {
    const p = propose(layout, id, d.wall, d.a + d1, d.y + d2, d.width, d.width / d.height, locked)
    return p.valid ? p : { error: t('arrange.error.inTheWay') }
  }
  const e = layout.exhibits.find((x) => x.id === id)
  if (!e) return { error: t('arrange.error.noSelection') }
  const [x, z] = [e.position[0] + d1, e.position[2] + d2]
  const others = layout.exhibits.filter((o) => o.id !== id).map((o) => o.position)
  if (!exhibitFits(x, z, layout.width, layout.depth, layout.doors, layout.obstacles, others))
    return { error: t('arrange.error.tooClose') }
  return { id, placement: floorPlacement(x, z, layout, locked), valid: true, guides: {} }
}

export function resizeBy(layout: RoomLayout, id: string, factor: number, locked = false): Proposal {
  const d = layout.displays.find((x) => x.id === id)
  if (!d) return { error: t('arrange.error.notResizable') }
  const p = propose(layout, id, d.wall, d.a, d.y, d.width * factor, d.width / d.height, locked)
  if (!p.valid) return { error: t('arrange.error.noRoomForSize') }
  if (Math.abs(p.placement.width - d.width) < 1e-6) return { error: t('arrange.error.sizeLimit') }
  return p
}

/** First free position on the next wall (clockwise), scanning from its center. */
export function toNextWall(layout: RoomLayout, id: string, locked = false): Proposal {
  const d = layout.displays.find((x) => x.id === id)
  if (!d) return { error: t('arrange.error.notMovable') }
  for (let k = 1; k <= 4; k++) {
    const wall = WALL_ORDER[(WALL_ORDER.indexOf(d.wall) + k) % 4]
    const L = wallLength(wall, layout.width, layout.depth)
    for (let step = 0; step <= L / 2; step += 0.25)
      for (const a of step ? [step, -step] : [0]) {
        const p = propose(layout, id, wall, a, d.y, d.width, d.width / d.height, locked)
        if (p.valid) return p
      }
  }
  return { error: t('arrange.error.noWall') }
}

/** Next or previous item in room order (walls first, then exhibits). */
export function cycle(layout: RoomLayout, current: string | null, delta: 1 | -1): string | null {
  const ids = [...layout.displays.map((d) => d.id), ...layout.exhibits.map((e) => e.id)]
  if (!ids.length) return null
  const i = current ? ids.indexOf(current) : -1
  return ids[(i + delta + ids.length) % ids.length]
}

/** The layout of the room being arranged, as the scene computes it (same theme constraints). */
export function currentRoomLayout(): RoomLayout | null {
  const s = useViewer.getState()
  const room = s.report?.rooms.find((r) => r.id === s.roomId)
  if (!s.report || !room) return null
  const bundle = loadedTheme(roomTheme(s.report, room, s.previewTheme))
  return computeLayout(s.report, room, null, constraintsFor(bundle, doorTargets(s.report, room.id).length))
}

/** Run an operation on the selected item and commit it, or report why it is not possible. */
export function arrange(op: (layout: RoomLayout, id: string, locked: boolean) => Proposal) {
  const s = useViewer.getState()
  const layout = currentRoomLayout()
  const id = s.selectedId
  const room = s.report?.rooms.find((r) => r.id === s.roomId)
  if (!layout || !room) return
  if (!id) return s.set({ arrangeMessage: t('arrange.error.selectFirst') })
  if (room.placements[id]?.locked) return s.set({ arrangeMessage: t('arrange.error.locked') })
  const p = op(layout, id, false)
  if ('error' in p) return s.set({ arrangeMessage: p.error })
  s.set({ arrangeMessage: null })
  s.edit((r) => {
    r.rooms.find((x) => x.id === room.id)!.placements[id] = p.placement
  })
}

export function select(delta: 1 | -1) {
  const layout = currentRoomLayout()
  if (layout) useViewer.getState().set({ selectedId: cycle(layout, useViewer.getState().selectedId, delta), arrangeMessage: null })
}
