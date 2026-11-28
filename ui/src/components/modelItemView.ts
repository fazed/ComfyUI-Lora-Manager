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
import { DEFAULT_CARD_SHOW, type CardFit, type CardShow } from '@/composables/useLibraryFilters'

/** View options that reach the cards: "Show on cards" plus the image fit. */
export type CardDisplay = CardShow & { fit: CardFit }

export const DEFAULT_CARD_DISPLAY: CardDisplay = { ...DEFAULT_CARD_SHOW, fit: 'cover' }

/** Number of text lines a card shows under its image (the grid adds their height to every cell). */
export function cardTextLines(display: CardDisplay): number {
  return [display.name, display.meta, display.versionRow, display.tags].filter(Boolean).length
}

export interface ModelItemViewProps {
  item: ModelItem
  selectionMode: boolean
  selected: boolean
  blurMature: boolean
  /** LoRA actions: "Send to ComfyUI" and "Copy LoRA syntax". */
  canSend?: boolean
  /** Quick view is showing: a single click focuses the item, double-click / Enter opens the details. */
  quickView?: boolean
  /** The item shown in the quick view (selection outline). */
  focused?: boolean
  /** Mature preview revealed by the user for this session. */
  revealed?: boolean
  /** Card view options (default: DEFAULT_CARD_DISPLAY). */
  display?: CardDisplay
  /** Civitai host for "View on Civitai" (no link without it or without a Civitai model id). */
  civitaiHost?: string
  /** The grid's one tab stop (roving tabindex); false = every button of the item leaves the tab order. Default true. */
  tabbable?: boolean
}

export type ModelItemViewEmits = {
  open: [item: ModelItem]
  /** Quick view: a single click shows the item in the inspector. */
  focus: [item: ModelItem]
  /** shift = Shift+click: select a range from the last toggled item (Ctrl/Cmd+click also toggles outside selection mode). */
  'toggle-select': [item: ModelItem, shift: boolean]
  'toggle-favorite': [item: ModelItem]
  /** replace = Shift+click (replace the node's LoRAs instead of appending). */
  send: [item: ModelItem, replace: boolean]
  /** Copy the LoRA syntax. */
  copy: [item: ModelItem]
  /** Show / hide a blurred mature preview. */
  reveal: [item: ModelItem]
  /** Open the context menu at a viewport point (also in selection mode); `opener` gets focus back when it closes. */
  menu: [item: ModelItem, point: MenuPoint, opener: HTMLElement | null]
}
