import { lazy, Suspense, useEffect, useState } from 'react'
import { arrange, currentRoomLayout, moveBy, resizeBy, select, toNextWall } from '../editor/arrangeOps'
import { ArrangeToolbar, exitArrange } from '../editor/ArrangeToolbar'
import { EditorPanel } from '../editor/EditorPanel'
import { ThemePreviewBar } from '../editor/ThemePreviewBar'
import { canvas, consumeDragged, typing, unlockPointer } from '../navigation/input'
import { canEdit, isDirty, useViewer, useViewerPick } from '../state/store'
import { FlatView } from '../viewer/FlatView'
import { Inspector } from '../viewer/Inspector'
import { MapOverlay } from '../viewer/MapOverlay'
import { Classification, Hud, Lobby, Navigator } from '../viewer/Overlays'
import { THEMES } from '../state/schema'
import type { ThemeId } from '../themes/themes'
import { PresenterView } from '../tour/PresenterView'
import { activeStops, connectMain, inspectStop, next, openPresenter, prev, startTour, stopTour, goTo } from '../tour/tour'
import { TourHud } from '../tour/TourHud'
import { breakAwayOnInput, joinLive } from '../hub/live'
import { HubBar, SignIn } from '../hub/HubUI'
import { t } from '../i18n'
import { countView, loadExportInfo, loadReport, loadSession, SignInRequired, takeEditToken } from './api'
import { readableAccent } from './contrast'

// `vite build --mode viewer`: the bundle for exports. The editor is left out (tree-shaken).
const VIEWER_ONLY = import.meta.env.MODE === 'viewer'
// The AI guide needs the local server: no export build contains it (not even as a chunk).
const GuideDock = import.meta.env.MODE.startsWith('viewer') ? null : lazy(() => import('../guide/GuideDock').then((m) => ({ default: m.GuideDock })))

// The 3D scene (three.js, Rapier, drei) is a separate chunk: overlays and the inspector load first.
const RoomScene = lazy(() => import('../scenes/RoomScene').then((m) => ({ default: m.RoomScene })))

async function start() {
  const token = takeEditToken()
  const [report, session, exportInfo] = await Promise.all([loadReport(), loadSession(token), loadExportInfo()])
  useViewer.getState().load(report, session.editable && !VIEWER_ONLY ? token : null, session.saves_to)
  useViewer.setState({ exportInfo, hub: session.hub ?? null, labels: session.labels ?? [], guide: !!session.guide })
  // A customer brand's accent color for buttons and links, readable on the dark interface
  // (on screen; print keeps its own dark accent for white paper).
  if (report.brand?.accent) {
    const style = document.createElement('style')
    style.textContent = `@media screen { :root { --accent: ${readableAccent(report.brand.accent)}; } }`
    document.head.append(style)
  }
  if (report.classification) document.title = `[${report.classification}] ${report.name}`
  openDeepLink()
  const params = new URLSearchParams(location.search)
  if (params.has('presenter') || params.has('export')) return // no 3D scene, no tour
  connectMain(report.id)
  if (session.hub) {
    joinLive('attendee') // follow when someone presents live
    // View analytics, when the hub admin turned them on: one count per inspected chart.
    useViewer.subscribe((s, prev) => {
      const v = s.inspectId !== prev.inspectId && s.report?.visualizations.find((x) => x.id === s.inspectId)
      if (v && s.hub?.analytics) countView(v.key)
    })
  }
  // ?present starts the guided tour; ?kiosk auto-plays it in a loop.
  if (params.has('kiosk')) startTour(0, true)
  else if (params.has('present')) startTour(0)
  // ?shot=<theme>: a clean view of the first room in that theme (theme thumbnails, docs).
  const shot = new URLSearchParams(location.search).get('shot')
  if (shot && (THEMES as readonly string[]).includes(shot)) {
    document.body.classList.add('shot')
    useViewer.getState().set({ previewTheme: { roomId: null, theme: shot as ThemeId }, quality: 'high', flat: false })
    useViewer.getState().setOverlay(null)
  }
}

