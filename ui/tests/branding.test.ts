/**
 * Branding: the MooBox LM mark (designed for the companion browser extension,
 * `lora-manager-browser-extension`: assets/logo-mark.svg, src/lib/logo.ts).
 *
 * The header tile renders it through BrandMark (a monochrome currentColor
 * glyph, so every theme's accent/on-accent colours it); the favicon is the
 * static tile SVG in the default-light accent.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import BrandMark from '@/components/BrandMark.vue'
import TopBar from '@/components/TopBar.vue'
import { routes } from '@/router'

/** The mark on a 32x32 grid, copied verbatim from the extension's src/lib/logo.ts. */
const MARK_PATH =
  'M16 7.6H20.667C22.067 5.5 24.4 3.4 28.133 2.467C28.133 5.733 27.2 8.3 25.333 9.933V11.8C27.667 10.867 30 11.8 30 14.133C30 16.467 27.667 17.4 25.333 16.7V26.5Q25.333 30 21.833 30H10.167Q6.667 30 6.667 26.5V16.7C4.333 17.4 2 16.467 2 14.133C2 11.8 4.333 10.867 6.667 11.8V9.933C4.8 8.3 3.867 5.733 3.867 2.467C7.6 3.4 9.933 5.5 11.333 7.6ZM11.8 19.733H20.2Q23 19.733 23 22.533V24.867Q23 27.667 20.2 27.667H11.8Q9 27.667 9 24.867V22.533Q9 19.733 11.8 19.733ZM12.5 21.95C13.272 21.95 13.9 22.734 13.9 23.7C13.9 24.666 13.272 25.45 12.5 25.45C11.728 25.45 11.1 24.666 11.1 23.7C11.1 22.734 11.728 21.95 12.5 21.95ZM19.5 21.95C20.272 21.95 20.9 22.734 20.9 23.7C20.9 24.666 20.272 25.45 19.5 25.45C18.728 25.45 18.1 24.666 18.1 23.7C18.1 22.734 18.728 21.95 19.5 21.95ZM12.5 12.267C13.272 12.267 13.9 12.894 13.9 13.667C13.9 14.439 13.272 15.067 12.5 15.067C11.728 15.067 11.1 14.439 11.1 13.667C11.1 12.894 11.728 12.267 12.5 12.267ZM19.5 12.267C20.272 12.267 20.9 12.894 20.9 13.667C20.9 14.439 20.272 15.067 19.5 15.067C18.728 15.067 18.1 14.439 18.1 13.667C18.1 12.894 18.728 12.267 19.5 12.267Z'

const UI = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(UI, path), 'utf8')

describe('BrandMark', () => {
  it('renders the exact mark path as a decorative currentColor glyph', () => {
    const wrapper = mount(BrandMark)
    const svg = wrapper.get('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 32 32')
    expect(svg.attributes('fill')).toBe('currentColor')
    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('focusable')).toBe('false')
    expect(svg.attributes('stroke')).toBeUndefined()
    expect(svg.attributes('width')).toBe('28')
    expect(svg.attributes('height')).toBe('28')
    const paths = wrapper.findAll('path')
    expect(paths).toHaveLength(1)
    expect(paths[0]!.attributes('d')).toBe(MARK_PATH)
    // The eyes and the muzzle are holes cut out of the face: even-odd filling.
    expect(svg.attributes('fill-rule')).toBe('evenodd')
    expect(paths[0]!.attributes('fill')).toBeUndefined()
  })

  it('takes its size from the size prop', () => {
    const svg = mount(BrandMark, { props: { size: 48 } }).get('svg')
    expect(svg.attributes('width')).toBe('48')
    expect(svg.attributes('height')).toBe('48')
  })

  it('pins the path string in the component source and uses no raw colour', () => {
    const source = read('src/components/BrandMark.vue')
    expect(source).toContain(MARK_PATH)
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
})

describe('favicon', () => {
  it('is the MooBox LM tile: indigo rounded square with the white mark filling 24 of 32 units', () => {
    const svg = read('public/favicon.svg').trim()
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
        '<rect width="32" height="32" rx="6" fill="#4f46e5"/>' +
        '<path transform="translate(2.2857 2.2857) scale(0.8571)" fill="#ffffff" fill-rule="evenodd" ' +
        `d="${MARK_PATH}"/>` +
        '</svg>',
    )
  })

  it('places the glyph (2..30 in the mark) at 4..28 in the tile, i.e. 75%', () => {
    const svg = read('public/favicon.svg')
    const [, tx, ty, k] = svg.match(/translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/)!.map(Number)
    expect(tx! + 2 * k!).toBeCloseTo(4, 2)
    expect(ty! + 30 * k!).toBeCloseTo(28, 2)
  })

  it('matches the default-light accent and on-accent tokens', () => {
    const theme = read('src/themes/default-light.css')
    expect(theme).toMatch(/--lm-color-accent:\s*#4f46e5;/i)
    expect(theme).toMatch(/--lm-color-on-accent:\s*#ffffff;/i)
  })

  it('stays linked from index.html with a relative href', () => {
    expect(read('index.html')).toContain('<link rel="icon" type="image/svg+xml" href="./favicon.svg" />')
  })
})

describe('top bar brand tile', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the mark (not the layers icon) in the accent tile and keeps the labels', async () => {
    vi.useFakeTimers()
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/loras')
    const bar = mount(TopBar, { global: { plugins: [router] } })
    const home = bar.get('a[href="/loras"][aria-label]')
    expect(home.attributes('aria-label')).toBe('LoRA Manager home')
    expect(home.attributes('title')).toBe('LoRA Manager')
    expect(home.text()).toContain('LoRA Manager')
    const tile = home.get('span.bg-accent.text-on-accent')
    expect(tile.attributes('aria-hidden')).toBe('true')
    const svg = tile.get('svg')
    expect(svg.attributes('viewBox')).toBe('0 0 32 32')
    // A 28px mark draws its 2..30 glyph 24.5px wide in the 32px tile (~75%),
    // centred on whole pixels (2px inset on each side).
    expect(svg.attributes('width')).toBe('28')
    expect(svg.attributes('fill')).toBe('currentColor')
    expect(tile.get('path').attributes('d')).toBe(MARK_PATH)
    expect(tile.findAll('svg')).toHaveLength(1)
    bar.unmount()
  })
})
