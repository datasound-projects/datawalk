// Brand colors on the dark interface: readable text needs a 4.5:1 contrast (WCAG 2.2 AA).

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
const BACKGROUND = luminance([0x0f, 0x10, 0x12]) // --bg

/** The brand color, lightened (same hue) until links, focus rings, and accent text in it are
 *  readable on the dark background. Buttons keep their dark text on it. */
export function readableAccent(hex: string): string {
  let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  for (let i = 0; i < 40 && (luminance(rgb) + 0.05) / (BACKGROUND + 0.05) < 4.5; i++)
    rgb = rgb.map((c) => Math.round(c + (255 - c) * 0.1))
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')
}

export const contrast = (a: string, b: string) => {
  const [la, lb] = [a, b].map((h) => luminance([1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
