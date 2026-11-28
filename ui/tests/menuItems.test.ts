/**
 * Shared context menus (item / selection / folder): the pure item builders,
 * the dispatchers that map a chosen entry to an action, the folder action
 * runner (pointed folder, not the selected one) and the card / tree / menu
 * component contracts. Written before the implementation. Every backend call
 * goes to a mocked object: nothing here touches a real library.
 */
import { describe, expect, it, vi } from 'vitest'
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils'
import type { ModelItem } from '@/api/types'
import { civitaiModelUrl } from '@/utils/civitai'
import {
  folderMenu,
  itemMenu,
  MODEL_ITEMS,
  renamedFolderPath,
  runItemMenuAction,
  runSelectionMenuAction,
  pageMenu,
  selectionMenu,
  type ItemMenuDeps,
  type SelectionMenuDeps,
} from '@/utils/menuItems'
import { createFolderActions, type FolderActionDeps } from '@/utils/folderActions'
import ModelActionMenu from '@/components/ModelActionMenu.vue'
import ModelCard from '@/components/ModelCard.vue'
import RecipeCard from '@/components/RecipeCard.vue'
import FolderTree from '@/components/FolderTree.vue'
import type { RecipeItem } from '@/api/types'

function item(overrides: Partial<ModelItem> = {}): ModelItem {
  return {
    model_name: 'Model A',
    file_name: 'model-a',
    file_path: 'D:/loras/styles/model-a.safetensors',
    folder: 'styles',
    preview_url: '',
    base_model: 'SDXL 1.0',
    ...overrides,
  }
}

const loraCtx = { canSend: true, isLora: true, civitaiHost: 'civitai.com' }
const checkpointCtx = { canSend: false, isLora: false, civitaiHost: 'civitai.com' }
const actionsOf = (entries: { action: string }[]) => entries.map((entry) => entry.action)

describe('civitaiModelUrl', () => {
  it('builds a model URL with the version and falls back to civitai.com for odd hosts', () => {
    expect(civitaiModelUrl('civitai.red', 12, 34)).toBe('https://civitai.red/models/12?modelVersionId=34')
    expect(civitaiModelUrl('civitai.com', 12, null)).toBe('https://civitai.com/models/12')
    expect(civitaiModelUrl('evil.com/x?', 12)).toBe('https://civitai.com/models/12')
    expect(civitaiModelUrl('civitai.com', null)).toBe('')
  })
})

describe('itemMenu', () => {
  it('lists the quick actions, the Civitai link and then every model action in order (LoRA)', () => {
    const entries = itemMenu(item({ civitai: { modelId: 5, id: 9 } as ModelItem['civitai'] }), loraCtx)
    expect(actionsOf(entries)).toEqual([
      'open',
      'sendMenu',
      'copySyntax',
      'favorite',
      'civitai',
      ...MODEL_ITEMS.map((entry) => entry.action),
    ])
    // Send is a submenu: Append / Replace.
    const send = entries.find((entry) => entry.action === 'sendMenu')!
    expect(actionsOf(send.children!)).toEqual(['send', 'replace'])
    expect(send.children!.map((entry) => entry.label)).toEqual(['Append to the node', 'Replace the LoRAs in the node'])
    const civitai = entries.find((entry) => entry.action === 'civitai')!
    expect(civitai.href).toBe('https://civitai.com/models/5?modelVersionId=9')
    expect(civitai.divider).toBe(true)
    // The first model action starts a new, labelled group.
    const move = entries.find((entry) => entry.action === 'move')!
    expect(move.divider).toBe(true)
    expect(move.group).toBe('Manage')
    expect(entries.find((entry) => entry.action === 'delete')!.danger).toBe(true)
  })

  it('leaves out the send submenu and copy syntax when the library cannot send, and Civitai without a model id', () => {
    const entries = itemMenu(item(), checkpointCtx)
    expect(actionsOf(entries)).toEqual(['open', 'favorite', ...MODEL_ITEMS.map((entry) => entry.action)])
    expect(entries.find((entry) => entry.action === 'move')!.divider).toBe(true)
  })

  it('names the favorite entry after the current state', () => {
    expect(itemMenu(item({ favorite: false }), checkpointCtx).find((e) => e.action === 'favorite')!.label).toBe('Add to favorites')
    expect(itemMenu(item({ favorite: true }), checkpointCtx).find((e) => e.action === 'favorite')!.label).toBe(
      'Remove from favorites',
    )
  })
})

