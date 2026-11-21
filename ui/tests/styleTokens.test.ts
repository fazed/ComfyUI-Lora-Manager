/**
 * Style lint: components must consume design tokens only. Raw colors, radii,
 * font families and shadows are allowed exclusively in src/themes/*.css.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../src')
const THEMES = join(SRC, 'themes')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return path === THEMES ? [] : walk(path)
    return /\.(vue|css)$/.test(name) ? [path] : []
  })
}

/** CSS of a file: whole .css files, only <style> blocks of .vue files. */
function styles(path: string): string {
  const text = readFileSync(path, 'utf8')
  if (path.endsWith('.css')) return text
  return [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
}

const NAMED_COLORS = /(?<![\w-])(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink)(?![\w-])/i

const RULES: { name: string; test: (decl: string, prop: string, value: string) => boolean }[] = [
  { name: 'hex color', test: (_d, _p, value) => /#[0-9a-f]{3,8}\b/i.test(value) },
  { name: 'rgb/hsl color', test: (_d, _p, value) => /\b(rgba?|hsla?|oklch|lab|lch)\(/i.test(value) },
  {
    name: 'named color',
    test: (_d, prop, value) => /(color|background|border|fill|stroke|outline|shadow)/.test(prop) && NAMED_COLORS.test(value),
  },
  {
    name: 'raw border-radius',
    test: (_d, prop, value) => /radius$/.test(prop) && !/^(var\(|inherit|0$|50%)/.test(value),
  },
  { name: 'raw font-family', test: (_d, prop, value) => prop === 'font-family' && !/^(var\(|inherit)/.test(value) },
  {
    name: 'raw box-shadow',
    test: (_d, prop, value) => prop === 'box-shadow' && !/^(var\(|none|0 0 0 var\()/.test(value),
  },
]

describe('component styles use design tokens only', () => {
  const files = walk(SRC)

  it('finds component styles to check', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  for (const file of files) {
    it(relative(SRC, file).replace(/\\/g, '/'), () => {
      const css = styles(file).replace(/\/\*[\s\S]*?\*\//g, '')
      const violations: string[] = []
      for (const match of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/gi)) {
        const prop = match[1].toLowerCase()
        if (prop.startsWith('--')) continue
        const value = match[2].trim()
        for (const rule of RULES) {
          if (rule.test(match[0], prop, value)) violations.push(`${rule.name}: ${match[0].trim()}`)
        }
      }
      expect(violations).toEqual([])
    })
  }
})
