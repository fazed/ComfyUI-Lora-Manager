/**
 * Entries of the shared context menu (`ModelActionMenu`) for the library
 * pages: one model, the current selection and a folder of the tree, plus the
 * dispatchers that turn a chosen entry into an action. Pure: labels come from
 * the i18n table, every side effect goes through the injected handlers, so the
 * menus are tested without a backend (`tests/menuItems.test.ts`).
 */
import type { IconName } from '@/components/icons'
import type { ModelItem } from '@/api/types'
import { civitaiModelUrl } from './civitai'
import { t, type MessageKey } from '@/i18n'

export type ModelAction = 'move' | 'rename' | 'template' | 'preview' | 'rating' | 'refresh' | 'relink' | 'exclude' | 'delete'

export interface ActionMenuItem {
  action: string
  label: string
  icon: IconName
  danger?: boolean
  /** External link: rendered as an anchor that opens in a new tab (no select event). */
  href?: string
  /** Draws a separator line above the entry. */
  divider?: boolean
  /** Shown but not selectable (`aria-disabled`, stays in the arrow-key order). */
  disabled?: boolean
  /** Display-only hint on the right, e.g. "Enter". */
  shortcut?: string
  /** Caption drawn above the entry; starts a labelled group (with `divider`, below the line). */
  group?: string
  /** Opens a submenu with these entries instead of selecting; the entry's own action is never emitted. */
  children?: ActionMenuItem[]
}

/** The model actions of the card menu and the drawer's "More actions" menu, in this order. */
export const MODEL_ITEMS: { action: ModelAction; label: MessageKey; icon: IconName; danger?: boolean }[] = [
  { action: 'move', label: 'actions.move', icon: 'folderMove' },
  { action: 'rename', label: 'actions.rename', icon: 'pencil' },
  { action: 'template', label: 'tools.template.open', icon: 'type' },
  { action: 'preview', label: 'tools.preview.open', icon: 'image' },
  { action: 'rating', label: 'tools.nsfw.open', icon: 'shield' },
  { action: 'refresh', label: 'tools.refresh.open', icon: 'refresh' },
  { action: 'relink', label: 'tools.relink.open', icon: 'link' },
  { action: 'exclude', label: 'actions.exclude', icon: 'eyeOff' },
  { action: 'delete', label: 'actions.delete', icon: 'trash', danger: true },
]

/** The model actions as menu entries; `divider` puts a line and the "Manage" caption above the first one. */
export function modelActionItems(divider = false): ActionMenuItem[] {
  return MODEL_ITEMS.map((entry, index) => ({
    ...entry,
    label: t(entry.label),
    divider: divider && index === 0,
    group: divider && index === 0 ? t('menu.groupManage') : undefined,
  }))
}

export interface ItemMenuContext {
  /** The library can send to a ComfyUI workflow (LoRAs). */
  canSend: boolean
  /** LoRA syntax can be copied. */
  isLora: boolean
  civitaiHost: string
}

/**
 * One model: Open, a "Send to ComfyUI" submenu with Append / Replace (when
 * sending is possible), Copy LoRA syntax (LoRAs), Favorite, View on Civitai
 * (with a model id), then the model actions under a "Manage" caption.
 */
export function itemMenu(item: ModelItem, ctx: ItemMenuContext): ActionMenuItem[] {
  const entries: ActionMenuItem[] = [{ action: 'open', label: t('menu.open'), icon: 'eye' }]
  if (ctx.canSend) {
    entries.push({
      action: 'sendMenu',
      label: t('detail.sendAppend'),
      icon: 'send',
      children: [
        { action: 'send', label: t('menu.sendAppend'), icon: 'send' },
        { action: 'replace', label: t('menu.sendReplace'), icon: 'layers' },
      ],
    })
  }
  if (ctx.isLora) entries.push({ action: 'copySyntax', label: t('detail.copySyntax'), icon: 'copy' })
  entries.push({ action: 'favorite', label: t(item.favorite ? 'menu.favoriteRemove' : 'menu.favoriteAdd'), icon: 'star' })
  const href = civitaiModelUrl(ctx.civitaiHost, item.civitai?.modelId, item.civitai?.id)
  if (href) entries.push({ action: 'civitai', label: t('detail.civitai'), icon: 'external', href, divider: true })
  return [...entries, ...modelActionItems(true)]
}

