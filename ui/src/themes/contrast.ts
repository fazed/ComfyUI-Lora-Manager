/**
 * WCAG 2.x contrast helpers for the theme tokens (used by
 * tests/contrast.test.ts so a theme can never regress below the minimum
 * contrast of text, field borders and the focus ring).
 *
 * Lives in src/themes/ because it parses raw color values, which the style
 * lint only allows here.
 */

export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNC_RE = /^rgba?\s*\(\s*([^)]*)\)$/i

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb(...)` and `rgba(...)` (comma or space syntax). */
export function parseColor(input: string): Rgba | null {
  const value = input.trim()
  const hex = HEX_RE.exec(value)
  if (hex) {
    let digits = hex[1]
    if (digits.length <= 4) digits = [...digits].map((d) => d + d).join('')
    const n = (i: number) => parseInt(digits.slice(i, i + 2), 16)
    return { r: n(0), g: n(2), b: n(4), a: digits.length === 8 ? n(6) / 255 : 1 }
  }
  const func = FUNC_RE.exec(value)
  if (!func) return null
  const parts = func[1].split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return null
  const channel = (text: string) => (text.endsWith('%') ? (parseFloat(text) / 100) * 255 : parseFloat(text))
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  const [r, g, b] = parts.slice(0, 3).map(channel)
  if ([r, g, b, alpha].some((n) => Number.isNaN(n))) return null
  return { r, g, b, a: alpha }
}

/** Source-over compositing of a (possibly translucent) color on an opaque background. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a
  return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }
}

/** WCAG relative luminance of an opaque color. */
export function relativeLuminance({ r, g, b }: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * Contrast ratio (1..21) of `foreground` on `background`. A translucent
 * background is first composited on `base` (default: opaque white is NOT
 * assumed; pass the surface underneath), a translucent foreground on the
 * resulting background.
 */
export function contrastRatio(foreground: string | Rgba, background: string | Rgba, base?: string | Rgba): number {
  const toRgba = (c: string | Rgba) => {
    const parsed = typeof c === 'string' ? parseColor(c) : c
    if (!parsed) throw new Error(`Unparseable color: ${String(c)}`)
    return parsed
  }
  let bg = toRgba(background)
  if (bg.a < 1) {
    if (base === undefined) throw new Error('A translucent background needs a base color')
    bg = composite(bg, toRgba(base))
  }
  const fg = composite(toRgba(foreground), bg)
  const [l1, l2] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** The custom properties declared in a theme stylesheet (comments stripped, last one wins). */
export function readThemeTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--lm-[\w-]+)\s*:\s*([^;]+);/g)) tokens[match[1]] = match[2].trim()
  return tokens
}
