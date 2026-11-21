import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_THEMES,
  DENSITY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  USER_THEME_STORAGE_KEY,
  resolveThemeId,
  toUserTheme,
} from '@/themes/registry'

const root = resolve(__dirname, '..')

describe('theme registry', () => {
  it('resolves system to the default light/dark themes', () => {
    expect(resolveThemeId('system', false, BUILTIN_THEMES)).toBe('default-light')
    expect(resolveThemeId('system', true, BUILTIN_THEMES)).toBe('default-dark')
  })

  it('keeps an explicit known theme and falls back for unknown ids', () => {
    expect(resolveThemeId('midnight', false, BUILTIN_THEMES)).toBe('midnight')
    expect(resolveThemeId('gone', true, BUILTIN_THEMES)).toBe('default-dark')
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

  it('the pre-paint bootstrap in index.html uses the registry storage keys', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    for (const key of [THEME_STORAGE_KEY, USER_THEME_STORAGE_KEY, DENSITY_STORAGE_KEY]) {
      expect(html).toContain(`'${key}'`)
    }
  })
})
