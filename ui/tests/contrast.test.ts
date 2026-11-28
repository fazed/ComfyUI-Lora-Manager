/**
 * WCAG contrast of the built-in themes, computed from the token values in
 * src/themes/*.css. Thresholds: 4.5:1 for text (WCAG 1.4.3), 3:1 for field
 * borders and the focus ring against the surfaces they sit on (WCAG 1.4.11).
 * If a pair fails, tune the theme - never lower a threshold here.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BUILTIN_THEMES } from '@/themes/registry'
import { contrastRatio, parseColor, readThemeTokens, relativeLuminance } from '@/themes/contrast'

const root = resolve(__dirname, '..')

describe('contrast helper', () => {
  it('parses hex, rgb and rgba colors', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.5, 2)
    expect(parseColor('rgba(79, 70, 229, 0.12)')).toEqual({ r: 79, g: 70, b: 229, a: 0.12 })
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseColor('var(--x)')).toBeNull()
    expect(parseColor('#12')).toBeNull()
  })

  it('computes WCAG luminance and ratios', () => {
    expect(relativeLuminance(parseColor('#ffffff')!)).toBeCloseTo(1, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(contrastRatio('#123456', '#123456')).toBe(1)
  })

  it('composites translucent colors on their base', () => {
    // 50% black on white is mid grey.
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', '#ffffff')).toBeCloseTo(contrastRatio('#808080', '#ffffff'), 1)
    expect(() => contrastRatio('#000', 'rgba(0,0,0,0.5)')).toThrow(/base/)
    expect(contrastRatio('#000', 'rgba(255,255,255,0.5)', '#ffffff')).toBeCloseTo(21, 5)
  })
})

/** [foreground token, background token, minimum, translucent background base token?] */
type Pair = [string, string, number, string?]

const TEXT = 4.5
const NON_TEXT = 3

const PAIRS: Pair[] = [
  // Body and secondary text on every surface level, inside fields too.
  ...['bg', 'surface', 'elevated', 'field'].flatMap((bg): Pair[] => [
    ['text', bg, TEXT],
    ['muted', bg, TEXT],
  ]),
  ['text', 'field-hover', TEXT],
  ['muted', 'sunken', TEXT],
  ['placeholder', 'field', TEXT],
  ['placeholder', 'field-hover', TEXT],
  // Field outline against the panel / dialog it sits on (and the page).
  ['field-border', 'surface', NON_TEXT],
  ['field-border', 'elevated', NON_TEXT],
  ['field-border', 'bg', NON_TEXT],
  ['field-border-hover', 'surface', NON_TEXT],
  ['field-border-hover', 'elevated', NON_TEXT],
  // Focus ring against everything it can be drawn on.
  ['focus', 'bg', NON_TEXT],
  ['focus', 'surface', NON_TEXT],
  ['focus', 'elevated', NON_TEXT],
  ['focus', 'field', NON_TEXT],
  // Checked toggle/checkbox (accent) against the panel.
  ['accent', 'surface', NON_TEXT],
  ['accent', 'elevated', NON_TEXT],
  // Links, inline errors, primary/danger buttons.
  ['accent', 'surface', TEXT],
  ['danger', 'surface', TEXT],
  ['danger', 'elevated', TEXT],
  ['on-accent', 'accent', TEXT],
  ['on-accent', 'accent-hover', TEXT],
  ['on-danger', 'danger', TEXT],
  // Badges / chips: colored text on its soft tint over the panel.
  ['accent', 'accent-soft', TEXT, 'surface'],
  ['success', 'success-soft', TEXT, 'surface'],
  ['warning', 'warning-soft', TEXT, 'surface'],
  ['danger', 'danger-soft', TEXT, 'surface'],
  // Info toasts and notes.
  ['info', 'surface', TEXT],
  ['info', 'info-soft', TEXT, 'surface'],
  // Phase 6 accessibility pass: disabled labels (muted on the disabled field colour, no opacity),
  // secondary text on highlighted rows, danger items on a hovered menu row, the connection banner
  // on the page, the focus ring and the selection outline on every surface they can sit on.
  ['muted', 'field-disabled', TEXT],
  ['muted', 'field-hover', TEXT],
  ['text', 'accent-soft', TEXT, 'surface'],
  ['muted', 'accent-soft', TEXT, 'surface'],
  ['danger', 'sunken', TEXT],
  ['danger', 'bg', TEXT],
  ['warning', 'warning-soft', TEXT, 'bg'],
  ['focus', 'sunken', NON_TEXT],
  ['focus', 'accent-soft', NON_TEXT, 'surface'],
  ['accent', 'bg', NON_TEXT],
  ['accent', 'sunken', NON_TEXT],
  // Chart series 2-6 (the grey ramp; series 1 is the accent, checked above) against the panel.
  ...[2, 3, 4, 5, 6].map((n): Pair => [`series-${n}`, 'surface', NON_TEXT]),
]

describe.each(BUILTIN_THEMES.map((theme) => [theme.id]))('theme %s contrast', (id) => {
  const tokens = readThemeTokens(readFileSync(resolve(root, `src/themes/${id}.css`), 'utf8'))
  const color = (name: string) => {
    const value = tokens[`--lm-color-${name}`]
    if (!value) throw new Error(`${id}: --lm-color-${name} is not set`)
    return value
  }

  it.each(PAIRS.map((pair) => [`${pair[0]} on ${pair[1]} >= ${pair[2]}`, pair] as const))('%s', (_name, [fg, bg, min, base]) => {
    const ratio = contrastRatio(color(fg), color(bg), base ? color(base) : undefined)
    expect(Number(ratio.toFixed(2)), `${id}: ${fg} on ${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min)
  })

  it('chart series: the first is the highlight, the grey ramp has visibly distinct steps', () => {
    expect(color('series-1')).toBe('var(--lm-color-accent)')
    for (let n = 2; n < 6; n++) expect(contrastRatio(color(`series-${n}`), color(`series-${n + 1}`))).toBeGreaterThanOrEqual(1.2)
  })

  it('layers surfaces: fields are distinguishable from the page', () => {
    // The field background differs from the page so an input never looks like a hole in the panel.
    expect(contrastRatio(color('field'), color('bg'))).toBeGreaterThan(1.03)
  })
})
