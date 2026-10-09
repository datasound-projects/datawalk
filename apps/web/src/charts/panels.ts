// Canvas renderings of KPI, table, and text payloads for wall displays.
// The inspector shows the exact values; these are readable summaries.
import { t } from '../i18n'
import type { Payload } from '../state/schema'
import { type Block, type Inline, parseMarkdown } from './markdown'

type Kpi = Extract<Payload, { kind: 'kpi' }>
type Table = Extract<Payload, { kind: 'table' }>

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif'

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, width: number) {
  let size = max
  do ctx.font = `${weight} ${size--}px ${FONT}`
  while (ctx.measureText(text).width > width && size > 12)
}

/** Direction of a change, by sign and arrow (not by color alone). */
export function deltaTone(p: Kpi): 'good' | 'bad' | 'neutral' {
  if (p.delta === null || p.delta === 0) return 'neutral'
  return p.delta > 0 === p.higher_is_better ? 'good' : 'bad'
}
const TONE = { good: '#1a7f37', bad: '#c62828', neutral: '#555' }

export function drawKpi(ctx: CanvasRenderingContext2D, label: string, p: Kpi) {
  const { width: W, height: H } = ctx.canvas
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#444'
  fitFont(ctx, label, 600, 56, W - 80)
  ctx.fillText(label, W / 2, H * 0.17)
  const value = p.unit ? `${p.display} ${p.unit}` : p.display
  ctx.fillStyle = '#111'
  fitFont(ctx, value, 700, 210, W - 80)
  ctx.fillText(value, W / 2, H * 0.5)
  if (p.delta !== null) {
    const tone = deltaTone(p)
    const arrow = p.delta > 0 ? '▲' : p.delta < 0 ? '▼' : '■'
    ctx.fillStyle = TONE[tone]
    fitFont(ctx, `${arrow} ${p.delta_display}`, 600, 64, W - 80)
    ctx.fillText(`${arrow} ${p.delta_display}`, W / 2, H * 0.82)
  }
}

const formatCell = (v: number | string | boolean | null) =>
  v === null ? '' : typeof v === 'number' ? v.toLocaleString(undefined, { maximumSignificantDigits: 6 }) : String(v)

export function drawTable(ctx: CanvasRenderingContext2D, p: Table) {
  const { width: W, height: H } = ctx.canvas
  const pad = 24
  const rowH = 40
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textBaseline = 'middle'
  // Columns that fit at a readable width.
  const minCol = 120
  const nCols = Math.min(p.columns.length, Math.floor((W - 2 * pad) / minCol))
  const colW = (W - 2 * pad) / Math.max(nCols, 1)
  const nRows = Math.min(p.rows.length, Math.floor((H - 2 * pad - rowH * 2) / rowH))
  const numeric = p.columns.map((_, c) => p.rows.slice(0, nRows).every((r) => r[c] === null || typeof r[c] === 'number'))

  const cell = (text: string, c: number, y: number, bold: boolean) => {
    ctx.font = `${bold ? 700 : 400} 24px ${FONT}`
    let t = text
    while (t.length > 1 && ctx.measureText(t).width > colW - 16) t = t.slice(0, -2) + '…'
    const right = numeric[c]
    ctx.textAlign = right ? 'right' : 'left'
    ctx.fillText(t, pad + c * colW + (right ? colW - 8 : 8), y)
  }
  ctx.fillStyle = '#111'
  for (let c = 0; c < nCols; c++) cell(p.columns[c], c, pad + rowH / 2, true)
  ctx.fillRect(pad, pad + rowH, W - 2 * pad, 2)
  for (let r = 0; r < nRows; r++) {
    const y = pad + rowH * (r + 1.5)
    if (r % 2) {
      ctx.fillStyle = '#f2f2f0'
      ctx.fillRect(pad, y - rowH / 2, W - 2 * pad, rowH)
    }
    ctx.fillStyle = '#222'
    for (let c = 0; c < nCols; c++) cell(formatCell(p.rows[r][c]), c, y, false)
  }
  ctx.fillStyle = '#666'
  ctx.textAlign = 'left'
  ctx.font = `400 22px ${FONT}`
  ctx.fillText(
    t('panels.tableFooter', { rows: nRows, total: p.total_rows.toLocaleString(), cols: nCols, totalCols: p.columns.length }),
    pad,
    H - pad,
  )
}

