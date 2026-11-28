/**
 * Highlight colour: every preset and hostile custom colours keep text
 * contrast on both built-in schemes after the clamp, and the default (Mono)
 * equals the accent tokens in the theme files.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { BUILTIN_SURFACES, DEFAULT_HIGHLIGHT, HIGHLIGHT_PRESETS, isHighlightChoice, resolveHighlight } from '@/themes/highlight'
import { contrastRatio, readThemeTokens } from '@/themes/contrast'
import { HIGHLIGHT_STORAGE_KEY, HIGHLIGHT_VARS_STORAGE_KEY, type ColorScheme } from '@/themes/registry'
import { useAppearance } from '@/composables/useAppearance'

const tokens = (id: string) => readThemeTokens(readFileSync(resolve(__dirname, `../src/themes/${id}.css`), 'utf8'))
const THEME_OF: Record<ColorScheme, string> = { dark: 'default-dark', light: 'default-light' }
const SCHEMES: ColorScheme[] = ['dark', 'light']
const CHOICES = [...HIGHLIGHT_PRESETS.map((preset) => preset.id), '#000000', '#101010', '#ffffff', '#f5f5f5', '#808080']

describe('resolveHighlight', () => {
  it.each(SCHEMES.flatMap((scheme) => CHOICES.map((choice) => [scheme, choice] as const)))('%s / %s keeps contrast', (scheme, choice) => {
    const surfaces = BUILTIN_SURFACES[scheme]
    const vars = resolveHighlight(choice, scheme, surfaces)
    expect(contrastRatio(vars.accent, surfaces.surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(vars.accent, surfaces.elevated)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(vars.onAccent, vars.accent)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(vars.onAccent, vars.accentHover)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(vars.accent, vars.accentSoft, surfaces.surface)).toBeGreaterThanOrEqual(4.5)
    expect(vars.accentHover).not.toBe(vars.accent)
  })

  // Phase 6f: the selection outline (ring-selected = accent) stays visible on the page and hovered rows after the
  // clamp, and the focus ring never follows the highlight (it is the theme's own --lm-color-focus).
  it.each(SCHEMES.flatMap((scheme) => CHOICES.map((choice) => [scheme, choice] as const)))('%s / %s: selection outline and focus ring', (scheme, choice) => {
    const theme = tokens(THEME_OF[scheme])
    const vars = resolveHighlight(choice, scheme, BUILTIN_SURFACES[scheme])
    for (const surface of ['bg', 'surface', 'elevated', 'sunken']) {
      expect(contrastRatio(vars.accent, theme[`--lm-color-${surface}`])).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(theme['--lm-color-focus'], theme[`--lm-color-${surface}`])).toBeGreaterThanOrEqual(3)
    }
    expect(theme['--lm-color-focus']).not.toContain('accent')
  })

  it('draws the focus ring in the focus token and the selection outline in the accent', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/tokens.css'), 'utf8')
    expect(css).toMatch(/@utility focus-ring \{\s*outline: var\(--lm-focus-ring-width\) solid var\(--lm-color-focus\);/)
    expect(css).toMatch(/@utility ring-selected \{\s*box-shadow: 0 0 0 var\(--lm-focus-ring-width\) var\(--lm-color-accent\);/)
    expect(readFileSync(resolve(__dirname, '../src/styles/app.css'), 'utf8')).toMatch(/:focus-visible \{\s*outline: var\(--lm-focus-ring-width\) solid var\(--lm-color-focus\);/)
  })

  it('resolves Mono to white on dark and near-black on light, matching the theme files', () => {
    for (const scheme of SCHEMES) {
      const theme = tokens(THEME_OF[scheme])
      expect(resolveHighlight(DEFAULT_HIGHLIGHT, scheme, BUILTIN_SURFACES[scheme])).toEqual({
        accent: theme['--lm-color-accent'],
        accentHover: theme['--lm-color-accent-hover'],
        accentSoft: theme['--lm-color-accent-soft'],
        onAccent: theme['--lm-color-on-accent'],
      })
    }
    expect(resolveHighlight('mono', 'dark', BUILTIN_SURFACES.dark).accent).toBe('#ffffff')
    expect(resolveHighlight('mono', 'light', BUILTIN_SURFACES.light).accent).toBe('#111111')
  })

  it('keeps a colour that already passes and falls back to Mono for invalid input', () => {
    expect(resolveHighlight('#7cc7f0', 'dark', BUILTIN_SURFACES.dark).accent).toBe('#7cc7f0')
    for (const bad of ['', 'red', '#12', 'url(x)', '#1234567']) {
      expect(isHighlightChoice(bad)).toBe(false)
      expect(resolveHighlight(bad, 'dark', BUILTIN_SURFACES.dark)).toEqual(resolveHighlight('mono', 'dark', BUILTIN_SURFACES.dark))
    }
  })

  it('pins BUILTIN_SURFACES to the default theme files', () => {
    for (const scheme of SCHEMES) {
      const theme = tokens(THEME_OF[scheme])
      expect(BUILTIN_SURFACES[scheme]).toEqual({
        surface: theme['--lm-color-surface'],
        elevated: theme['--lm-color-elevated'],
        text: theme['--lm-color-text'],
      })
    }
  })
})

describe('useAppearance', () => {
  afterEach(() => {
    useAppearance().setHighlight(DEFAULT_HIGHLIGHT)
    useAppearance().setScale('m')
    localStorage.clear()
  })

  it('sets data-scale and the inline accent tokens, and stores both schemes for the pre-paint script', async () => {
    const appearance = useAppearance()
    appearance.setScale('xl')
    expect(document.documentElement.getAttribute('data-scale')).toBe('xl')

    appearance.setHighlight('#808080')
    await nextTick()
    expect(localStorage.getItem(HIGHLIGHT_STORAGE_KEY)).toBe('#808080')
    const stored = JSON.parse(localStorage.getItem(HIGHLIGHT_VARS_STORAGE_KEY) ?? 'null')
    expect(stored.dark).toEqual(resolveHighlight('#808080', 'dark', BUILTIN_SURFACES.dark))
    expect(stored.light).toEqual(resolveHighlight('#808080', 'light', BUILTIN_SURFACES.light))
    expect(document.documentElement.style.getPropertyValue('--lm-color-accent')).toMatch(/^#[0-9a-f]{6}$/)

    appearance.setHighlight(DEFAULT_HIGHLIGHT)
    expect(localStorage.getItem(HIGHLIGHT_VARS_STORAGE_KEY)).toBeNull()
    expect(document.documentElement.style.getPropertyValue('--lm-color-accent')).toBe('')
  })
})
