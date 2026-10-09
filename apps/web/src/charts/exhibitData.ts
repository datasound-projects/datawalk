// Converts Plotly 3D traces (scatter3d, surface) into normalized geometry for an in-room exhibit.
// Plot axes map to the scene as x -> x, z -> up, y -> away from the viewer.
import { t as tr } from '../i18n'
import { numeric } from './decode'

export type FigureJson = { data: unknown[]; layout?: unknown }

export const EXHIBIT_SIZE = 1.1 // meters: edge of the data cube
const MAX_POINTS = 300_000
const DEFAULT_COLORWAY = ['#636efa', '#EF553B', '#00cc96', '#ab63fa', '#FFA15A', '#19d3f3', '#FF6692', '#B6E880', '#FF97FF', '#FECB52']
const VIRIDIS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725']

export interface AxisInfo {
  label: string
  min: number // in data units
  max: number
  log: boolean
}

export interface ExhibitData {
  kind: 'points' | 'surface'
  positions: Float32Array // scene coordinates, centered on the cube
  colors: Float32Array // linear RGB per vertex
  index?: Uint32Array // surface triangles
  axes: [AxisInfo, AxisInfo, AxisInfo]
  describe: (i: number) => string // point readout in original units
}

type Trace = Record<string, unknown>
type Rgb = [number, number, number]

/** CSS color (hex, rgb(), rgba()) to linear RGB, without a DOM. */
export function parseColor(c: string): Rgb | null {
  let r: number, g: number, b: number
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  const rgb = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((x) => x + x).join('') : hex[1]
    ;[r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  } else if (rgb) [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number)
  else return null
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return [lin(r), lin(g), lin(b)]
}

function viridis(t: number): Rgb {
  const x = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1) * (VIRIDIS.length - 1)
  const i = Math.min(Math.floor(x), VIRIDIS.length - 2)
  const [a, b] = [parseColor(VIRIDIS[i])!, parseColor(VIRIDIS[i + 1])!]
  return a.map((v, k) => v + (b[k] - v) * (x - i)) as Rgb
}

function range(values: Float64Array[], log: boolean): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const arr of values)
    for (const v of arr) {
      const t = log ? Math.log10(v) : v
      if (Number.isFinite(t)) {
        lo = Math.min(lo, t)
        hi = Math.max(hi, t)
      }
    }
  return lo <= hi ? [lo, hi] : [0, 0]
}

const fmt = (v: number) => String(+v.toPrecision(6)) // 6 significant digits, no trailing zeros

export function buildExhibit(fig: FigureJson, labels: [string, string, string]): ExhibitData | null {
  const traces = fig.data as Trace[]
  const scene = ((fig.layout as Record<string, unknown> | undefined)?.scene ?? {}) as Record<string, { type?: string }>
  const log = (['xaxis', 'yaxis', 'zaxis'] as const).map((k) => scene[k]?.type === 'log') as [boolean, boolean, boolean]
  const S = EXHIBIT_SIZE
  const layout = fig.layout as
    | { colorway?: string[]; template?: { layout?: { colorway?: string[] } }; legend?: { title?: { text?: string } } }
    | undefined
  // Plotly Express names traces by group value; the legend title names the grouping variable.
  const group = layout?.legend?.title?.text?.replace(/<[^>]*>/g, '').trim()
  const colorway = layout?.colorway ?? layout?.template?.layout?.colorway ?? DEFAULT_COLORWAY

  const surface = traces.find((t) => t.type === 'surface')
  const points = traces.filter((t) => t.type === 'scatter3d')
  if (surface) return buildSurface(surface, labels, log, S)
  if (!points.length || points.length !== traces.length) return null

  const cols: Float64Array[][] = [[], [], []]
  for (const t of points) {
    const xyz = [numeric(t.x), numeric(t.y), numeric(t.z)]
    if (xyz.some((a) => !a) || xyz[0]!.length !== xyz[1]!.length || xyz[1]!.length !== xyz[2]!.length) return null
    xyz.forEach((a, k) => cols[k].push(a!))
  }
  const total = cols[0].reduce((n, a) => n + a.length, 0)
  if (total > MAX_POINTS) return null

  const ranges = cols.map((c, k) => range(c, log[k]))
  const norm = (v: number, k: number) => {
    const [lo, hi] = ranges[k]
    const t = log[k] ? Math.log10(v) : v
    return hi > lo ? ((t - lo) / (hi - lo) - 0.5) * S : 0
  }
  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const owner: { name: string; start: number; trace: number }[] = []
  let i = 0
  points.forEach((t, ti) => {
    const name = String(t.name ?? tr('exhibit.trace', { n: ti + 1 }))
    owner.push({ name: group ? `${group} = ${name}` : name, start: i, trace: ti })
    const marker = (t.marker ?? {}) as { color?: unknown }
    const single = typeof marker.color === 'string' ? parseColor(marker.color) : null
    const scale = numeric(marker.color)
    const [cLo, cHi] = scale ? range([scale], false) : [0, 1]
    const base = single ?? parseColor(colorway[ti % colorway.length]) ?? [0.4, 0.4, 0.9]
    for (let j = 0; j < cols[0][ti].length; j++, i++) {
      const [x, y, z] = [cols[0][ti][j], cols[1][ti][j], cols[2][ti][j]]
      positions.set([norm(x, 0), norm(z, 2), -norm(y, 1)], i * 3)
      const c = scale ? viridis((scale[j] - cLo) / (cHi - cLo || 1)) : base
      colors.set(c, i * 3)
    }
  })
  const axes = ranges.map(([lo, hi], k) => ({
    label: labels[k],
    min: log[k] ? 10 ** lo : lo,
    max: log[k] ? 10 ** hi : hi,
    log: log[k],
  })) as ExhibitData['axes']
  return {
    kind: 'points',
    positions,
    colors,
    axes,
    describe: (idx) => {
      const o = [...owner].reverse().find((x) => x.start <= idx)!
      const j = idx - o.start
      const v = [0, 1, 2].map((k) => `${labels[k]} = ${fmt(cols[k][o.trace][j])}`)
      return `${o.name} · ${v.join(', ')}`
    },
  }
}