/** #room-<key> and #viz-<key> open that room (and, in 3D, inspect that chart). */
function openDeepLink() {
  const { report, flat, enterRoom, inspect } = useViewer.getState()
  const m = location.hash.match(/^#(room|viz)-(.+)$/)
  if (!report || !m) return
  const key = decodeURIComponent(m[2])
  const viz = m[1] === 'viz' ? report.visualizations.find((v) => v.key === key) : undefined
  const room = viz
    ? report.rooms.find((r) => r.items.includes(viz.id) || report.dashboards.some((d) => r.items.includes(d.id) && d.items.includes(viz.id)))
    : report.rooms.find((r) => (r.key ?? r.id) === key)
  if (room) enterRoom(room.id)
  if (viz && room && !flat) inspect(viz.id)
}

const PRESENTER = new URLSearchParams(location.search).has('presenter')
const EXPORTING = new URLSearchParams(location.search).has('export') // Python drives exportHooks

export function App() {
  const { report, roomId, overlay, inspectId, arranging, flat, presenting, screenShare, roomLoading, guide } = useViewerPick('report', 'roomId', 'overlay', 'inspectId', 'arranging', 'flat', 'presenting', 'screenShare', 'roomLoading', 'guide')
  useEffect(() => void document.body.classList.toggle('screen-share', screenShare), [screenShare])
  const [error, setError] = useState<string | null>(null)
  const [signIn, setSignIn] = useState(false)

  useEffect(() => {
    start().catch((e) => (e instanceof SignInRequired ? setSignIn(true) : setError(String(e))))
  }, [])
  // Any overlay, and arrange mode, needs a free pointer, however it was opened.
  useEffect(() => useViewer.subscribe((s) => (s.overlay !== null || s.arranging) && unlockPointer()), [])
  useActionKeys()
  useUnsavedWarning()

  if (signIn) return <SignIn />
  if (error)
    return (
      <div className="overlay lobby">
        <div className="card">
          <h1>{t('app.cannotOpen')}</h1>
          <p>{error}</p>
        </div>
      </div>
    )
  if (!report)
    return (
      <div className="overlay lobby">
        <p className="muted">{t('app.loadingReport')}</p>
      </div>
    )

  const room = report.rooms.find((r) => r.id === roomId)
  const viz = report.visualizations.find((v) => v.id === inspectId)
  if (PRESENTER)
    return (
      <>
        <PresenterView report={report} />
        <Classification report={report} />
      </>
    )
  if (EXPORTING) return <p className="muted">{t('app.exporting')}</p>
  // One place in the tree for both views: switching flat <-> 3D (an answer can do that) must
  // not remount the guide, which would end what it says. The editor hides it.
  const dock = GuideDock && guide && (
    <Suspense fallback={null}>
      <GuideDock report={report} hidden={overlay === 'editor'} />
    </Suspense>
  )
  const view = flat ? (
    <>
      <FlatView report={report} />
      {overlay === 'inspector' && viz && <Inspector key={viz.id} viz={viz} />}
      <Classification report={report} />
      <Watermark />
    </>
  ) : (
    <>
      <div id="scene">
        <Suspense fallback={<p className="scene-loading muted">{t('app.loadingRoom')}</p>}>{room && <RoomScene report={report} room={room} />}</Suspense>
      </div>
      <div key={roomId} className="fade" aria-hidden />
      {roomLoading && overlay === null && <p className="scene-loading muted">{t('app.loadingRoom')}</p>}
      {presenting ? <TourHud report={report} /> : <Hud report={report} />}
      {(overlay === null || overlay === 'lobby') && <HubBar />}
      <Classification report={report} />
      {!VIEWER_ONLY && arranging && <ArrangeToolbar report={report} />}
      {!VIEWER_ONLY && <ThemePreviewBar report={report} />}
      {overlay === 'lobby' && <Lobby report={report} />}
      {overlay === 'navigator' && <Navigator report={report} />}
      {overlay === 'map' && room && <MapOverlay report={report} room={room} />}
      {overlay === 'inspector' && viz && <Inspector key={viz.id} viz={viz} />}
      {!VIEWER_ONLY && overlay === 'editor' && <EditorPanel report={report} />}
      <Watermark />
    </>
  )
  return (
    <>
      {view}
      {dock}
    </>
  )
}

/** Recipient watermark of an exported copy: on top of every view, and in print. */
function Watermark() {
  const text = useViewer((s) => s.exportInfo?.watermark)
  if (!text) return null
  return (
    <div className="watermark" aria-hidden>
      {Array.from({ length: 24 }, (_, i) => (
        <span key={i}>{text}</span>
      ))}
    </div>
  )
}


/** One-shot actions: E / click inspect, M map, Tab navigator, Esc back out, Ctrl+Z undo. */
function useActionKeys() {
  useEffect(() => {
    const inspectFocused = () => {
      const { overlay, arranging, focusedId, inspect } = useViewer.getState()
      if (overlay !== null || arranging || !focusedId) return
      inspect(focusedId)
      unlockPointer()
    }
    const toggle = (o: 'navigator' | 'map') => {
      const s = useViewer.getState()
      if (s.overlay === o) s.setOverlay('lobby')
      else if ((s.overlay === null && !s.arranging) || s.overlay === 'lobby' || s.overlay === 'map' || s.overlay === 'navigator') {
        s.setOverlay(o)
        unlockPointer()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      const s = useViewer.getState()
      if (s.flat) {
        // A document: Tab, arrows and Space keep their browser meaning.
        if (e.code === 'Escape' && s.overlay === 'inspector') {
          const key = s.report?.visualizations.find((v) => v.id === s.inspectId)?.key
          s.setOverlay(null)
          document.getElementById(`viz-${key}`)?.focus() // back where the reader was
        }
        return
      }
      if (!typing(e) && breakAwayOnInput(e)) return // walking leaves the presenter; F follows again
      const live = s.live
      if (!typing(e) && live?.role === 'attendee' && live.following && live.presenter && ['PageDown', 'PageUp', 'Space', 'Home', 'End'].includes(e.code)) {
        e.preventDefault() // the presenter drives
        return
      }
      if (tourKey(e)) {
        e.preventDefault()
        return
      }
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase() // letters by character (any keyboard layout); walking keys by position
      if (mod && key === 'z' && canEdit(s) && !typing(e)) {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
      } else if (mod && key === 'y' && canEdit(s) && !typing(e)) {
        e.preventDefault()
        s.redo()
      } else if (typing(e) || mod) {
        return
      } else if (s.arranging && arrangeKey(e)) {
        e.preventDefault()
      } else if (key === 'e' && !e.repeat) inspectFocused()
      else if (key === 'm') toggle('map')
      else if (e.code === 'Tab' && s.overlay === null && !s.arranging) {
        // While walking, Tab opens the rooms list; in a dialog, Tab moves the focus.
        e.preventDefault()
        toggle('navigator')
      } else if (e.code === 'Escape') {
        if (s.arranging) exitArrange()
        // While pointer-locked the browser consumes Esc and the unlock handler pauses.
        else if (s.overlay !== 'lobby') s.setOverlay('lobby')
      }
    }
    const onClick = (e: MouseEvent) => {
      if (useViewer.getState().flat || consumeDragged()) return
      if (e.button === 0 && e.target === canvas()) inspectFocused()
    }
    addEventListener('keydown', onKey)
    addEventListener('click', onClick)
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('click', onClick)
    }
  }, [])
}

function useUnsavedWarning() {
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (isDirty(useViewer.getState())) e.preventDefault()
    }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [])
}

