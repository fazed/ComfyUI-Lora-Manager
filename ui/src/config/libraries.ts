/** Per-model-type configuration for the generic library page. */

import type { ModelPrefix } from '@/api/types'
import type { MessageKey } from '@/i18n'

export interface SortOption {
  value: string
  label: MessageKey
}

export interface LibraryConfig {
  prefix: ModelPrefix
  title: MessageKey
  /** Classic UI page (relative to the mount root). */
  classicPath: string
  defaultSort: string
  sortOptions: SortOption[]
  supportsUpdates: boolean
  /** Base-model chip row under the toolbar (0 disables it; N = chips before "More"). */
  quickBaseModels: number
  /** "Send to ComfyUI" / "Copy LoRA syntax" on cards and in the drawer. */
  sendToComfy: boolean
}

const COMMON_SORTS: SortOption[] = [
  { value: 'name:asc', label: 'library.sort.nameAsc' },
  { value: 'name:desc', label: 'library.sort.nameDesc' },
  { value: 'date:desc', label: 'library.sort.dateDesc' },
  { value: 'date:asc', label: 'library.sort.dateAsc' },
  { value: 'size:desc', label: 'library.sort.sizeDesc' },
  { value: 'size:asc', label: 'library.sort.sizeAsc' },
  { value: 'usage:desc', label: 'library.sort.usageDesc' },
]

export const LIBRARIES: Record<ModelPrefix, LibraryConfig> = {
  loras: {
    prefix: 'loras',
    title: 'nav.loras',
    classicPath: 'loras',
    defaultSort: 'name:asc',
    sortOptions: COMMON_SORTS,
    supportsUpdates: true,
    quickBaseModels: 8,
    sendToComfy: true,
  },
  checkpoints: {
    prefix: 'checkpoints',
    title: 'nav.checkpoints',
    classicPath: 'checkpoints',
    defaultSort: 'name:asc',
    sortOptions: COMMON_SORTS,
    supportsUpdates: true,
    quickBaseModels: 8,
    sendToComfy: false,
  },
  embeddings: {
    prefix: 'embeddings',
    title: 'nav.embeddings',
    classicPath: 'embeddings',
    defaultSort: 'name:asc',
    sortOptions: COMMON_SORTS,
    supportsUpdates: true,
    quickBaseModels: 0,
    sendToComfy: false,
  },
}
