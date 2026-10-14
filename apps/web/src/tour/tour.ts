// Guided tour: the stops, the controls, and the link to the presenter window.
import { activeMembers } from '../layouts/items'
import { unlockPointer } from '../navigation/input'
import { displayName, type Report, type TourStop } from '../state/schema'
import { useViewer } from '../state/store'

export const DEFAULT_DURATION = 10 // seconds per stop in auto-play when a stop has none

export interface Stop {
  stop: TourStop
  roomId: string
  targetId: string | null // display or exhibit to frame; null frames the room
  kind: 'room' | 'visualization' | 'dashboard'
  title: string
}

/** Rooms in order (the summary room is first), each followed by its items. Same as Python. */
export function defaultTour(report: Report): TourStop[] {
  const active = new Set(report.visualizations.filter((v) => v.status === 'active').map((v) => v.id))
  const stop = (ref: string): TourStop => ({ id: ref, ref, notes: '', duration: null })
  return report.rooms.flatMap((room) => [
    stop(room.id),
    ...room.items.filter((i) => active.has(i) || activeMembers(report, i).length > 0).map(stop),
  ])
}

/** The report's tour (or the default order), resolved to rooms and displays. Stops whose
 *  target is removed or in no room are skipped. */
export function tourStops(report: Report, stops: TourStop[] = report.tour.length ? report.tour : defaultTour(report)): Stop[] {
  return stops.flatMap((stop): Stop[] => {
    const room = report.rooms.find((r) => r.id === stop.ref)
    if (room) return [{ stop, roomId: room.id, targetId: null, kind: 'room', title: room.name }]
    const viz = report.visualizations.find((v) => v.id === stop.ref && v.status === 'active')
    const dash = report.dashboards.find((d) => d.id === stop.ref)
    if (dash && !activeMembers(report, dash.id).length) return []
    if (!viz && !dash) return []
    // A chart inside a dashboard is framed through its dashboard.
    const home = report.rooms.find((r) => r.items.includes(stop.ref))
    const holder = viz && !home ? report.dashboards.find((d) => d.items.includes(viz.id) && report.rooms.some((r) => r.items.includes(d.id))) : undefined
    const holderRoom = holder && report.rooms.find((r) => r.items.includes(holder.id))
    const roomId = home?.id ?? holderRoom?.id
    if (!roomId) return []
    return [
      {
        stop,
        roomId,
        targetId: home ? stop.ref : holder!.id,
        kind: viz ? 'visualization' : 'dashboard',
        title: viz ? displayName(viz) : dash!.name,
      },
    ]
  })
}

/** The stops being presented: the AI guide's plan while it presents, else the report's tour. */
export function activeStops(report: Report): Stop[] {
  const guide = useViewer.getState().guideTour
  return guide ? tourStops(report, guide) : tourStops(report)
}

export function currentStop(): Stop | null {
  const { report, presenting, stopIndex } = useViewer.getState()
  if (!report || !presenting) return null
  return activeStops(report)[stopIndex] ?? null
}

/** Show stop i (clamped). Kiosk mode wraps around. */
export function goTo(i: number) {
  const s = useViewer.getState()
  if (!s.report) return
  const stops = activeStops(s.report)
  if (!stops.length) return
  const index = s.kiosk ? (i + stops.length) % stops.length : Math.min(Math.max(i, 0), stops.length - 1)
  const stop = stops[index]
  // In the rooms, the tour camera walks there through the doors (TourCamera); the document
  // view has no doors.
  if (stop.roomId !== s.roomId && s.flat) s.enterRoom(stop.roomId)
  s.set({ presenting: true, stopIndex: index })
  if (s.overlay !== null) s.setOverlay(null) // a clicker press leaves the inspector for the next stop
  broadcast()
}

export function startTour(index = 0, kiosk = false) {
  unlockPointer()
  startedAt = Date.now()
  useViewer.getState().set({ kiosk, flat: false })
  goTo(index)
}

export function stopTour() {
  useViewer.getState().set({ presenting: false, kiosk: false, guideTour: null })
  useViewer.getState().setOverlay('lobby')
  broadcast()
}

export const next = () => goTo(useViewer.getState().stopIndex + 1)
export const prev = () => goTo(useViewer.getState().stopIndex - 1)

/** E / Enter: the inspector for the current stop (a chart, or the first chart of a dashboard). */
export function inspectStop() {
  const stop = currentStop()
  const s = useViewer.getState()
  if (!stop || !s.report) return
  if (stop.kind === 'visualization') s.inspect(stop.stop.ref)
  else if (stop.kind === 'dashboard') {
    const first = activeMembers(s.report, stop.stop.ref)[0]
    if (first) s.inspect(first.id)
  }
}

// -- presenter window -------------------------------------------------------
// BroadcastChannel links two windows of the same origin (two monitors). Pages opened from
// disk (file://) may not share a channel, so the windows also post to each other directly.
// Messages carry absolute stop numbers: a message that arrives twice does no harm.

export type TourMessage =
  | { type: 'state'; presenting: boolean; index: number; startedAt: number }
  | { type: 'go'; index: number }
  | { type: 'hello' }

let channel: BroadcastChannel | null = null
let peer: Window | null = null // the other window, when this one opened it or was opened by it
let startedAt = Date.now()

function send(m: TourMessage) {
  channel?.postMessage(m)
  try {
    peer?.postMessage({ datawalkTour: m }, '*')
  } catch {
    /* the other window is gone */
  }
}

export function broadcast() {
  const { presenting, stopIndex } = useViewer.getState()
  send({ type: 'state', presenting, index: stopIndex, startedAt })
}

/** Connect this window to the tour channel of the report. Returns a disconnect function. */
export function connect(reportId: string, onMessage: (m: TourMessage) => void) {
  try {
    channel = new BroadcastChannel(`datawalk-tour:${reportId}`)
    channel.onmessage = (e) => onMessage(e.data as TourMessage)
  } catch {
    channel = null
  }
  peer ??= window.opener as Window | null
  const onPost = (e: MessageEvent) => {
    const m = (e.data as { datawalkTour?: TourMessage })?.datawalkTour
    if (m && (e.source === peer || peer === null)) onMessage(m)
  }
  addEventListener('message', onPost)
  return () => {
    channel?.close()
    channel = null
    removeEventListener('message', onPost)
  }
}

/** The main window: follow the presenter window's commands. */
export function connectMain(reportId: string) {
  return connect(reportId, (m) => {
    if (m.type === 'go') {
      if (!useViewer.getState().presenting) startedAt = Date.now()
      goTo(m.index)
    } else if (m.type === 'hello') broadcast()
  })
}

/** P: open the presenter view (speaker notes, current and next stop, timer). */
export function openPresenter() {
  const url = new URL(location.href)
  url.searchParams.set('presenter', '1')
  url.hash = ''
  peer = window.open(url.href, 'datawalk-presenter', 'popup,width=1100,height=720')
  if (!useViewer.getState().presenting) startedAt = Date.now()
}

export function sendGo(index: number) {
  send({ type: 'go', index })
}

export function sendHello() {
  send({ type: 'hello' })
}
