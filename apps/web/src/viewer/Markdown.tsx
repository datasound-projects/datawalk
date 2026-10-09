import type { ReactNode } from 'react'
import { type Block, type Inline, parseMarkdown } from '../charts/markdown'

function inline(xs: Inline[]): ReactNode[] {
  return xs.map((x, i) => {
    switch (x.t) {
      case 'text':
        return x.text
      case 'br':
        return <br key={i} />
      case 'code':
        return <code key={i}>{x.text}</code>
      case 'strong':
        return <strong key={i}>{inline(x.children)}</strong>
      case 'em':
        return <em key={i}>{inline(x.children)}</em>
      case 'link':
        return x.href.startsWith('#') ? (
          <a key={i} href={x.href}>
            {inline(x.children)}
          </a>
        ) : (
          <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">
            {inline(x.children)}
          </a>
        )
    }
  })
}

function block(b: Block, i: number, base: number) {
  if (b.t === 'paragraph') return <p key={i}>{inline(b.children)}</p>
  if (b.t === 'list') {
    const L = b.ordered ? 'ol' : 'ul'
    return (
      <L key={i}>
        {b.items.map((item, j) => (
          <li key={j}>{inline(item)}</li>
        ))}
      </L>
    )
  }
  // Markdown headings sit below the heading of the panel that shows them.
  const H = `h${Math.min(6, base + b.level)}` as 'h3'
  return <H key={i}>{inline(b.children)}</H>
}

/** Sanitized Markdown: the parser yields data, React renders it as text and elements. */
export function Markdown({ source, headingBase = 2 }: { source: string; headingBase?: number }) {
  return <div className="markdown">{parseMarkdown(source).map((b, i) => block(b, i, headingBase))}</div>
}