describe('pageMenu', () => {
  it('offers Download and Select all, then the Tools entries under a line', () => {
    const entries = pageMenu([{ id: 'organize', label: 'Auto-organize', icon: 'wand' }, { id: 'rebuild', label: 'Rebuild cache' }])
    expect(actionsOf(entries)).toEqual(['download', 'selectAll', 'organize', 'rebuild'])
    expect(entries.map((entry) => !!entry.divider)).toEqual([false, false, true, false])
    expect(entries[3].icon).toBe('wrench')
  })
})

describe('selectionMenu', () => {
  it('mirrors the selection bar (send only where sending is possible), delete last and dangerous', () => {
    expect(actionsOf(selectionMenu(3, { canSend: true }))).toEqual(['move', 'tags', 'favorite', 'template', 'send', 'copySyntax', 'copyNames', 'delete'])
    const entries = selectionMenu(3, { canSend: false })
    expect(actionsOf(entries)).toEqual(['move', 'tags', 'favorite', 'template', 'copyNames', 'delete'])
    expect(entries.at(-1)).toMatchObject({ danger: true, divider: true })
  })

  it('disables every entry while nothing is selected', () => {
    expect(selectionMenu(0, { canSend: true }).every((entry) => entry.disabled)).toBe(true)
    expect(selectionMenu(2, { canSend: true }).some((entry) => entry.disabled)).toBe(false)
  })
})

describe('folderMenu', () => {
  it('offers subfolder, rename, template and delete for a folder', () => {
    const entries = folderMenu('styles/anime')
    expect(actionsOf(entries)).toEqual(['create', 'rename', 'template', 'delete'])
    expect(entries[0].label).toBe('New subfolder…')
    expect(entries.at(-1)).toMatchObject({ danger: true, divider: true })
    expect(entries.some((entry) => entry.disabled)).toBe(false)
  })

  it('only allows a new folder at the library root', () => {
    const entries = folderMenu('')
    expect(entries[0]).toMatchObject({ action: 'create', label: 'New folder…' })
    expect(entries.slice(1).every((entry) => entry.disabled)).toBe(true)
  })
})

describe('renamedFolderPath', () => {
  it('follows a renamed folder for the selection and its children', () => {
    expect(renamedFolderPath('styles/anime', 'styles/anime', 'manga')).toBe('styles/manga')
    expect(renamedFolderPath('styles/anime/old', 'styles/anime', 'manga')).toBe('styles/manga/old')
    expect(renamedFolderPath('top', 'top', 'renamed')).toBe('renamed')
    expect(renamedFolderPath('other', 'styles/anime', 'manga')).toBe('other')
    expect(renamedFolderPath('styles/animex', 'styles/anime', 'manga')).toBe('styles/animex')
  })
})

function itemDeps(): ItemMenuDeps {
  return {
    actions: { deleteItems: vi.fn(async () => true), excludeItem: vi.fn(async () => true) },
    tools: { refreshFromCivitai: vi.fn(async () => true) },
    open: vi.fn(),
    send: vi.fn(),
    copySyntax: vi.fn(),
    toggleFavorite: vi.fn(),
    dialog: vi.fn(),
  } as unknown as ItemMenuDeps
}

