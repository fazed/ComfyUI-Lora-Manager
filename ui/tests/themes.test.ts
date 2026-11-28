import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_THEMES,
  DENSITY_STORAGE_KEY,
  HIGHLIGHT_STORAGE_KEY,
  HIGHLIGHT_VARS_STORAGE_KEY,
  SCALE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  USER_THEME_STORAGE_KEY,
  resolveThemeId,
  toUserTheme,
} from '@/themes/registry'

const root = resolve(__dirname, '..')

/**
 * Deliberate, documented exceptions: layout tokens a built-in theme may
 * override (see ui/README.md, Theming). Empty: every built-in theme shares
 * the layout tokens of base.css.
 */
const THEME_LAYOUT_OPT_IN: Record<string, string[]> = {}

describe('theme registry', () => {
  it('resolves system to the default light/dark themes', () => {
    expect(resolveThemeId('system', false, BUILTIN_THEMES)).toBe('default-light')
    expect(resolveThemeId('system', true, BUILTIN_THEMES)).toBe('default-dark')
  })

  it('keeps an explicit known theme and falls back for unknown ids', () => {
    expect(resolveThemeId('default-dark', false, BUILTIN_THEMES)).toBe('default-dark')
    expect(resolveThemeId('gone', true, BUILTIN_THEMES)).toBe('default-dark')
  })

  it('ships Light and Dark only; a stored "midnight" (now a user-theme example) falls back to the system default', () => {
    expect(BUILTIN_THEMES.map((theme) => theme.id)).toEqual(['default-light', 'default-dark'])
    expect(resolveThemeId('midnight', true, BUILTIN_THEMES)).toBe('default-dark')
    expect(resolveThemeId('midnight', false, BUILTIN_THEMES)).toBe('default-light')
    // As a user theme the id is no longer reserved.
    expect(toUserTheme({ id: 'midnight', href: 'user-themes/midnight.css', scheme: 'dark' })?.id).toBe('midnight')
  })

  it('validates user themes from the backend', () => {
    expect(toUserTheme({ id: 'sunset', label: 'Sunset', scheme: 'dark', href: 'user-themes/sunset.css' })).toEqual({
      id: 'sunset',
      label: 'Sunset',
      scheme: 'dark',
      description: '',
      href: 'user-themes/sunset.css',
      source: 'user',
    })
    expect(toUserTheme({ id: 'x', href: 'https://evil/x.css' })).toBeNull()
    expect(toUserTheme({ id: '../x', href: 'user-themes/x.css' })).toBeNull()
    expect(toUserTheme({ id: 'default-dark', href: 'user-themes/d.css' })).toBeNull()
    expect(toUserTheme(null)).toBeNull()
  })

  it('every built-in theme has a token file selected by data-theme', () => {
    for (const theme of BUILTIN_THEMES) {
      const css = readFileSync(resolve(root, `src/themes/${theme.id}.css`), 'utf8')
      expect(css).toContain(`[data-theme='${theme.id}']`)
      expect(css).toContain(`color-scheme: ${theme.scheme}`)
    }
  })

  it('every built-in theme defines the same color tokens', () => {
    const tokens = (id: string) =>
      new Set(
        [...readFileSync(resolve(root, `src/themes/${id}.css`), 'utf8').matchAll(/(--lm-color-[\w-]+)\s*:/g)].map((m) => m[1]),
      )
    const reference = tokens('default-light')
    expect(reference.size).toBeGreaterThan(20)
    for (const theme of BUILTIN_THEMES) {
      expect([...tokens(theme.id)].sort()).toEqual([...reference].sort())
    }
  })

  it('built-in themes only set color/appearance tokens; layout tokens come from base.css', () => {
    const appearance = /^--lm-(color|radius|shadow)-[\w-]+$/
    for (const theme of BUILTIN_THEMES) {
      const css = readFileSync(resolve(root, `src/themes/${theme.id}.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      const declared = [...css.matchAll(/(--lm-[\w-]+)\s*:/g)].map((m) => m[1])
      const allowed = new Set(THEME_LAYOUT_OPT_IN[theme.id] ?? [])
      const structural = declared.filter((name) => !appearance.test(name) && !allowed.has(name))
      expect(structural, theme.id).toEqual([])
    }
    // Every structural token a theme could opt into must exist in base.css.
    const base = readFileSync(resolve(root, 'src/themes/base.css'), 'utf8')
    for (const name of Object.values(THEME_LAYOUT_OPT_IN).flat()) expect(base).toContain(`${name}:`)
    for (const name of ['--lm-card-gap', '--lm-card-aspect', '--lm-space-4', '--lm-control-height', '--lm-font-size-md']) {
      expect(base).toContain(`${name}:`)
    }
  })

  it('the pre-paint bootstrap in index.html uses the registry storage keys', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    for (const key of [THEME_STORAGE_KEY, USER_THEME_STORAGE_KEY, DENSITY_STORAGE_KEY, SCALE_STORAGE_KEY, HIGHLIGHT_VARS_STORAGE_KEY]) {
      expect(html).toContain(`'${key}'`)
    }
    // lm-ui.highlight itself is never read pre-paint: useAppearance resolves it into lm-ui.highlight.vars.
    expect(HIGHLIGHT_STORAGE_KEY).toBe('lm-ui.highlight')
    expect(html).toContain('lm-ui.highlight.vars')
  })

  it('the bootstrap applies a valid stored text size and the pre-resolved highlight on built-in themes only', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]
    const vars = {
      dark: { accent: '#7cc7f0', accentHover: '#6aaed3', accentSoft: 'rgba(124, 199, 240, 0.16)', onAccent: '#0b0b0b' },
      light: { accent: '#1f5d80', accentHover: '#18506e', accentSoft: 'rgba(31, 93, 128, 0.14)', onAccent: '#ffffff' },
    }
    const run = (store: Record<string, string>) => {
      const el = document.documentElement
      el.removeAttribute('style')
      el.removeAttribute('data-scale')
      localStorage.clear()
      for (const [key, value] of Object.entries(store)) localStorage.setItem(key, value)
      new Function(script)()
      return el
    }

    let el = run({ [SCALE_STORAGE_KEY]: 'xl', [THEME_STORAGE_KEY]: 'default-dark', [HIGHLIGHT_VARS_STORAGE_KEY]: JSON.stringify(vars) })
    expect(el.getAttribute('data-scale')).toBe('xl')
    expect(el.style.getPropertyValue('--lm-color-accent')).toBe('#7cc7f0')
    expect(el.style.getPropertyValue('--lm-color-on-accent')).toBe('#0b0b0b')

    el = run({ [SCALE_STORAGE_KEY]: 'huge', [THEME_STORAGE_KEY]: 'default-light', [HIGHLIGHT_VARS_STORAGE_KEY]: JSON.stringify(vars) })
    expect(el.getAttribute('data-scale')).toBe('m')
    expect(el.style.getPropertyValue('--lm-color-accent')).toBe('#1f5d80')

    // A user theme keeps its own accent; a malformed value drops the whole set.
    el = run({ [THEME_STORAGE_KEY]: 'sunset', [HIGHLIGHT_VARS_STORAGE_KEY]: JSON.stringify(vars) })
    expect(el.style.getPropertyValue('--lm-color-accent')).toBe('')
    const bad = { ...vars, dark: { ...vars.dark, accentSoft: 'url(x)' } }
    el = run({ [THEME_STORAGE_KEY]: 'default-dark', [HIGHLIGHT_VARS_STORAGE_KEY]: JSON.stringify(bad) })
    expect(el.style.getPropertyValue('--lm-color-accent')).toBe('')
    el.removeAttribute('style')
    localStorage.clear()
  })
})
