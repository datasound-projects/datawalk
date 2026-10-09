// Report edits. Each function mutates a draft (see store.edit) and keeps references valid.
import type { Report, Visualization } from '../state/schema'

export const newId = () => crypto.randomUUID().replaceAll('-', '')

const roomById = (r: Report, id: string) => {
  const room = r.rooms.find((x) => x.id === id)
  if (!room) throw new Error(`No room ${id}`)
  return room
}

export const roomOf = (r: Report, itemId: string) => r.rooms.find((x) => x.items.includes(itemId)) ?? null

export function unassigned(r: Report): Visualization[] {
  const used = new Set([...r.rooms.flatMap((x) => x.items), ...r.dashboards.flatMap((d) => d.items)])
  return r.visualizations.filter((v) => v.status === 'active' && !used.has(v.id))
}

export function addRoom(r: Report, name: string): string {
  const id = newId()
  r.rooms.push({ id, key: null, name, description: '', theme: null, items: [], placements: {} })
  return id
}

/** Its items stay in the report, unassigned. */
export function deleteRoom(r: Report, roomId: string) {
  r.rooms = r.rooms.filter((x) => x.id !== roomId)
}

/** Move an item to a room (null: unassign). A manual placement does not travel with it. */
export function moveItem(r: Report, itemId: string, toRoomId: string | null) {
  for (const room of r.rooms) {
    room.items = room.items.filter((i) => i !== itemId)
    delete room.placements[itemId]
  }
  if (toRoomId) roomById(r, toRoomId).items.push(itemId)
}

export function reorder(r: Report, roomId: string, itemId: string, delta: number) {
  const items = roomById(r, roomId).items
  const i = items.indexOf(itemId)
  const j = i + delta
  if (i < 0 || j < 0 || j >= items.length) return
  ;[items[i], items[j]] = [items[j], items[i]]
}

/** Group charts of one room into a dashboard, at the position of the first chart. */
export function createDashboard(r: Report, roomId: string, name: string, vizIds: string[]): string {
  const id = newId()
  const room = roomById(r, roomId)
  const at = Math.min(...vizIds.map((v) => room.items.indexOf(v)).filter((i) => i >= 0), room.items.length)
  r.dashboards.push({ id, key: null, name, description: '', items: [...vizIds] })
  room.items = room.items.filter((i) => !vizIds.includes(i))
  for (const v of vizIds) delete room.placements[v]
  room.items.splice(Math.min(at, room.items.length), 0, id)
  return id
}

/** Put the charts back where the dashboard was, and delete the dashboard. */
export function ungroup(r: Report, dashboardId: string) {
  const d = r.dashboards.find((x) => x.id === dashboardId)
  if (!d) return
  for (const room of r.rooms) {
    const i = room.items.indexOf(dashboardId)
    if (i < 0) continue
    room.items.splice(i, 1, ...d.items.filter((v) => !room.items.includes(v)))
    delete room.placements[dashboardId]
  }
  r.dashboards = r.dashboards.filter((x) => x.id !== dashboardId)
}

/** Only visualizations whose source is gone ("removed") can be deleted. */
export function deleteRemoved(r: Report, vizId: string) {
  const v = r.visualizations.find((x) => x.id === vizId)
  if (v?.status !== 'removed') return
  r.visualizations = r.visualizations.filter((x) => x.id !== vizId)
  for (const room of r.rooms) {
    room.items = room.items.filter((i) => i !== vizId)
    delete room.placements[vizId]
  }
  for (const d of r.dashboards) d.items = d.items.filter((i) => i !== vizId)
}