describe('runItemMenuAction', () => {
  it('runs delete and exclude through the guarded model actions only', () => {
    const deps = itemDeps()
    const target = item()
    runItemMenuAction('delete', target, deps)
    expect(deps.actions.deleteItems).toHaveBeenCalledTimes(1)
    expect(deps.actions.deleteItems).toHaveBeenCalledWith([target])
    runItemMenuAction('exclude', target, deps)
    expect(deps.actions.excludeItem).toHaveBeenCalledWith(target)
    expect(deps.dialog).not.toHaveBeenCalled()
  })

  it('opens dialogs for move, rename, template, preview, rating and relink without calling the backend', () => {
    const deps = itemDeps()
    const target = item()
    for (const action of ['move', 'rename', 'template', 'preview', 'rating', 'relink'] as const) runItemMenuAction(action, target, deps)
    expect((deps.dialog as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])).toEqual([
      'move',
      'rename',
      'template',
      'preview',
      'rating',
      'relink',
    ])
    expect(deps.actions.deleteItems).not.toHaveBeenCalled()
    expect(deps.actions.excludeItem).not.toHaveBeenCalled()
  })

  it('maps the quick actions', () => {
    const deps = itemDeps()
    const target = item()
    runItemMenuAction('open', target, deps)
    runItemMenuAction('send', target, deps)
    runItemMenuAction('replace', target, deps)
    runItemMenuAction('copySyntax', target, deps)
    runItemMenuAction('favorite', target, deps)
    runItemMenuAction('refresh', target, deps)
    expect(deps.open).toHaveBeenCalledWith(target)
    expect(deps.send).toHaveBeenNthCalledWith(1, target, false)
    expect(deps.send).toHaveBeenNthCalledWith(2, target, true)
    expect(deps.copySyntax).toHaveBeenCalledWith(target)
    expect(deps.toggleFavorite).toHaveBeenCalledWith(target)
    expect(deps.tools.refreshFromCivitai).toHaveBeenCalledWith(target)
  })

  it('ignores unknown actions and links (handled by the anchor)', () => {
    const deps = itemDeps()
    runItemMenuAction('civitai', item(), deps)
    runItemMenuAction('nope', item(), deps)
    for (const fn of [deps.open, deps.send, deps.copySyntax, deps.toggleFavorite, deps.dialog, deps.actions.deleteItems]) {
      expect(fn).not.toHaveBeenCalled()
    }
  })
})

describe('runSelectionMenuAction', () => {
  function deps(): SelectionMenuDeps {
    return {
      move: vi.fn(),
      tags: vi.fn(),
      favorite: vi.fn(),
      template: vi.fn(),
      send: vi.fn(),
      copySyntax: vi.fn(),
      copyNames: vi.fn(),
      delete: vi.fn(),
    }
  }

  it('hands the selected items to the matching bulk handler', () => {
    const handlers = deps()
    const items = [item(), item({ file_path: 'D:/loras/b.safetensors', file_name: 'b' })]
    for (const action of ['move', 'tags', 'favorite', 'template', 'send', 'copySyntax', 'copyNames', 'delete']) runSelectionMenuAction(action, items, handlers)
    for (const fn of Object.values(handlers)) expect(fn).toHaveBeenCalledWith(items)
  })

  it('does nothing without a selection (no empty bulk delete)', () => {
    const handlers = deps()
    runSelectionMenuAction('delete', [], handlers)
    expect(handlers.delete).not.toHaveBeenCalled()
  })
})

function folderDeps(candidates: { folder_path: string; root: string }[] = [{ folder_path: 'D:/loras/styles/anime', root: 'D:/loras' }]) {
  const deps = {
    api: {
      resolveFolder: vi.fn(async () => candidates),
      roots: vi.fn(async () => ['D:/loras']),
    },
    tools: { deleteFolder: vi.fn(async () => true) },
    toasts: { error: vi.fn() },
    openDialog: vi.fn(),
    openTemplate: vi.fn(),
    deleted: vi.fn(),
  }
  return deps as typeof deps & FolderActionDeps
}

