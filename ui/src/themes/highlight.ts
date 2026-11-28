/**
 * Highlight colour of the built-in themes: a preset or a custom hex, resolved
 * per colour scheme into the four accent tokens. A custom colour is clamped so
 * it keeps text contrast on the panels in both schemes; the focus ring is NOT
 * derived from it (--lm-color-focus stays a theme token).
 *
 * Lives in src/themes/ because it handles raw colour values, which the style
 * lint only allows here.
 */
import { composite, contrastRatio, parseColor, type Rgba } from './contrast'
import type { ColorScheme } from './registry'

export const HIGHLIGHT_PRESETS = [
  { id: 'mono', color: '#ffffff' },
  { id: 'ice', color: '#7cc7f0' },
  { id: 'mint', color: '#6fd6a6' },
  { id: 'rose', color: '#f58ba3' },
  { id: 'sand', color: '#d8c9a8' },
  { id: 'steel', color: '#9fb0c3' },
  { id: 'coral', color: '#ff8a6b' },
  { id: 'lime', color: '#b7e36a' },
] as const

export type HighlightPresetId = (typeof HIGHLIGHT_PRESETS)[number]['id']

export const DEFAULT_HIGHLIGHT: HighlightPresetId = 'mono'

export interface HighlightSurfaces {
  surface: string
  elevated: string
  text: string
}

export interface HighlightVars {
  accent: string
  accentHover: string
  accentSoft: string
  onAccent: string
}

/** Panel and text colours of default-light / default-dark (pinned to the theme files by tests/highlight.test.ts). */
export const BUILTIN_SURFACES: Record<ColorScheme, HighlightSurfaces> = {
  dark: { surface: '#141414', elevated: '#1b1b1b', text: '#ededed' },
  light: { surface: '#ffffff', elevated: '#ffffff', text: '#111111' },
}

const MONO: Record<ColorScheme, string> = { dark: '#ffffff', light: '#111111' }
const SOFT_ALPHA: Record<ColorScheme, number> = { dark: 0.16, light: 0.14 }
const ON_DARK = '#0b0b0b'
const ON_LIGHT = '#ffffff'
const TEXT_CONTRAST = 4.5
const CUSTOM_RE = /^#[0-9a-f]{6}$/i

/** A highlight choice: a preset id or a `#rrggbb` custom colour. */
export function isHighlightChoice(value: string): boolean {
  return CUSTOM_RE.test(value) || HIGHLIGHT_PRESETS.some((preset) => preset.id === value)
}

const rgb = (value: string): Rgba => parseColor(value)!

function mix(from: Rgba, to: Rgba, amount: number): Rgba {
  const step = (a: number, b: number) => a + (b - a) * amount
  return { r: step(from.r, to.r), g: step(from.g, to.g), b: step(from.b, to.b), a: 1 }
}

function toHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

export function resolveHighlight(choice: string, scheme: ColorScheme, surfaces: HighlightSurfaces): HighlightVars {
  const preset = HIGHLIGHT_PRESETS.find((entry) => entry.id === choice)
  const source = choice === 'mono' || (!preset && !CUSTOM_RE.test(choice)) ? MONO[scheme] : (preset?.color ?? choice)
  const surface = rgb(surfaces.surface)
  const text = rgb(surfaces.text)
  const softOf = (color: Rgba) => composite({ ...color, a: SOFT_ALPHA[scheme] }, surface)

  // Clamp: step 8% toward the text colour until the accent reads as text on the
  // panel and on its own soft tint (active chips, badges, selected rows).
  let accent = rgb(source)
  for (let i = 0; i < 64; i++) {
    if (contrastRatio(accent, surface) >= TEXT_CONTRAST && contrastRatio(accent, softOf(accent)) >= TEXT_CONTRAST) break
    accent = mix(accent, text, 0.08)
  }

  const onAccent = contrastRatio(ON_DARK, accent) >= contrastRatio(ON_LIGHT, accent) ? ON_DARK : ON_LIGHT
  // Hover dims toward the panel; when that costs the label its contrast, it moves away from the label instead.
  let hover = mix(accent, surface, 0.15)
  if (contrastRatio(onAccent, hover) < TEXT_CONTRAST) hover = mix(accent, rgb(onAccent === ON_DARK ? ON_LIGHT : ON_DARK), 0.15)

  const accentHex = toHex(accent)
  const { r, g, b } = rgb(accentHex)
  return {
    accent: accentHex,
    accentHover: toHex(hover),
    accentSoft: `rgba(${r}, ${g}, ${b}, ${SOFT_ALPHA[scheme]})`,
    onAccent,
  }
}