type Text = Extract<Payload, { kind: 'text' }>
type Run = { text: string; font: string; color: string }

const runs = (xs: Inline[], size: number, weight = 400, italic = false, color = '#222'): Run[] =>
  xs.flatMap((x): Run[] => {
    const font = (w: number, it: boolean, family = FONT) => `${it ? 'italic ' : ''}${w} ${size}px ${family}`
    if (x.t === 'text') return [{ text: x.text, font: font(weight, italic), color }]
    if (x.t === 'br') return [{ text: '\n', font: font(weight, italic), color }]
    if (x.t === 'code') return [{ text: x.text, font: font(weight, italic, 'ui-monospace, Menlo, monospace'), color }]
    if (x.t === 'strong') return runs(x.children, size, 700, italic, color)
    if (x.t === 'em') return runs(x.children, size, weight, true, color)
    return runs(x.children, size, weight, italic, '#0b57d0') // links: readable, not clickable on a wall
  })

/** Lay out text panel blocks at one font size; returns the height used (or draws when `draw`). */
function layoutText(ctx: CanvasRenderingContext2D, blocks: Block[], size: number, x0: number, y0: number, width: number, draw: boolean) {
  let y = y0
  const line = (items: { run: Run; word: string }[], indent: number, lineH: number) => {
    let x = x0 + indent
    for (const { run, word } of items) {
      ctx.font = run.font
      if (draw) {
        ctx.fillStyle = run.color
        ctx.fillText(word, x, y + lineH * 0.8)
      }
      x += ctx.measureText(word).width
    }
    y += lineH
  }
  const flow = (rs: Run[], indent: number, lineH: number) => {
    let current: { run: Run; word: string }[] = []
    let used = 0
    for (const run of rs)
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue
        if (part.includes('\n')) {
          line(current, indent, lineH)
          current = []
          used = 0
          continue
        }
        ctx.font = run.font
        const w = ctx.measureText(part).width
        if (used + w > width - indent && current.length && part.trim()) {
          line(current, indent, lineH)
          current = []
          used = 0
        }
        if (!current.length && !part.trim()) continue // no leading spaces
        current.push({ run, word: part })
        used += w
      }
    if (current.length) line(current, indent, lineH)
  }
  for (const b of blocks) {
    if (b.t === 'heading') {
      const s = size * [1.5, 1.3, 1.15][b.level - 1]
      flow(runs(b.children, s, 700, false, '#111'), 0, s * 1.3)
    } else if (b.t === 'paragraph') flow(runs(b.children, size), 0, size * 1.35)
    else
      b.items.forEach((item, i) => {
        const marker = b.ordered ? `${i + 1}.` : '•'
        if (draw) {
          ctx.font = `600 ${size}px ${FONT}`
          ctx.fillStyle = '#444'
          ctx.fillText(marker, x0, y + size * 1.35 * 0.8)
        }
        flow(runs(item, size), size * 1.4, size * 1.35)
      })
    y += size * 0.6 // space between blocks
  }
  return y - y0
}

/** A text panel: title, Markdown body, and the charts it refers to. The largest font that fits. */
export function drawText(ctx: CanvasRenderingContext2D, title: string, p: Text, evidence: string[]) {
  const { width: W, height: H } = ctx.canvas
  const pad = 56
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#7a5410'
  fitFont(ctx, title.toUpperCase(), 700, 34, W - 2 * pad)
  ctx.fillText(title.toUpperCase(), pad, pad + 24)
  const blocks = parseMarkdown(p.markdown)
  if (evidence.length) blocks.push({ t: 'paragraph', children: [{ t: 'em', children: [{ t: 'text', text: `${t('text.evidence')} ${evidence.join(' · ')}` }] }] })
  const top = pad + 64
  let size = 64
  while (size > 16 && layoutText(ctx, blocks, size, pad, top, W - 2 * pad, false) > H - top - pad) size -= 2
  layoutText(ctx, blocks, size, pad, top, W - 2 * pad, true)
}