describe('createFolderActions', () => {
  it('resolves and deletes the pointed folder (dry-run probe stays inside tools.deleteFolder)', async () => {
    const deps = folderDeps()
    await createFolderActions(deps).run('delete', 'styles/anime')
    expect(deps.api.resolveFolder).toHaveBeenCalledWith('styles/anime')
    expect(deps.tools.deleteFolder).toHaveBeenCalledTimes(1)
    expect(deps.tools.deleteFolder).toHaveBeenCalledWith('D:/loras/styles/anime', 'anime')
    expect(deps.deleted).toHaveBeenCalledWith('styles/anime')
  })

  it('refuses a folder that exists in several roots and never calls delete', async () => {
    const deps = folderDeps([
      { folder_path: 'D:/loras/styles', root: 'D:/loras' },
      { folder_path: 'E:/more/styles', root: 'E:/more' },
    ])
    await createFolderActions(deps).run('delete', 'styles')
    expect(deps.tools.deleteFolder).not.toHaveBeenCalled()
    expect(deps.toasts.error).toHaveBeenCalledTimes(1)
    expect(deps.deleted).not.toHaveBeenCalled()
  })

  it('reports a folder that is gone and does nothing else', async () => {
    const deps = folderDeps([])
    await createFolderActions(deps).run('delete', 'styles/old')
    expect(deps.tools.deleteFolder).not.toHaveBeenCalled()
    expect(deps.toasts.error).toHaveBeenCalledTimes(1)
  })

  it('does not report a deletion the user cancelled', async () => {
    const deps = folderDeps()
    deps.tools.deleteFolder.mockResolvedValueOnce(false)
    await createFolderActions(deps).run('delete', 'styles/anime')
    expect(deps.deleted).not.toHaveBeenCalled()
  })

  it('refuses rename, template and delete without a folder', async () => {
    const deps = folderDeps()
    for (const id of ['rename', 'template', 'delete']) await createFolderActions(deps).run(id, '')
    expect(deps.api.resolveFolder).not.toHaveBeenCalled()
    expect(deps.tools.deleteFolder).not.toHaveBeenCalled()
    expect(deps.toasts.error).toHaveBeenCalledTimes(3)
  })

  it('opens the dialogs for the pointed folder', async () => {
    const deps = folderDeps()
    const runner = createFolderActions(deps)
    await runner.run('rename', 'styles/anime')
    expect(deps.openDialog).toHaveBeenLastCalledWith({ mode: 'rename', locations: ['D:/loras/styles/anime'], currentName: 'anime', path: 'styles/anime' })
    await runner.run('create', 'styles/anime')
    expect(deps.openDialog).toHaveBeenLastCalledWith({ mode: 'create', locations: ['D:/loras/styles/anime'], path: 'styles/anime' })
    await runner.run('create', '')
    expect(deps.api.roots).toHaveBeenCalledTimes(1)
    expect(deps.openDialog).toHaveBeenLastCalledWith({ mode: 'create', locations: ['D:/loras'], path: '' })
    await runner.run('template', 'styles/anime')
    expect(deps.openTemplate).toHaveBeenCalledWith(['D:/loras/styles/anime'], 'styles/anime')
    expect(deps.tools.deleteFolder).not.toHaveBeenCalled()
  })
})

