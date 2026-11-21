/**
 * Page layout contract: every routed page declares a layout kind in its route
 * meta, and every `content` page renders inside the shared PageShell (centered
 * container, shared max-width token, one header style). Only the `grid`
 * library pages (virtualised, full width) may skip the shell.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LAYOUT_KINDS, routes } from '@/router'

const SRC = resolve(__dirname, '../src')
const PAGES = join(SRC, 'pages')
const read = (path: string) => readFileSync(path, 'utf8')

/** Full-width pages that intentionally do not use PageShell. */
const GRID_PAGES = ['LibraryPage.vue', 'RecipesPage.vue']

const routerSource = read(join(SRC, 'router.ts'))
/** page file -> layout kind(s) declared by the routes that use it. */
const declared = new Map<string, Set<string>>()
for (const block of routerSource.split(/\n\s*\{\s*\n?\s*path:/).slice(1)) {
  const page = block.match(/import\('@\/pages\/(\w+\.vue)'\)/)?.[1]
  if (!page) continue
  const kind = block.match(/layout:\s*'(\w+)'/)?.[1] ?? 'missing'
  declared.set(page, (declared.get(page) ?? new Set()).add(kind))
}

describe('page layout kinds', () => {
  it('every routed component declares a known layout kind in meta', () => {
    for (const route of routes) {
      if (!route.component) continue
      expect(LAYOUT_KINDS, `route ${String(route.name)}`).toContain(route.meta?.layout)
    }
  })

  it('every page file is routed and has a single consistent kind', () => {
    const files = readdirSync(PAGES).filter((f) => f.endsWith('.vue'))
    expect([...declared.keys()].sort()).toEqual(files.sort())
    for (const [page, kinds] of declared) expect(kinds.size, page).toBe(1)
  })

  it('the grid allow-list matches the routes declared as grid', () => {
    const grid = [...declared].filter(([, kinds]) => kinds.has('grid')).map(([page]) => page)
    expect(grid.sort()).toEqual([...GRID_PAGES].sort())
  })
})

describe('PageShell usage', () => {
  for (const [page, kinds] of declared) {
    const source = read(join(PAGES, page))
    if (kinds.has('grid')) {
      it(`${page} (grid) stays full width and does not use PageShell`, () => {
        expect(source).not.toContain('<PageShell')
      })
    } else {
      it(`${page} (content) renders inside PageShell with its own container classes removed`, () => {
        expect(source).toMatch(/import PageShell from '@\/components\/PageShell\.vue'/)
        expect(source).toContain('<PageShell')
        // Containers are the shell's job: no page-level max-width, centering or page padding.
        expect(source).not.toMatch(/\blm-page\b/)
        expect(source).not.toMatch(/max-w-\[\d+px\]\s+flex-col|mx-auto flex w-full max-w-\[/)
      })
    }
  }
})
