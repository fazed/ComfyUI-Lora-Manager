/**
 * The keyboard shortcuts of the app, in one list: the Help dialog renders it
 * and the controls take their `aria-keyshortcuts` from it, so Help never lists
 * a key that does not work. Add an entry here together with its handler.
 */
import type { MessageKey } from '@/i18n'

export type ShortcutScope = 'global' | 'library' | 'grid' | 'details' | 'viewer'

export interface Shortcut {
  /** Keys as shown in Help, one `<kbd>` per entry (alternatives). */
  keys: string[]
  /** `aria-keyshortcuts` value (WAI-ARIA key names). */
  aria: string
  label: MessageKey
  scope: ShortcutScope
}

export const SHORTCUTS = {
  search: { keys: ['/', 'Ctrl K'], aria: '/ Control+K', label: 'shortcuts.search', scope: 'global' },
  help: { keys: ['?'], aria: 'Shift+?', label: 'shortcuts.help', scope: 'global' },
  escape: { keys: ['Esc'], aria: 'Escape', label: 'shortcuts.escape', scope: 'global' },
  toasts: { keys: ['Alt T'], aria: 'Alt+T', label: 'shortcuts.toasts', scope: 'global' },
  filters: { keys: ['F'], aria: 'F', label: 'shortcuts.filters', scope: 'library' },
  localSearch: { keys: ['Ctrl F'], aria: 'Control+F', label: 'shortcuts.localSearch', scope: 'library' },
  select: { keys: ['B'], aria: 'B', label: 'shortcuts.select', scope: 'library' },
  selectAll: { keys: ['Ctrl A'], aria: 'Control+A', label: 'shortcuts.selectAll', scope: 'library' },
  download: { keys: ['D'], aria: 'D', label: 'shortcuts.download', scope: 'library' },
  letter: { keys: ['Alt A-Z'], aria: 'Alt+A', label: 'shortcuts.letter', scope: 'library' },
  refresh: { keys: ['R'], aria: 'R', label: 'shortcuts.refresh', scope: 'library' },
  move: { keys: ['← ↑ → ↓'], aria: 'ArrowLeft ArrowUp ArrowRight ArrowDown', label: 'shortcuts.move', scope: 'grid' },
  jump: { keys: ['Home', 'End', 'PgUp', 'PgDn'], aria: 'Home End PageUp PageDown', label: 'shortcuts.jump', scope: 'grid' },
  toggle: { keys: ['Space', 'Shift Space'], aria: 'Space Shift+Space', label: 'shortcuts.toggle', scope: 'grid' },
  open: { keys: ['Enter'], aria: 'Enter', label: 'shortcuts.open', scope: 'grid' },
  send: { keys: ['S', 'Shift S'], aria: 'S Shift+S', label: 'shortcuts.send', scope: 'grid' },
  copy: { keys: ['C'], aria: 'C', label: 'shortcuts.copy', scope: 'grid' },
  favorite: { keys: ['F'], aria: 'F', label: 'shortcuts.favorite', scope: 'grid' },
  delete: { keys: ['Del'], aria: 'Delete', label: 'shortcuts.delete', scope: 'grid' },
  menu: { keys: ['Shift F10'], aria: 'Shift+F10', label: 'shortcuts.menu', scope: 'grid' },
  prev: { keys: ['←', 'K'], aria: 'ArrowLeft Alt+ArrowLeft K', label: 'shortcuts.prev', scope: 'details' },
  next: { keys: ['→', 'J'], aria: 'ArrowRight Alt+ArrowRight J', label: 'shortcuts.next', scope: 'details' },
  detailsDelete: { keys: ['Del'], aria: 'Delete', label: 'shortcuts.detailsDelete', scope: 'details' },
  viewerStep: { keys: ['←', '→'], aria: 'ArrowLeft ArrowRight', label: 'shortcuts.viewerStep', scope: 'viewer' },
} as const satisfies Record<string, Shortcut>

export const SHORTCUT_SCOPES: { scope: ShortcutScope; label: MessageKey }[] = [
  { scope: 'global', label: 'shortcuts.scope.global' },
  { scope: 'library', label: 'shortcuts.scope.library' },
  { scope: 'grid', label: 'shortcuts.scope.grid' },
  { scope: 'details', label: 'shortcuts.scope.details' },
  { scope: 'viewer', label: 'shortcuts.scope.viewer' },
]
