// Theme changes keep manual placements where the new room allows them. A placement that
// collides with the new theme (a window, a pilaster, tall furniture) moves to the nearest
// free position on the same surface, or falls back to automatic placement.
import { computeLayout, doorTargets } from '../layouts/items'
import type { Placement, Report, Room } from '../state/schema'
import { constraintsFor, loadTheme } from '../themes/load'
import type { ThemeId } from '../themes/themes'

export interface PlacementChange {
  roomId: string
  itemId: string
  to: Placement | null // null: automatic placement
}

const STEPS = Array.from({ length: 25 }, (_, k) => (k + 1) * 0.02).flatMap((d) => [d, -d])

function keeps(report: Report, room: Room, itemId: string, placements: Record<string, Placement>, theme: ReturnType<typeof constraintsFor>) {
  const layout = computeLayout(report, { ...room, placements }, null, theme)
  return layout.displays.some((d) => d.id === itemId && d.manual) || layout.exhibits.some((e) => e.id === itemId && e.manual)
}

/** Placement changes that applying `themeId` to these rooms needs. */
export async function planThemeChange(report: Report, roomIds: string[], themeId: ThemeId): Promise<PlacementChange[]> {
  const bundle = await loadTheme(themeId)
  const changes: PlacementChange[] = []
  for (const room of report.rooms.filter((r) => roomIds.includes(r.id))) {
    const constraints = constraintsFor(bundle, doorTargets(report, room.id).length)
    for (const [itemId, p] of Object.entries(room.placements)) {
      if (keeps(report, room, itemId, room.placements, constraints)) continue
      let to: Placement | null = null
      for (const du of STEPS) {
        const u = p.u + du
        if (u < 0 || u > 1) continue
        const candidate = { ...p, u }
        if (keeps(report, room, itemId, { ...room.placements, [itemId]: candidate }, constraints)) {
          to = candidate
          break
        }
      }
      changes.push({ roomId: room.id, itemId, to })
    }
  }
  return changes
}

export function applyPlacementChanges(r: Report, changes: PlacementChange[]) {
  for (const c of changes) {
    const room = r.rooms.find((x) => x.id === c.roomId)
    if (!room) continue
    if (c.to) room.placements[c.itemId] = c.to
    else delete room.placements[c.itemId]
  }
}
