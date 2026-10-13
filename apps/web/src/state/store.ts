import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { type ExportInfo, type HubInfo, saveReport } from '../app/api'
import { detectGpu, type GpuInfo, type Quality } from '../app/quality'
import { locale } from '../i18n'
import type { ThemeId } from '../themes/themes'
import type { Placement, Report, Room, TourStop } from './schema'

// null = walking in the room; any other value shows a DOM overlay.
export type Overlay = 'lobby' | 'navigator' | 'inspector' | 'map' | 'editor' | null

/** A placement being dragged in arrange mode; committed on release when valid. */
export interface DragPreview {
  id: string
  placement: Placement
  valid: boolean
  guides: { y?: number; a?: number } // snapped alignment lines (height, along-wall position)
}

const HISTORY = 100

interface ViewerState {
  report: Report | null // what the viewer shows, including unsaved edits
  saved: Report | null // the last version that the server confirmed
  past: Report[]
  future: Report[]
  editToken: string | null // present only in an authorized editing session
  savesTo: string | null // archive that the server writes on save
  preview: boolean // stakeholder preview: hide all editing UI
  arranging: boolean
  selectedId: string | null // display selected in arrange mode
  drag: DragPreview | null
  arrangeMessage: string | null // why the last keyboard arrange step was not possible
  editorTab: string
  saving: boolean
  saveError: string | null

  roomId: string | null
  arrivedFrom: string | null // room the visitor came from, to spawn at the matching door
  focusedId: string | null // visualization under the crosshair
  pointInfo: string | null // 3D exhibit point under the crosshair
  roomLoading: boolean // the room's theme assets are still downloading
  inspectId: string | null
  overlay: Overlay
  started: boolean // the visitor has entered a room at least once
  speed: number // m/s
  sensitivity: number
  gpu: GpuInfo
  quality: Quality
  // Theme picker preview: shown, not saved. roomId null previews the report default.
  previewTheme: { roomId: string | null; theme: ThemeId } | null
  exportInfo: ExportInfo | null // set in exported copies (static site, single HTML file)
  flat: boolean // flat (2D document) view instead of the 3D rooms
  presenting: boolean // guided tour: the camera moves from stop to stop
  stopIndex: number
  kiosk: boolean // auto-play: advance by stop duration, loop
  guideTour: TourStop[] | null // the AI guide's plan while it presents; null: the report's tour
  tourArrived: string | null // the tour stop where the camera came to rest (event for the AI guide)
  guide: boolean // the server offers the AI guide (opt-in: --guide)
  hub: HubInfo | null // a DataWalk Hub serves this report
  screenShare: boolean // video calls: slower glides, larger text, fewer hints
  labels: string[] // classification labels that the editor offers
  live: LiveState | null // live follow over the hub
  lang: string // UI language (i18n); in the store so that a change re-renders the UI

  load: (report: Report, editToken: string | null, savesTo: string | null) => void
  edit: (change: (draft: Report) => void) => void
  undo: () => void
  redo: () => void
  save: () => Promise<void>
  enterRoom: (roomId: string, from?: string | null) => void
  focus: (id: string | null) => void
  setPointInfo: (info: string | null) => void
  inspect: (id: string) => void
  setOverlay: (overlay: Overlay) => void
  set: (
    s: Partial<Pick<ViewerState, 'speed' | 'sensitivity' | 'preview' | 'arranging' | 'selectedId' | 'drag' | 'quality' | 'previewTheme' | 'arrangeMessage' | 'editorTab' | 'flat' | 'presenting' | 'stopIndex' | 'kiosk' | 'guideTour' | 'screenShare' | 'lang'>>,
  ) => void
}

const VIEW_KEY = 'datawalk.view'

/** The current room, or the first room when an edit, undo, or redo removed it. */
const roomIn = (report: Report, roomId: string | null) =>
  report.rooms.some((r) => r.id === roomId) ? roomId : (report.rooms[0]?.id ?? null)

/** A phone or tablet without a mouse: walking needs a keyboard, so the flat view comes first. */
export const touchOnly = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches

/** Flat view without WebGL, on software rendering, and on touch screens, unless ?view= or the
 *  visitor chose. */
function initialFlat(gpu: GpuInfo): boolean {
  if (!gpu.webgl) return true
  const param = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('view')
  if (param === 'flat' || param === '3d') return param === 'flat'
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    if (saved) return saved === 'flat'
  } catch {
    /* storage unavailable */
  }
  return gpu.software || touchOnly()
}

