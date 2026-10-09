import { describe, expect, it } from 'vitest'
import { inlineText, parseInline, parseMarkdown } from './markdown'

describe('markdown subset', () => {
  it('parses headings, paragraphs and lists', () => {
    const blocks = parseMarkdown('# Agenda\n\nFirst line\ncontinues.\n\n- one\n- **two**\n\n1. a\n2. b')
    expect(blocks.map((b) => b.t)).toEqual(['heading', 'paragraph', 'list', 'list'])
    expect(blocks[1]).toEqual({ t: 'paragraph', children: [{ t: 'text', text: 'First line continues.' }] })
    expect(blocks[2]).toMatchObject({ ordered: false, items: [[{ t: 'text', text: 'one' }], [{ t: 'strong' }]] })
    expect(blocks[3]).toMatchObject({ ordered: true })
  })

  it('never interprets HTML and drops unsafe link targets', () => {
    const xs = parseInline('<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://example.org)')
    expect(xs[0]).toEqual({ t: 'text', text: '<img src=x onerror=alert(1)> ' })
    expect(xs.some((x) => x.t === 'link' && x.href.startsWith('javascript'))).toBe(false)
    expect(xs.at(-1)).toEqual({ t: 'link', href: 'https://example.org', children: [{ t: 'text', text: 'ok' }] })
  })

  it('keeps hard line breaks, code and emphasis', () => {
    const xs = parseInline('**Author:** A  \n*Date:* `2026`')
    expect(xs.map((x) => x.t)).toEqual(['strong', 'text', 'br', 'em', 'text', 'code'])
    expect(inlineText(xs)).toBe('Author: A\nDate: 2026')
  })
})