/** The selection: the bulk actions of the selection bar and its "More" menu, delete last. */
export function selectionMenu(count: number, ctx: { canSend: boolean }): ActionMenuItem[] {
  const disabled = count === 0
  const entries: ActionMenuItem[] = [
    { action: 'move', label: t('selection.move'), icon: 'folderMove' },
    { action: 'tags', label: t('selection.tags'), icon: 'tag' },
    { action: 'favorite', label: t('selection.favorite'), icon: 'star' },
    { action: 'template', label: t('selection.template'), icon: 'type' },
  ]
  if (ctx.canSend) {
    entries.push({ action: 'send', label: t('selection.send'), icon: 'send' })
    entries.push({ action: 'copySyntax', label: t('selection.copySyntax'), icon: 'copy' })
  }
  entries.push({ action: 'copyNames', label: t('selection.copyNames'), icon: 'copy' })
  entries.push({ action: 'delete', label: t('selection.delete'), icon: 'trash', danger: true, divider: true })
  return entries.map((entry) => ({ ...entry, disabled }))
}

/** Right-click on the grid background: Download, Select all, then the page's Tools entries. */
export function pageMenu(tools: { id: string; label: string; icon?: IconName }[]): ActionMenuItem[] {
  return [
    { action: 'download', label: t('download.open'), icon: 'download' },
    { action: 'selectAll', label: t('selection.all'), icon: 'checkSquare' },
    ...tools.map((tool, index) => ({ action: tool.id, label: tool.label, icon: tool.icon ?? ('wrench' as IconName), divider: index === 0 })),
  ]
}

/** A folder of the tree ('' = the library root: only a new folder is possible). */
export function folderMenu(path: string): ActionMenuItem[] {
  const disabled = !path
  return [
    { action: 'create', label: t(path ? 'folders.newSub' : 'folders.new'), icon: 'folderPlus' },
    { action: 'rename', label: t('folders.rename'), icon: 'pencil', disabled },
    { action: 'template', label: t('folders.template'), icon: 'type', disabled },
    { action: 'delete', label: t('folders.delete'), icon: 'trash', danger: true, divider: true, disabled },
  ]
}

/** Where `selected` lives after the folder `path` was renamed to `name` (unchanged when outside it). */
export function renamedFolderPath(selected: string, path: string, name: string): string {
  if (!path || (selected !== path && !selected.startsWith(`${path}/`))) return selected
  const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const renamed = parent ? `${parent}/${name}` : name
  return renamed + selected.slice(path.length)
}

export type ItemDialog = 'move' | 'rename' | 'template' | 'preview' | 'rating' | 'relink'

export interface ItemMenuDeps {
  /** Guarded flows: confirm + staged delete / Undo toast live inside them. */
  actions: { deleteItems: (items: ModelItem[]) => unknown; excludeItem: (item: ModelItem) => unknown }
  tools: { refreshFromCivitai: (item: ModelItem) => unknown }
  open: (item: ModelItem) => void
  send: (item: ModelItem, replace: boolean) => void
  copySyntax: (item: ModelItem) => void
  toggleFavorite: (item: ModelItem) => void
  /** Opens the dialog of an action that needs input first (nothing is changed yet). */
  dialog: (kind: ItemDialog, item: ModelItem) => void
}

const DIALOG_ACTIONS = new Set<string>(['move', 'rename', 'template', 'preview', 'rating', 'relink'])

/** Runs one entry of the item menu (or the drawer's More actions menu). Links and unknown ids do nothing. */
export function runItemMenuAction(action: string, item: ModelItem, deps: ItemMenuDeps): void {
  if (action === 'open') deps.open(item)
  else if (action === 'send' || action === 'replace') deps.send(item, action === 'replace')
  else if (action === 'copySyntax') deps.copySyntax(item)
  else if (action === 'favorite') deps.toggleFavorite(item)
  else if (DIALOG_ACTIONS.has(action)) deps.dialog(action as ItemDialog, item)
  else if (action === 'refresh') void deps.tools.refreshFromCivitai(item)
  else if (action === 'exclude') void deps.actions.excludeItem(item)
  else if (action === 'delete') void deps.actions.deleteItems([item])
}

export interface SelectionMenuDeps {
  move: (items: ModelItem[]) => void
  tags: (items: ModelItem[]) => void
  favorite: (items: ModelItem[]) => void
  template: (items: ModelItem[]) => void
  send: (items: ModelItem[]) => void
  copySyntax: (items: ModelItem[]) => void
  copyNames: (items: ModelItem[]) => void
  delete: (items: ModelItem[]) => void
}

/** Runs one entry of the selection menu on the selected items (nothing without a selection). */
export function runSelectionMenuAction(action: string, items: ModelItem[], deps: SelectionMenuDeps): void {
  if (!items.length || !Object.prototype.hasOwnProperty.call(deps, action)) return
  deps[action as keyof SelectionMenuDeps](items)
}