function buildSurface(t: Trace, labels: [string, string, string], log: [boolean, boolean, boolean], S: number) {
  const z = numeric(t.z)
  const shape = z && Array.isArray(t.z) ? [(t.z as unknown[]).length, ((t.z as unknown[][])[0] ?? []).length] : null
  const dims = shape ?? (t.z as { shape?: string })?.shape?.split(',').map(Number)
  if (!z || !dims || dims.length !== 2) return null
  const [rows, cols] = dims
  if (rows * cols > MAX_POINTS) return null // too large for the room: the inspector shows it
  const xs = t.x === undefined ? Float64Array.from({ length: cols }, (_, i) => i) : numeric(t.x)
  const ys = t.y === undefined ? Float64Array.from({ length: rows }, (_, i) => i) : numeric(t.y)
  if (!xs || !ys) return null
  const x2 = xs.length === rows * cols
  const y2 = ys.length === rows * cols
  if ((!x2 && xs.length !== cols) || (!y2 && ys.length !== rows)) return null
  const X = (r: number, c: number) => (x2 ? xs[r * cols + c] : xs[c])
  const Y = (r: number, c: number) => (y2 ? ys[r * cols + c] : ys[r])

  const ranges = [range([xs], log[0]), range([ys], log[1]), range([z], log[2])]
  const norm = (v: number, k: number) => {
    const [lo, hi] = ranges[k]
    const t2 = log[k] ? Math.log10(v) : v
    return hi > lo ? ((t2 - lo) / (hi - lo) - 0.5) * S : 0
  }
  const positions = new Float32Array(rows * cols * 3)
  const colors = new Float32Array(rows * cols * 3)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      positions.set([norm(X(r, c), 0), norm(z[i], 2), -norm(Y(r, c), 1)], i * 3)
      colors.set(viridis(norm(z[i], 2) / S + 0.5), i * 3)
    }
  const tris: number[] = []
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const [a, b, d, e] = [r * cols + c, r * cols + c + 1, (r + 1) * cols + c, (r + 1) * cols + c + 1]
      if ([a, b, d, e].every((k) => Number.isFinite(z[k]))) tris.push(a, d, b, b, d, e) // skip gaps (NaN)
    }
  const axes = ranges.map(([lo, hi], k) => ({
    label: labels[k],
    min: log[k] ? 10 ** lo : lo,
    max: log[k] ? 10 ** hi : hi,
    log: log[k],
  })) as ExhibitData['axes']
  return {
    kind: 'surface' as const,
    positions,
    colors,
    index: Uint32Array.from(tris),
    axes,
    describe: (i: number) => {
      const r = Math.floor(i / cols)
      const c = i % cols
      return `${labels[0]} = ${fmt(X(r, c))}, ${labels[1]} = ${fmt(Y(r, c))}, ${labels[2]} = ${fmt(z[i])}`
    },
  }
}