describe('ModelActionMenu', () => {
  it('shows a heading, shortcut text and a disabled entry that never selects', async () => {
    const wrapper = mount(ModelActionMenu, {
      attachTo: document.body,
      props: {
        x: 10,
        y: 10,
        label: 'Actions for 3 selected models',
        heading: '3 selected',
        items: [
          { action: 'open', label: 'Open', icon: 'eye', shortcut: 'Enter' },
          { action: 'move', label: 'Move…', icon: 'folderMove', disabled: true },
        ],
      },
    })
    await flushPromises()
    // The menu is teleported to <body> by the Reka UI DropdownMenu.
    const body = new DOMWrapper(document.body)
    expect(body.get('[role="menu"]').attributes('aria-label')).toBe('Actions for 3 selected models')
    expect(body.text()).toContain('3 selected')
    expect(body.text()).toContain('Enter')
    const entries = body.findAll('[role="menuitem"]')
    expect(entries[1].attributes('aria-disabled')).toBe('true')
    await entries[1].trigger('click')
    expect(wrapper.emitted('select')).toBeUndefined()
    await entries[0].trigger('click')
    expect(wrapper.emitted('select')).toEqual([['open']])
    await flushPromises()
    expect(wrapper.emitted('close')).toEqual([['select']])
    wrapper.unmount()
  })

  it('draws group captions and opens the Send submenu, whose entries select their own action', async () => {
    const wrapper = mount(ModelActionMenu, {
      attachTo: document.body,
      props: { x: 10, y: 10, label: 'Menu', items: itemMenu(item(), loraCtx) },
    })
    await flushPromises()
    const body = new DOMWrapper(document.body)
    expect(body.text()).toContain('Manage')
    const trigger = body.findAll('[role="menuitem"]').find((entry) => entry.text().includes('Send to ComfyUI'))!
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    trigger.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await flushPromises()
    const replace = body.findAll('[role="menuitem"]').find((entry) => entry.text().includes('Replace the LoRAs'))!
    await replace.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['replace']])
    wrapper.unmount()
  })

  it('reports Escape as the close reason (the caller refocuses the opener)', async () => {
    const wrapper = mount(ModelActionMenu, { attachTo: document.body, props: { x: 10, y: 10, label: 'Menu' } })
    await flushPromises()
    document.body.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(wrapper.emitted('close')).toEqual([['escape']])
    wrapper.unmount()
  })
})

const cardProps = { item: item(), selectionMode: false, selected: false, blurMature: false }

describe('cards', () => {
  it('opens the menu on right-click even in selection mode', async () => {
    const wrapper = mount(ModelCard, { props: { ...cardProps, selectionMode: true } })
    await wrapper.get('article').trigger('contextmenu', { clientX: 40, clientY: 50 })
    expect(wrapper.emitted('menu')?.[0]?.[1]).toEqual({ x: 40, y: 50 })
  })

  it('toggles the selection with Ctrl/Cmd+click outside selection mode', async () => {
    const wrapper = mount(ModelCard, { props: cardProps })
    const button = wrapper.get('article > button')
    await button.trigger('click', { ctrlKey: true })
    await button.trigger('click', { metaKey: true })
    expect(wrapper.emitted('toggle-select')).toHaveLength(2)
    expect(wrapper.emitted('open')).toBeUndefined()
    await button.trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  it('does the same on recipe cards', async () => {
    const recipe = { id: 'r1', title: 'Recipe', file_url: '', loras: [] } as unknown as RecipeItem
    const wrapper = mount(RecipeCard, { props: { item: recipe, selectionMode: true, selected: false, blurMature: false } })
    await wrapper.get('article').trigger('contextmenu', { clientX: 1, clientY: 2 })
    expect(wrapper.emitted('menu')).toHaveLength(1)
    await wrapper.setProps({ selectionMode: false } as never)
    await wrapper.get('article > button').trigger('click', { ctrlKey: true })
    expect(wrapper.emitted('toggle-select')).toHaveLength(1)
  })
})

describe('FolderTree', () => {
  it('emits a menu event with the pointed path (nested rows included) and translated toggle labels', async () => {
    const wrapper = mount(FolderTree, { props: { tree: { styles: { anime: {} } }, selected: 'styles/anime' } })
    expect(wrapper.find('button[aria-label="Collapse styles"]').exists()).toBe(true)
    const rows = wrapper.findAll('[data-folder-path]')
    expect(rows.map((row) => row.attributes('data-folder-path'))).toEqual(['styles', 'styles/anime'])
    await rows[1].trigger('contextmenu', { clientX: 5, clientY: 6 })
    const event = wrapper.emitted('menu')?.[0]
    expect(event?.[0]).toBe('styles/anime')
    expect(event?.[1]).toEqual({ x: 5, y: 6 })
  })
})
