/**
 * Folder actions of the library folder panel (header "..." menu and the
 * right-click menu of a tree row). They always act on the folder passed in
 * (the pointed one), never implicitly on the selected folder. Delete keeps the
 * existing rules: the folder is resolved to its absolute path(s), a folder in
 * several roots is refused, and `tools.deleteFolder` runs the dry-run probe
 * and the danger confirm before anything is removed.
 */
import type { FolderCandidate } from '@/api/types'
import { t } from '@/i18n'

export interface FolderDialogRequest {
  mode: 'create' | 'rename'
  locations: string[]
  currentName?: string
  /** Relative folder the dialog was opened for ('' = library root). */
  path: string
}

export interface FolderActionDeps {
  api: { resolveFolder: (folder: string) => Promise<FolderCandidate[]>; roots: () => Promise<string[]> }
  tools: { deleteFolder: (folderPath: string, label: string) => Promise<boolean> }
  toasts: { error: (message: string) => unknown }
  openDialog: (request: FolderDialogRequest) => void
  openTemplate: (folderPaths: string[], path: string) => void
  /** The folder `path` was deleted (the page clears a selection inside it). */
  deleted: (path: string) => void
}

const nameOf = (path: string) => path.split('/').pop() ?? path

export function createFolderActions(deps: FolderActionDeps) {
  /** Absolute paths of `path` (one per root that holds it); null after an error toast. */
  async function candidates(path: string): Promise<string[] | null> {
    try {
      const found = await deps.api.resolveFolder(path)
      if (!found.length) {
        deps.toasts.error(t('folders.refused.missing', { name: nameOf(path) }))
        return null
      }
      return found.map((candidate) => candidate.folder_path)
    } catch (error) {
      deps.toasts.error(t('folders.resolveFailed', { error: (error as Error).message }))
      return null
    }
  }

  async function run(id: string, path: string): Promise<void> {
    if (id === 'create') {
      const locations = path ? await candidates(path) : await deps.api.roots().catch(() => null)
      if (locations?.length) deps.openDialog({ mode: 'create', locations, path })
      return
    }
    if (id !== 'rename' && id !== 'template' && id !== 'delete') return
    if (!path) {
      deps.toasts.error(t('folders.noFolder'))
      return
    }
    const locations = await candidates(path)
    if (!locations) return
    const name = nameOf(path)
    if (id === 'rename') deps.openDialog({ mode: 'rename', locations, currentName: name, path })
    else if (id === 'template') deps.openTemplate(locations, path)
    else if (locations.length > 1) deps.toasts.error(t('folders.refused.refused', { name, error: locations.join(', ') }))
    else if (await deps.tools.deleteFolder(locations[0], name)) deps.deleted(path)
  }

  return { run }
}
