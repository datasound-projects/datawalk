import { t } from '../i18n'
import { type Payload, PayloadSchema, type Report, ReportSchema } from '../state/schema'

// Three data sources, one viewer:
//  - live: the local Python server (api/...)
//  - static site export: files next to index.html (data/...), marked by <meta name="datawalk-data" content="static">
//  - single-file export: everything inline in window.__DATAWALK_DATA__ (no requests at all)
interface InlineData {
  report: unknown
  payloads: Record<string, unknown>
  previews: Record<string, string> // data URLs
  datasets: Record<string, string> // data URLs
  export: ExportInfo
  brand_logo: string | null // data URL
}

/** Stamp of an exported copy: which revision, when, and what the author released. */
export interface ExportInfo {
  revision: number
  exported_at: string
  hash: string
  watermark: string
  levels: Record<string, 'preview' | 'data' | 'datasets'>
}
const inline = (globalThis as { __DATAWALK_DATA__?: InlineData }).__DATAWALK_DATA__
const staticSite =
  typeof document !== 'undefined' && document.querySelector('meta[name="datawalk-data"]')?.getAttribute('content') === 'static'
export const exported = !!inline || staticSite

export const previewUrl = (id: string) =>
  inline ? (inline.previews[id] ?? '') : staticSite ? `data/previews/${id}.png` : `api/visualizations/${id}/preview.png`

export const brandLogoUrl = () => (inline ? (inline.brand_logo ?? '') : staticSite ? 'data/brand/logo.png' : 'api/brand/logo.png')

export const datasetUrl = (id: string) =>
  inline ? (inline.datasets[id] ?? '') : staticSite ? `data/datasets/${id}.csv` : `api/datasets/${id}.csv`

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init)
  if (res.status === 401) throw new SignInRequired('Sign in to open this report.')
  if (!res.ok) {
    const detail: unknown = await res.json().then((b) => b.detail, () => '')
    // FastAPI validation errors are a list: "field: message" for each.
    const text = Array.isArray(detail)
      ? detail.map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join('.')}: ${d.msg}`).join('; ')
      : String(detail ?? '')
    throw new Error(text || `${url}: HTTP ${res.status}`)
  }
  return res.json()
}

/** A report that this viewer cannot read: one short reason, not the whole schema dump. */
function parseReport(data: unknown): Report {
  const result = ReportSchema.safeParse(data)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  throw new Error(t('api.invalidReport', { detail: `${issue.path.join('.')}: ${issue.message}` }))
}

export async function loadReport(): Promise<Report> {
  // Browsers do not let a page opened from disk read the files next to it.
  if (staticSite && location.protocol === 'file:') throw new Error(t('api.siteFromDisk'))
  const data = inline ? inline.report : await getJson(staticSite ? 'data/report.json' : 'api/report')
  const version = (data as { schema_version?: unknown })?.schema_version
  if (typeof version !== 'string' || !version.startsWith('0.3.'))
    throw new Error(t('api.formatMismatch', { version: String(version) }))
  return parseReport(data)
}

export async function loadExportInfo(): Promise<ExportInfo | null> {
  if (inline) return inline.export
  return staticSite ? ((await getJson('data/export.json')) as ExportInfo) : null
}

/** The edit token travels in the URL fragment (#edit=...), which browsers never send to
 *  servers. It is kept for this tab only and removed from the address bar. */
export function takeEditToken(): string | null {
  if (exported) return null
  const key = 'datawalk.edit-token'
  const match = location.hash.match(/edit=([\w-]+)/)
  try {
    if (match) {
      sessionStorage.setItem(key, match[1])
      history.replaceState(null, '', location.pathname + location.search)
    }
    return sessionStorage.getItem(key)
  } catch {
    return match?.[1] ?? null
  }
}

/** Present when a DataWalk Hub serves the report (sign-in, permissions, comments, live). */
export interface HubInfo {
  user: string | null
  role: 'viewer' | 'editor' | 'owner'
  report_id: string
  revision: number
  latest: number
  analytics: boolean // view counts per chart are on: the viewer shows a notice
  classification: string
}

export interface Session {
  editable: boolean
  saves_to: string | null // archive file name; null: edits stay in the Python session only
  hub?: HubInfo
  labels?: string[] // classification labels of the organization's policy (editor only)
  guide?: boolean // the AI guide is on (local server started with --guide)
}

/** The hub answers 401 when a sign-in is necessary. */
export class SignInRequired extends Error {}

export async function loadSession(token: string | null): Promise<Session> {
  if (exported) return { editable: false, saves_to: null }
  const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
  return (await getJson('api/session', { headers })) as Session
}

export async function saveReport(report: Report, token: string): Promise<Report> {
  const body = await getJson('api/report', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })
  return parseReport(body)
}

/** Store a browser-rendered preview (Plotly) on the server, for exports and faster loading. */
export async function uploadPreview(id: string, png: Blob, token: string): Promise<void> {
  const res = await fetch(`api/visualizations/${id}/preview.png`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
    body: png,
  })
  if (!res.ok) throw new Error(`Preview upload failed: HTTP ${res.status}`)
}

const payloads = new Map<string, Promise<Payload>>()

export function loadPayload(id: string): Promise<Payload> {
  let p = payloads.get(id)
  if (!p) {
    p = (inline ? Promise.resolve(inline.payloads[id]) : getJson(staticSite ? `data/payloads/${id}.json` : `api/visualizations/${id}/payload`)).then(
      (d) => PayloadSchema.parse(d),
    )
    p.catch(() => payloads.delete(id))
    payloads.set(id, p)
  }
  return p
}

export interface ExportOptions {
  preview_only: string[] // visualization keys reduced to their preview image
  datasets: boolean
  watermark: string
}

export interface ExportReview {
  rows: { id: string; key: string; name: string; kind: string; level: 'preview' | 'data' | 'datasets'; points: number; bytes: number; datasets: string[] }[]
  total_bytes: number | null
  budget_bytes: number
  error: string | null // the export is not possible with these options
  notes: string[] // what the classification policy changed, previews that DataWalk drew
  has_preview: string[] // keys that can be reduced to a preview image
}

export async function exportReview(options: ExportOptions, token: string): Promise<ExportReview> {
  return (await getJson('api/export/review', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })) as ExportReview
}

/** The single-file HTML export, after the author confirmed the review of these options. */
export async function exportHtml(options: ExportOptions, token: string): Promise<Blob> {
  const res = await fetch('api/export/html', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...options, confirmed: true }),
  })
  if (!res.ok) throw new Error((await res.json().then((b) => b.detail, () => '')) || t('api.exportFailed', { status: res.status }))
  return res.blob()
}

// -- hub ---------------------------------------------------------------------------------

export interface Comment {
  id: number
  key: string
  parent: number | null
  author: string
  body: string
  kind: 'comment' | 'question'
  created_at: number
  resolved: boolean
}

export const loadComments = async () => (await getJson('api/comments')) as Comment[]

export async function postComment(key: string, body: string, kind: Comment['kind'] = 'comment', parent: number | null = null) {
  await getJson('api/comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, body, kind, parent }),
  })
}

export async function resolveComment(id: number, resolved: boolean) {
  await getJson(`api/comments/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolved }) })
}

/** View analytics (only when the hub admin turned them on; counts per chart, no person). */
export function countView(key: string) {
  fetch('api/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }).catch(() => {})
}
