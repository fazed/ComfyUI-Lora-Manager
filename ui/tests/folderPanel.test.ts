/**
 * Folder panel (FolderPanel + FolderTree): Collapse all, tree / list view
 * (remembered), "Find a folder", the view-options menu (include subfolders,
 * folder actions) and the tree's single tab stop with arrow keys.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DOMWrapper, flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import FolderPanel from '@/components/FolderPanel.vue'
import type { FolderTree } from '@/api/types'

const tree: FolderTree = { styles: { anime: { chibi: {} }, photo: {} }, characters: { heroes: {} }, misc: {} }

let wrapper: VueWrapper | null = null

beforeEach(() => localStorage.clear())
afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

function mountPanel(props: Record<string, unknown> = {}) {
  wrapper = mount(FolderPanel, {
    props: { id: 'folders-loras', tree, selected: 'styles/anime/chibi', recursive: true, ...props },
    attachTo: document.body,
  })
  return wrapper
}

const paths = (w: VueWrapper) => w.findAll('[data-folder-path]').map((row) => row.attributes('data-folder-path'))

describe('FolderPanel', () => {
  it('opens the branches that hold the selection and closes every branch on Collapse all', async () => {
    const panel = mountPanel()
    expect(paths(panel)).toEqual(['characters', 'misc', 'styles', 'styles/anime', 'styles/anime/chibi', 'styles/photo'])
    await panel.get('button[aria-label="Collapse all"]').trigger('click')
    expect(paths(panel)).toEqual(['characters', 'misc', 'styles'])
    const items = panel.findAll('[role="treeitem"]')
    expect(items.filter((item) => item.attributes('aria-expanded') !== undefined).every((item) => item.attributes('aria-expanded') === 'false')).toBe(true)
  })

  it('switches to a flat list of full paths and remembers it', async () => {
    const panel = mountPanel()
    await panel.get('button[aria-label="Folder view options"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const items = new DOMWrapper(document.body).findAll('[role="menuitemcheckbox"]')
    expect(items.map((item) => item.text())).toEqual(['Tree view', 'List view', 'Include subfolders'])
    await items[1].trigger('click')
    await flushPromises()
    expect(paths(panel)).toEqual(['characters', 'characters/heroes', 'misc', 'styles', 'styles/anime', 'styles/anime/chibi', 'styles/photo'])
    expect(panel.find('[data-folder-path] button[aria-hidden="true"]').exists()).toBe(false)
    expect(localStorage.getItem('lm-ui.folders.view')).toBe('list')
    panel.unmount()
    wrapper = null
    expect(paths(mountPanel())).toHaveLength(7)
  })

  it('finds folders by path and says when nothing matches', async () => {
    const panel = mountPanel()
    await panel.get('input[type="search"]').setValue('HER')
    expect(paths(panel)).toEqual(['characters/heroes'])
    await panel.get('input[type="search"]').setValue('nothing')
    expect(paths(panel)).toEqual([])
    expect(panel.text()).toContain('No matching folder.')
  })

  it('toggles "Include subfolders" and forwards the folder actions from the view options', async () => {
    const panel = mountPanel({ actions: [{ id: 'create', label: 'New subfolder…' }, { id: 'rename', label: 'Rename folder…' }] })
    // The 'create' action doubles as the header's New folder button.
    await panel.get('button[aria-label="New folder"]').trigger('click')
    expect(panel.emitted('action')?.[0]).toEqual(['create'])
    await panel.get('button[aria-label="Folder view options"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    const body = new DOMWrapper(document.body)
    await body.findAll('[role="menuitemcheckbox"]')[2].trigger('click')
    expect(panel.emitted('update:recursive')?.[0]).toEqual([false])
    await panel.get('button[aria-label="Folder view options"]').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await body.findAll('[role="menuitem"]').find((item) => item.text() === 'Rename folder…')!.trigger('click')
    expect(panel.emitted('action')?.[1]).toEqual(['rename'])
  })
})

describe('FolderTree keyboard', () => {
  it('has one tab stop and moves, opens and closes with the arrow keys', async () => {
    const panel = mountPanel({ selected: '' })
    const stops = () => panel.findAll('[role="treeitem"]').filter((item) => item.attributes('tabindex') === '0')
    expect(stops().map((item) => item.text())).toEqual(['characters'])
    const first = panel.get('[role="treeitem"]')
    ;(first.element as HTMLElement).focus()
    await first.trigger('keydown', { key: 'ArrowRight' })
    expect(paths(panel)).toContain('characters/heroes')
    await first.trigger('keydown', { key: 'ArrowDown' })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim()).toBe('heroes')
    expect(stops().map((item) => item.text())).toEqual(['heroes'])
    await panel.findAll('[role="treeitem"]')[1].trigger('keydown', { key: 'ArrowLeft' })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim()).toBe('characters')
    await panel.findAll('[role="treeitem"]')[0].trigger('keydown', { key: 'ArrowLeft' })
    expect(paths(panel)).not.toContain('characters/heroes')
    await panel.findAll('[role="treeitem"]')[0].trigger('keydown', { key: 'End' })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim()).toBe('styles')
  })

  it('selects with a click and keeps emitting the folder menu on right-click', async () => {
    const panel = mountPanel()
    await panel.findAll('[role="treeitem"]')[0].trigger('click')
    expect(panel.emitted('select')?.[0]).toEqual(['characters'])
    await panel.findAll('[data-folder-path]')[1].trigger('contextmenu', { clientX: 5, clientY: 6 })
    expect(panel.emitted('menu')?.[0]?.slice(0, 2)).toEqual(['misc', { x: 5, y: 6 }])
  })
})
