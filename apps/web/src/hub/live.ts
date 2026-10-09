// Live follow over a DataWalk Hub. Only the tour position and the camera pose travel over
// the network; every attendee's browser renders the room itself. Attendees can break away
// (any walking key) and snap back.
import { pose, requestTeleport } from '../navigation/pose'
import { useViewer } from '../state/store'
import { goTo } from '../tour/tour'

interface LiveStatePayload {
  presenting: boolean
  index: number
  roomId: string | null
  x: number
  z: number
  yaw: number
}

let socket: WebSocket | null = null
let last: LiveStatePayload | null = null // the presenter's latest state, for "snap back"
let applying = false // a state from the presenter is being applied: not a local move
let wanted: 'presenter' | 'attendee' | null = null // the role to keep, also after a lost connection
let retry = 0 // reconnect attempts since the last good connection

function url(role: string) {
  const dir = location.pathname.replace(/[^/]*$/, '') // the report's directory: /r/<id>/
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${dir}api/live?role=${role}`
}

function send(m: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m))
}

function apply(state: LiveStatePayload) {
  const s = useViewer.getState()
  applying = true
  try {
    if (state.presenting) goTo(state.index)
    else {
      if (s.presenting) s.set({ presenting: false })
      if (state.roomId && state.roomId !== s.roomId) s.enterRoom(state.roomId)
      if (s.overlay !== null && s.overlay !== 'inspector') s.setOverlay(null)
      requestTeleport({ x: state.x, z: state.z, yaw: state.yaw })
    }
  } finally {
    applying = false
  }
}

/** A followed tour ends with the presentation: the attendee walks freely again. */
function presenterGone() {
  last = null
  const s = useViewer.getState()
  if (s.presenting && s.live?.role === 'attendee') s.set({ presenting: false })
}

/** Follow the presenter (attendees) or lead (presenters, editors and owners). */
export function joinLive(role: 'presenter' | 'attendee') {
  wanted = role
  connect(role)
  if (role === 'presenter') lead()
  else stopLeading()
}

function connect(role: 'presenter' | 'attendee') {
  socket?.close()
  const ws = new WebSocket(url(role))
  socket = ws
  useViewer.setState({ live: { role, presenter: null, following: true, followers: [] } })
  ws.onopen = () => void (retry = 0)
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    const live = useViewer.getState().live
    if (!live) return
    if (m.type === 'presenter') {
      useViewer.setState({ live: { ...live, presenter: m.name } })
      if (!m.name) presenterGone()
      else {
        last = m.state
        if (m.state && live.following) apply(m.state)
      }
    } else if (m.type === 'state') {
      last = m.state
      if (live.following) apply(m.state)
    } else if (m.type === 'followers') useViewer.setState({ live: { ...live, followers: m.list } })
    else if (m.type === 'replaced') joinLive('attendee') // someone else presents now: follow them
  }
  ws.onclose = () => {
    if (socket !== ws) return // replaced by a newer connection
    socket = null
    presenterGone()
    useViewer.setState({ live: null })
    if (wanted) setTimeout(() => wanted && !socket && connect(wanted), Math.min(30, 2 ** retry++) * 1000)
  }
}

export function leaveLive() {
  wanted = null
  stopLeading()
  socket?.close()
  socket = null
  useViewer.setState({ live: null })
}

export function setFollowing(following: boolean) {
  const live = useViewer.getState().live
  if (!live || live.role !== 'attendee' || live.following === following) return
  useViewer.setState({ live: { ...live, following } })
  send({ type: 'follow', following })
  if (following && last) apply(last)
  else if (!following && useViewer.getState().presenting) useViewer.getState().set({ presenting: false })
}

/** An attendee who walks breaks away from the presenter; F follows again (also while the
 *  mouse is captured for walking, when the bar's button cannot be clicked). */
export function breakAwayOnInput(e: KeyboardEvent): boolean {
  const live = useViewer.getState().live
  if (applying || live?.role !== 'attendee' || !live.presenter) return false
  if (!live.following && e.key.toLowerCase() === 'f') {
    setFollowing(true)
    return true
  }
  if (live.following && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) setFollowing(false)
  return false
}

let timer: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null

function stopLeading() {
  if (timer) clearInterval(timer)
  unsubscribe?.()
  timer = unsubscribe = null
}

/** The presenter's side: send the tour stop on every change, and the walking pose 4 times a second. */
function lead() {
  stopLeading()
  let sent = ''
  const state = (): LiveStatePayload => {
    const s = useViewer.getState()
    return { presenting: s.presenting, index: s.stopIndex, roomId: s.roomId, x: pose.x, z: pose.z, yaw: pose.yaw }
  }
  const push = () => {
    if (useViewer.getState().live?.role !== 'presenter') return
    const st = state()
    const key = st.presenting ? `t${st.index}` : `p${st.roomId}:${st.x.toFixed(2)}:${st.z.toFixed(2)}:${st.yaw.toFixed(2)}`
    if (key !== sent) {
      sent = key
      send({ type: 'state', state: st })
    }
  }
  timer = setInterval(push, 250)
  unsubscribe = useViewer.subscribe((s, prev) => {
    if (s.stopIndex !== prev.stopIndex || s.presenting !== prev.presenting) push()
  })
}
