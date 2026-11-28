/** Per-model-type configuration for the generic library page. */

import type { ModelPrefix } from '@/api/types'
import type { MessageKey } from '@/i18n'

export interface SortOption {
  value: string
  label: MessageKey
}

export interface LibraryConfig {
  prefix: ModelPrefix
  /** Singular type name used by settings keys such as default_<singular>_root. */
  singular: 'lora' | 'checkpoint' | 'embedding'
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
  /** Alphabet bar: the list endpoint honours `first_letter` (only the LoRA routes parse it). */
  alphabet: boolean
}

// Sort keys of py/services/model_query.py parse_sort / base_model_service._sort_entries.
// `random` is a seeded shuffle (seed "random" when none is given), stable across pages.
const COMMON_SORTS: SortOption[] = [
  { value: 'name:asc', label: 'library.sort.nameAsc' },
  { value: 'name:desc', label: 'library.sort.nameDesc' },
  { value: 'date:desc', label: 'library.sort.dateDesc' },
  { value: 'date:asc', label: 'library.sort.dateAsc' },
  { value: 'published:desc', label: 'library.sort.publishedDesc' },
  { value: 'published:asc', label: 'library.sort.publishedAsc' },
  { value: 'size:desc', label: 'library.sort.sizeDesc' },
  { value: 'size:asc', label: 'library.sort.sizeAsc' },
  { value: 'usage:desc', label: 'library.sort.usageDesc' },
  { value: 'usage:asc', label: 'library.sort.usageAsc' },
  { value: 'random', label: 'library.sort.random' },
]

export const LIBRARIES: Record<ModelPrefix, LibraryConfig> = {
  loras: {
    prefix: 'loras',
    singular: 'lora',
    title: 'nav.loras',
    classicPath: 'loras',
    defaultSort: 'name:asc',
    sortOptions: COMMON_SORTS,
    supportsUpdates: true,
    quickBaseModels: 8,
    sendToComfy: true,
    alphabet: true,
  },
  checkpoints: {
    prefix: 'checkpoints',
    singular: 'checkpoint',
    title: 'nav.checkpoints',
    classicPath: 'checkpoints',
    defaultSort: 'name:asc',
    sortOptions: COMMON_SORTS,
    supportsUpdates: true,
    quickBaseModels: 8,
    sendToComfy: false,
    alphabet: false,
  },
  embeddings: {
    prefix: 'embeddings',
    singular: 'embedding',
    title: 'nav.embeddings',
    classicPath: 'embeddings',
    defaultSort: 'name:asc',
    sortOptions: COMMON_SORTS,
    supportsUpdates: true,
    quickBaseModels: 0,
    sendToComfy: false,
    alphabet: false,
  },
}
