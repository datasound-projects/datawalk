// Turns report rooms into layout input: which items a room shows, and how.
import type { Report, Room, Visualization } from '../state/schema'
import type { DragPreview } from '../state/store'
import { type ItemKind, type LayoutItem, layoutRoom, type RoomConstraints } from './wallLayout'

// Dashboard panel geometry, in units of one cell height.
export const DASHBOARD = { cellAspect: 1.5, pad: 0.06, title: 0.22 }

export function dashboardGrid(n: number) {
  const cols = n <= 3 ? Math.max(n, 1) : Math.ceil(Math.sqrt(n))
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) }
}

export function dashboardAspect(n: number) {
  const { cols, rows } = dashboardGrid(n)
  const { cellAspect, pad, title } = DASHBOARD
  return (cols * cellAspect + (cols + 1) * pad) / (rows + (rows + 1) * pad + title)
}

export const isExhibit = (v: Visualization) =>
  v.source.library === 'plotly' && (v.source.chart_type === 'scatter3d' || v.source.chart_type === 'surface')

export function itemKind(v: Visualization): ItemKind {
  if (v.source.chart_type === 'kpi') return 'kpi'
  if (v.source.chart_type === 'table') return 'table'
  if (v.source.chart_type === 'text') return 'text'
  return isExhibit(v) ? 'exhibit' : 'chart'
}

export const activeMembers = (report: Report, dashboardId: string) => {
  const d = report.dashboards.find((x) => x.id === dashboardId)
  return (d?.items ?? [])
    .map((id) => report.visualizations.find((v) => v.id === id))
    .filter((v): v is Visualization => v?.status === 'active')
}

export function roomItems(report: Report, room: Room): LayoutItem[] {
  const vizById = new Map(report.visualizations.map((v) => [v.id, v]))
  return room.items.flatMap((id): LayoutItem[] => {
    const v = vizById.get(id)
    if (v) return v.status === 'active' ? [{ id, kind: itemKind(v), aspect: v.source.aspect }] : []
    const n = activeMembers(report, id).length
    return n ? [{ id, kind: 'dashboard', aspect: dashboardAspect(n) }] : []
  })
}

/** Rooms form a ring: the left door leads to the previous room, the right door to the next. */
export function doorTargets(report: Report, roomId: string): (string | null)[] {
  const ids = report.rooms.map((r) => r.id)
  const i = ids.indexOf(roomId)
  if (ids.length >= 3) return [ids[(i - 1 + ids.length) % ids.length], ids[(i + 1) % ids.length]]
  if (ids.length === 2) return [ids[1 - i]]
  return [null] // a single room: the door is the entrance only
}

export function computeLayout(report: Report, room: Room, drag: DragPreview | null = null, constraints?: RoomConstraints) {
  const placements = drag?.valid ? { ...room.placements, [drag.id]: drag.placement } : room.placements
  return layoutRoom(roomItems(report, room), placements, doorTargets(report, room.id).length, constraints)
}
