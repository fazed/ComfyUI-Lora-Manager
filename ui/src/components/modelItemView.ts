/**
 * The one props/emits contract of the two views of a library item: the card
 * (`ModelCard.vue`, grid) and the row (`ModelRow.vue`, list). Both components
 * declare `defineProps<ModelItemViewProps>()` and
 * `defineEmits<ModelItemViewEmits>()`, LibraryPage renders them in explicit
 * typed branches, and `tests/listView.test.ts` asserts at compile time that
 * both components expose exactly the same props and events, so a renamed
 * prop, event or handler fails `vue-tsc` instead of silently doing nothing.
 */
import type { ModelItem } from '@/api/types'
import type { MenuPoint } from '@/composables/useCardInteractions'

export interface ModelItemViewProps {
  item: ModelItem
  selectionMode: boolean
  selected: boolean
  blurMature: boolean
  /** Show the "Send to ComfyUI" button (LoRAs). */
  canSend?: boolean
}

export type ModelItemViewEmits = {
  open: [item: ModelItem]
  /** shift = Shift+click: select a range from the last toggled item (Ctrl/Cmd+click also toggles outside selection mode). */
  'toggle-select': [item: ModelItem, shift: boolean]
  'toggle-favorite': [item: ModelItem]
  /** replace = Shift+click (replace the node's LoRAs instead of appending). */
  send: [item: ModelItem, replace: boolean]
  /** Open the context menu at a viewport point (also in selection mode); `opener` gets focus back when it closes. */
  menu: [item: ModelItem, point: MenuPoint, opener: HTMLElement | null]
}