/** Presentation keys. Clickers send Page Up / Page Down: they start the tour from the lobby. */
function tourKey(e: KeyboardEvent): boolean {
  const s = useViewer.getState()
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return false
  const forward = ['ArrowRight', 'Space', 'PageDown'].includes(e.code)
  const back = ['ArrowLeft', 'PageUp'].includes(e.code)
  if (!s.presenting) {
    // Page Down in the lobby starts the tour: a clicker is enough to present.
    if (s.overlay === 'lobby' && !s.arranging && e.code === 'PageDown' && s.report && activeStops(s.report).length) {
      startTour(0)
      return true
    }
    return false
  }
  if (s.overlay === 'inspector' && e.code === 'Escape') s.setOverlay(null)
  else if (forward) next()
  else if (back) prev()
  else if (e.code === 'Home') goTo(0)
  else if (e.code === 'End') goTo(Number.MAX_SAFE_INTEGER)
  else if ((e.key.toLowerCase() === 'e' || e.code === 'Enter') && !e.repeat) {
    if (s.overlay === 'inspector') s.setOverlay(null)
    else inspectStop()
  } else if (e.key.toLowerCase() === 'p') openPresenter()
  else if (e.code === 'Escape') stopTour()
  else return ['ArrowUp', 'ArrowDown', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code) || e.key.toLowerCase() === 'm' // no walking, no map
  return true
}

/** Arrange-mode keys: [ ] select, Alt+arrows move, - = size, . next wall. */
function arrangeKey(e: KeyboardEvent): boolean {
  const far = e.shiftKey ? 5 : 1
  const id = useViewer.getState().selectedId
  const floor = !!id && !!currentRoomLayout()?.exhibits.some((x) => x.id === id) // exhibits move on the floor
  const step = (floor ? 0.25 : 0.1) * far
  const moves: Record<string, [number, number]> = floor
    ? { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    : { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
  if (e.altKey && moves[e.code]) arrange((l, i) => moveBy(l, i, ...moves[e.code]))
  else if (e.key === ']') select(1)
  else if (e.key === '[') select(-1)
  else if (e.key === '=' || e.key === '+') arrange((l, i) => resizeBy(l, i, 1.1))
  else if (e.key === '-') arrange((l, i) => resizeBy(l, i, 1 / 1.1))
  else if (e.key === '.') arrange(toNextWall)
  else return false
  return true
}
