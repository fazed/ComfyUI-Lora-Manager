/**
 * Fonts are bundled files: no font service, no remote URL anywhere in the
 * stylesheets or the page shell (the UI must work offline).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const UI = resolve(__dirname, '..')
const SRC = join(UI, 'src')
const FONTS_CSS = join(SRC, 'themes/fonts.css')

const cssFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })

describe('bundled fonts', () => {
  const css = readFileSync(FONTS_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1])

  it('declares Geist and Geist Mono from local woff2 files that exist', () => {
    expect(css).toContain("font-family: 'Geist';")
    expect(css).toContain("font-family: 'Geist Mono';")
    expect(urls).toHaveLength(2)
    for (const url of urls) {
      expect(url).toMatch(/\.woff2$/)
      expect(existsSync(resolve(dirname(FONTS_CSS), url)), url).toBe(true)
    }
    expect(css.match(/font-display: swap;/g)).toHaveLength(2)
  })

  it('ships the licence next to the font files', () => {
    const licence = readFileSync(join(SRC, 'assets/fonts/OFL.txt'), 'utf8')
    expect(licence).toContain('SIL Open Font License, Version 1.1')
  })

  it('keeps the system stack as fallback behind the bundled faces', () => {
    const base = readFileSync(join(SRC, 'themes/base.css'), 'utf8')
    expect(base).toMatch(/--lm-font-sans: 'Geist', ui-sans-serif, system-ui/)
    expect(base).toMatch(/--lm-font-mono: 'Geist Mono', ui-monospace/)
  })

  it('loads nothing from the network: no http(s) URL in any stylesheet or in index.html', () => {
    for (const file of cssFiles(SRC)) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(text, file).not.toMatch(/https?:\/\//)
    }
    const html = readFileSync(join(UI, 'index.html'), 'utf8')
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toMatch(/googleapis|gstatic/)
  })
})