/** Switch between the 3D rooms and the flat view, and remember the choice. */
export function setFlat(flat: boolean) {
  try {
    localStorage.setItem(VIEW_KEY, flat ? 'flat' : '3d')
  } catch {
    /* storage unavailable */
  }
  const s = useViewer.getState()
  s.set({ flat })
  s.setOverlay(flat ? null : 'lobby') // 3D starts from the lobby: entering needs a click for mouse look
}

export interface LiveState {
  role: 'presenter' | 'attendee'
  presenter: string | null // who presents (attendees)
  following: boolean
  followers: { name: string; following: boolean }[] // who follows (presenter)
}

export const canEdit = (s: Pick<ViewerState, 'editToken' | 'preview'>) => s.editToken !== null && !s.preview
export const isDirty = (s: Pick<ViewerState, 'report' | 'saved'>) =>
  s.report !== s.saved && JSON.stringify(s.report) !== JSON.stringify(s.saved)

export const useViewer = create<ViewerState>()((set, get) => ({
  roomLoading: false,
  report: null,
  saved: null,
  past: [],
  future: [],
  editToken: null,
  savesTo: null,
  preview: false,
  arranging: false,
  selectedId: null,
  drag: null,
  arrangeMessage: null,
  editorTab: 'rooms',
  saving: false,
  saveError: null,
  roomId: null,
  arrivedFrom: null,
  focusedId: null,
  pointInfo: null,
  inspectId: null,
  overlay: 'lobby',
  started: false,
  speed: 2.2,
  sensitivity: 1,
  ...(() => {
    const gpu = detectGpu()
    return { gpu, quality: gpu.tier, flat: initialFlat(gpu) }
  })(),
  previewTheme: null,
  exportInfo: null,
  presenting: false,
  stopIndex: 0,
  kiosk: false,
  guideTour: null,
  tourArrived: null,
  guide: false,
  hub: null,
  live: null,
  labels: [],
  lang: locale(),
  screenShare: (() => {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('screenshare')) return true
    try {
      return localStorage.getItem('datawalk.screenshare') === '1'
    } catch {
      return false
    }
  })(),

  load: (report, editToken, savesTo) =>
    set({ report, saved: report, editToken, savesTo, roomId: report.rooms[0]?.id ?? null }),

  edit: (change) => {
    const { report, past } = get()
    if (!report) return
    const draft = structuredClone(report)
    change(draft)
    set({ report: draft, past: [...past.slice(1 - HISTORY), report], future: [], roomId: roomIn(draft, get().roomId), saveError: null })
  },
  undo: () => {
    const { report, past, future, roomId } = get()
    if (!report || !past.length) return
    const previous = past[past.length - 1]
    set({ report: previous, past: past.slice(0, -1), future: [report, ...future], roomId: roomIn(previous, roomId) })
  },
  redo: () => {
    const { report, past, future, roomId } = get()
    if (!report || !future.length) return
    set({ report: future[0], past: [...past, report], future: future.slice(1), roomId: roomIn(future[0], roomId) })
  },
  save: async () => {
    const { report, editToken } = get()
    if (!report || !editToken) return
    set({ saving: true, saveError: null })
    try {
      const saved = await saveReport(report, editToken)
      // The server bumps the revision; history entries must carry it to stay saveable.
      const bump = (r: Report) => ({ ...r, revision: saved.revision })
      set((s) => ({
        saved,
        report: s.report === report ? saved : bump(s.report!), // keep edits made while saving
        past: s.past.map(bump),
        future: s.future.map(bump),
        saving: false,
      }))
    } catch (e) {
      set({ saving: false, saveError: String(e instanceof Error ? e.message : e) })
    }
  },

  enterRoom: (roomId, from = null) => set({ roomId, arrivedFrom: from, focusedId: null, pointInfo: null, selectedId: null }),
  focus: (focusedId) => set({ focusedId }),
  setPointInfo: (pointInfo) => set({ pointInfo }),
  inspect: (inspectId) => set({ inspectId, overlay: 'inspector' }),
  setOverlay: (overlay) => set(overlay === null ? { overlay, started: true } : { overlay }),
  set: (s) => set(s),
}))

/** Only these fields: the component re-renders when one of them changes (not on every
 *  crosshair move while walking). */
export const useViewerPick = <K extends keyof ViewerState>(...keys: K[]): Pick<ViewerState, K> =>
  useViewer(useShallow((s) => Object.fromEntries(keys.map((k) => [k, s[k]])) as Pick<ViewerState, K>))

/** The theme a room shows: a picker preview, else the room's own theme, else the report default. */
export function roomTheme(report: Report, room: Room, preview: ViewerState['previewTheme']): ThemeId {
  if (preview && (preview.roomId === room.id || (preview.roomId === null && room.theme === null))) return preview.theme
  return room.theme ?? report.theme
}
