/**
 * Style lint: components must consume design tokens only.
 *
 * Raw colors, radii, font families and shadows are allowed exclusively in
 * src/themes/*.css (theme files) and src/styles/tokens.css (the Tailwind <->
 * token bridge). Everywhere else in src/:
 *  - CSS declarations (.css files, <style> blocks) may only use tokens;
 *  - class lists (templates, class strings in scripts, @apply) may not use raw
 *    color literals, arbitrary values with raw colors/radii/shadows/fonts,
 *    Tailwind's default palette (bg-red-500, text-white, ...) or `dark:`
 *    (themes switch through data-theme and tokens, never through variants).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../src')
const THEMES = join(SRC, 'themes')
const TOKEN_FILE = join(SRC, 'styles', 'tokens.css')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return path === THEMES ? [] : walk(path)
    return /\.(vue|css|ts)$/.test(name) && path !== TOKEN_FILE ? [path] : []
  })
}

const stripCssComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const stripScriptComments = (text: string) =>
  stripCssComments(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:'"`\w])\/\/.*$/gm, '$1')

/** CSS declarations of a file: whole .css files, only <style> blocks of .vue files. */
function styles(path: string): string {
  const text = readFileSync(path, 'utf8')
  if (path.endsWith('.css')) return stripCssComments(text).replace(/@apply[^;]*;/g, '')
  if (!path.endsWith('.vue')) return ''
  return stripCssComments([...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n'))
}

/** Everything that can hold utility classes: templates/scripts, class strings, @apply lists. */
function classSources(path: string): string {
  const text = readFileSync(path, 'utf8')
  if (path.endsWith('.css')) return [...stripCssComments(text).matchAll(/@apply([^;]*);/g)].map((m) => m[1]).join('\n')
  return stripScriptComments(text.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ''))
}

const NAMED_COLORS = /(?<![\w-])(white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink)(?![\w-])/i
const RAW_COLOR = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(/i

const DECLARATION_RULES: { name: string; test: (prop: string, value: string) => boolean }[] = [
  { name: 'hex color', test: (_p, value) => /#[0-9a-f]{3,8}\b/i.test(value) },
  { name: 'rgb/hsl color', test: (_p, value) => /\b(rgba?|hsla?|oklch|lab|lch)\(/i.test(value) },
  {
    name: 'named color',
    test: (prop, value) => /(color|background|border|fill|stroke|outline|shadow)/.test(prop) && NAMED_COLORS.test(value),
  },
  { name: 'raw border-radius', test: (prop, value) => /radius$/.test(prop) && !/^(var\(|inherit|0$|50%)/.test(value) },
  { name: 'raw font-family', test: (prop, value) => prop === 'font-family' && !/^(var\(|inherit)/.test(value) },
  { name: 'raw box-shadow', test: (prop, value) => prop === 'box-shadow' && !/^(var\(|none|0 0 0 var\()/.test(value) },
]

const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white'
const COLOR_UTILITIES =
  'bg|text|border(?:-[trblxyse])?|ring|ring-offset|outline|fill|stroke|from|via|to|accent|caret|decoration|divide|placeholder|shadow|inset-shadow|inset-ring|drop-shadow|text-shadow'

const CLASS_RULES: { name: string; pattern: RegExp }[] = [
  { name: 'raw color literal', pattern: RAW_COLOR },
  {
    name: 'default palette utility',
    pattern: new RegExp(`(?<![\\w-])-?(?:${COLOR_UTILITIES})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`),
  },
  { name: 'named color in arbitrary value', pattern: new RegExp(`\\[[^\\]\\s]*${NAMED_COLORS.source}[^\\]\\s]*\\]`, 'i') },
  { name: 'raw radius in arbitrary value', pattern: /(?<![\w-])rounded(?:-[trblse]{1,2})?-\[(?!inherit\]|var\()/ },
  { name: 'raw shadow in arbitrary value', pattern: /(?<![\w-])(?:shadow|drop-shadow|inset-shadow)-\[(?!var\()/ },
  { name: 'raw font in arbitrary value', pattern: /(?<![\w-])font-\[(?!var\()/ },
  { name: 'dark: variant (use theme tokens)', pattern: /(?<![\w-])dark:/ },
]

function declarationViolations(css: string): string[] {
  const violations: string[] = []
  for (const match of css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/gi)) {
    const prop = match[1].toLowerCase()
    if (prop.startsWith('--')) continue
    const value = match[2].trim()
    for (const rule of DECLARATION_RULES) {
      if (rule.test(prop, value)) violations.push(`${rule.name}: ${match[0].trim()}`)
    }
  }
  return violations
}

function classViolations(source: string): string[] {
  const violations: string[] = []
  source.split('\n').forEach((line, index) => {
    for (const rule of CLASS_RULES) {
      const found = line.match(rule.pattern)
      if (found) violations.push(`${rule.name} (line ${index + 1}): ${found[0]}`)
    }
  })
  return violations
}

describe('component styles use design tokens only', () => {
  const files = walk(SRC)

  it('finds component styles to check', () => {
    expect(files.filter((file) => /\.(vue|css)$/.test(file)).length).toBeGreaterThan(10)
  })

  for (const file of files) {
    it(relative(SRC, file).replace(/\\/g, '/'), () => {
      expect([...declarationViolations(styles(file)), ...classViolations(classSources(file))]).toEqual([])
    })
  }
})

describe('the token lint itself', () => {
  it('rejects raw values and the default palette in class lists', () => {
    const bad = [
      'class="bg-blue-500"',
      "'text-white'",
      'class="hover:border-red-500/50"',
      'class="bg-[#fff]"',
      'class="text-[rgb(1,2,3)]"',
      'class="bg-[color:red]"',
      'class="rounded-[12px]"',
      'class="shadow-[0_1px_2px_black]"',
      "class=\"font-['Arial']\"",
      'class="dark:bg-surface"',
    ]
    for (const sample of bad) expect(classViolations(sample), sample).not.toEqual([])
  })

  it('accepts token utilities and token-based arbitrary values', () => {
    const good = [
      'class="bg-surface text-muted border-border bg-accent text-on-accent rounded-md shadow-md"',
      'class="w-[min(var(--lm-drawer-width),100vw)] rounded-[inherit] bg-transparent"',
      "class=\"text-xs not-last:after:content-['·'] border-l-success hover:text-danger\"",
      'class="tablet:-translate-x-full phone:hidden"',
    ]
    for (const sample of good) expect(classViolations(sample), sample).toEqual([])
  })

  it('rejects raw values in CSS declarations', () => {
    expect(declarationViolations('a { color: #fff; border-radius: 4px; box-shadow: 0 1px 2px black; }')).toHaveLength(4)
    expect(declarationViolations('a { color: var(--lm-color-text); border-radius: var(--lm-radius-sm); }')).toEqual([])
  })
})
