// A small Markdown subset for text panels: headings, paragraphs, lists, bold, italic, code,
// links. The output is data, never HTML, so raw HTML in the source shows as text (sanitized
// by construction). Links keep only http(s), mailto, and in-page (#...) targets.

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'strong' | 'em'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'link'; href: string; children: Inline[] }
  | { t: 'br' }

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'paragraph'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }

const SAFE_HREF = /^(https?:\/\/|mailto:|#)/i

export function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  const flush = () => {
    if (text) out.push({ t: 'text', text })
    text = ''
  }
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    let m: RegExpMatchArray | null
    if (rest.startsWith('\\') && i + 1 < src.length && src[i + 1] !== '\n') {
      text += src[i + 1] // escaped character
      i += 2
    } else if ((m = rest.match(/^ {2,}\n|^\\\n|^\n/))) {
      // A single newline is a space; two trailing spaces or a backslash make a line break.
      if (m[0] === '\n') text += ' '
      else {
        flush()
        out.push({ t: 'br' })
      }
      i += m[0].length
    } else if ((m = rest.match(/^`([^`]+)`/))) {
      flush()
      out.push({ t: 'code', text: m[1] })
      i += m[0].length
    } else if ((m = rest.match(/^(\*\*|__)(.+?)\1/s))) {
      flush()
      out.push({ t: 'strong', children: parseInline(m[2]) })
      i += m[0].length
    } else if ((m = rest.match(/^(\*|_)(?=\S)(.+?)(?<=\S)\1/s))) {
      flush()
      out.push({ t: 'em', children: parseInline(m[2]) })
      i += m[0].length
    } else if ((m = rest.match(/^\[([^\]]+)\]\(([^)\s]+)\)/))) {
      flush()
      const children = parseInline(m[1])
      if (SAFE_HREF.test(m[2])) out.push({ t: 'link', href: m[2], children })
      else out.push(...children) // unsafe target (javascript:, data:, ...): keep the text only
      i += m[0].length
    } else {
      text += src[i++]
    }
  }
  flush()
  return out
}

export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const endPara = () => {
    if (para.length) blocks.push({ t: 'paragraph', children: parseInline(para.join('\n')) })
    para = []
  }
  const endList = () => {
    if (list) blocks.push({ t: 'list', ordered: list.ordered, items: list.items.map(parseInline) })
    list = null
  }
  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.*?)\s*#*\s*$/)
    const item = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/)
    if (!line.trim()) {
      endPara()
      endList()
    } else if (heading) {
      endPara()
      endList()
      blocks.push({ t: 'heading', level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) })
    } else if (item) {
      endPara()
      const ordered = /\d/.test(item[1])
      if (list && list.ordered !== ordered) endList()
      list ??= { ordered, items: [] }
      list.items.push(item[2])
    } else if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ' ' + line.trim() // continuation of a list item
    } else {
      endList()
      para.push(line)
    }
  }
  endPara()
  endList()
  return blocks
}

/** Plain text of inline content (alt text, canvas measuring). */
export const inlineText = (xs: Inline[]): string =>
  xs.map((x) => (x.t === 'text' || x.t === 'code' ? x.text : x.t === 'br' ? '\n' : inlineText(x.children))).join('')
