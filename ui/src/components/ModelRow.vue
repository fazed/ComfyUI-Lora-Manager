<script setup lang="ts">
/**
 * One model in the compact list ("Rows") view: same props, events and
 * pointer behaviour as ModelCard (shared useCardInteractions), laid out as a
 * row of fixed-width columns (rem, so they follow the text size) that line up
 * with the list header (ListHeader.vue). The send / copy / favorite / menu
 * buttons are always visible. Phone: name on the first line, base model and
 * size on the second; folder, date and tags are dropped.
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { ModelItem } from '@/api/types'
import { useCardInteractions } from '@/composables/useCardInteractions'
import type { ModelItemViewEmits, ModelItemViewProps } from './modelItemView'
import { withMountPrefix } from '@/utils/basePath'
import { formatBytes, formatDateTime } from '@/utils/format'
import { isBlurred } from '@/utils/mature'
import { ROW_COLUMN_HIDE_CLASS, rowTooltip } from '@/utils/rowColumns'
import { t } from '@/i18n'

// Shared contract with ModelCard (see modelItemView.ts).
const props = defineProps<ModelItemViewProps>()
const emit = defineEmits<ModelItemViewEmits>()
/** Inner buttons are reachable with Tab only on the grid's active item (one tab stop per grid). */
const innerTab = computed(() => (props.tabbable === false ? -1 : undefined))

const root = ref<HTMLElement | null>(null)
const { activate, openMenuFromButton, openContextMenu } = useCardInteractions<ModelItem>({
  item: () => props.item,
  target: root,
  selectionMode: () => props.selectionMode,
  quickView: () => !!props.quickView,
  open: (item) => emit('open', item),
  focus: (item) => emit('focus', item),
  toggle: (item, shift) => emit('toggle-select', item, shift),
  menu: (item, point, opener) => emit('menu', item, point, opener),
})

const media = ref<InstanceType<typeof LazyMedia> | null>(null)
const video = computed(() => (media.value?.element instanceof HTMLVideoElement ? media.value.element : null))
const previewUrl = computed(() => (props.item.preview_url ? withMountPrefix(props.item.preview_url) : ''))
const displayName = computed(() => props.item.model_name || props.item.file_name)
const folderText = computed(() => props.item.folder || t('row.rootFolder'))
const sizeText = computed(() => (props.item.file_size ? formatBytes(props.item.file_size) : ''))
const dateText = computed(() => (props.item.modified ? formatDateTime(props.item.modified) : ''))
const tagsText = computed(() => (props.item.tags ?? []).slice(0, 3).join(' · '))
/** Every cell in full (also hidden columns): the tooltip of the full-row button. */
const tooltip = computed(() =>
  rowTooltip(props.item, { folder: folderText.value, size: sizeText.value, date: dateText.value, tags: tagsText.value }),
)
const blurred = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature) && !props.revealed)
// A smaller blur than the card: the thumbnail is only --lm-row-thumb wide.
const mediaClass = computed(() => ['lm-zoom-media size-full object-cover', blurred.value && 'scale-110 blur-[6px]'])

/** Trailing icon buttons: 2rem with a mouse, the 44px touch target on phones / touch screens. */
const iconButton = 'lm-btn lm-btn--ghost lm-btn--icon size-[2rem] min-h-0 phone:size-touch touch:size-touch'
/** Cells do not take the pointer: clicks and hover go to the full-row button (its title shows the whole row). */
const cellBase = 'pointer-events-none relative text-xs text-muted tabular-nums'
const cell = `${cellBase} flex-none`

function play(): void {
  void video.value?.play().catch(() => undefined)
}

function pause(): void {
  video.value?.pause()
}
</script>

<template>
  <article
    ref="root"
    class="group select-none [-webkit-touch-callout:none] @container lm-zoom-host relative flex h-full items-center gap-3 rounded-md hairline px-2 transition-[background-color,border-color] phone:gap-2"
    :class="selected || focused ? 'border-accent bg-accent-soft ring-selected' : 'border-border bg-surface hover:bg-sunken'"
    @mouseenter="play"
    @mouseleave="pause"
    @contextmenu="openContextMenu"
  >
    <button
      type="button"
      data-grid-primary
      :tabindex="tabbable === false ? -1 : 0"
      class="absolute inset-0 z-1 cursor-pointer rounded-[inherit] focus-visible:-outline-offset-3"
      :aria-label="selectionMode ? t('card.selectItem', { name: displayName }) : t('card.open', { name: displayName })"
      :aria-pressed="selectionMode ? selected : undefined"
      :aria-current="focused && !selectionMode ? 'true' : undefined"
      :title="tooltip"
      @click="activate"
      @focus="play"
      @blur="pause"
    ></button>
    <span
      v-if="selectionMode"
      data-selection-indicator
      class="pointer-events-none relative z-2 inline-grid size-[1.25rem] flex-none place-items-center rounded-sm border-2"
      :class="selected ? 'border-accent bg-accent text-on-accent' : 'border-field-border bg-field'"
      aria-hidden="true"
    >
      <AppIcon v-if="selected" name="check" :size="12" />
    </span>
    <LazyMedia
      ref="media"
      class="pointer-events-none relative size-[var(--lm-row-thumb)] flex-none overflow-hidden rounded-sm"
      :src="previewUrl"
      :media-class="mediaClass"
      :data-blurred="blurred || undefined"
      loop
    >
      <template #fallback="{ broken }">
        <AppIcon :name="broken ? 'alert' : 'image'" :size="16" :label="broken ? t('card.previewBroken') : ''" />
      </template>
    </LazyMedia>
    <div class="pointer-events-none relative min-w-[6rem] flex-1">
      <p class="flex min-w-0 items-center gap-2 text-sm leading-tight font-medium">
        <span data-cell="name" class="truncate" :title="displayName">{{ displayName }}</span>
        <span
          v-if="item.update_available"
          class="lm-badge lm-badge--accent pointer-events-auto relative z-2 flex-none cursor-pointer"
          :title="t('library.updatesFlagHint')"
          data-testid="update-flag"
          @click="activate"
        ><AppIcon name="arrowUp" :size="12" />{{ t('card.update') }}</span>
      </p>
      <p data-cell="folder" class="mt-px truncate text-xs leading-tight text-muted phone:hidden" :title="folderText">{{ folderText }}</p>
      <p class="mt-px hidden min-w-0 items-center gap-2 text-xs leading-tight text-muted phone:flex">
        <span v-if="item.base_model" class="lm-badge min-w-0" :title="item.base_model"><span class="truncate">{{ item.base_model }}</span></span>
        <span class="flex-none tabular-nums">{{ sizeText }}</span>
      </p>
    </div>
    <!-- Width token --lm-row-badge-max-width; the cell may shrink (badge ellipsis) before the name drops below its minimum. -->
    <span data-cell="base-model" :class="[cellBase, 'flex w-(--lm-row-badge-max-width) min-w-0 shrink phone:hidden']">
      <span v-if="item.base_model" class="lm-badge max-w-full min-w-0" :title="item.base_model"><span class="truncate">{{ item.base_model }}</span></span>
    </span>
    <span data-cell="size" :class="[cell, 'w-[4.5rem] truncate text-right phone:hidden']" :title="sizeText">{{ sizeText }}</span>
    <span data-cell="date" :class="[cell, 'w-[9.375rem] truncate', ROW_COLUMN_HIDE_CLASS.date]" :title="dateText">{{ dateText }}</span>
    <span data-cell="tags" :class="[cell, 'w-[12.5rem] truncate', ROW_COLUMN_HIDE_CLASS.tags]" :title="tagsText">{{ tagsText }}</span>
    <div class="relative z-2 flex flex-none items-center gap-1 phone:gap-0">
      <template v-if="canSend">
        <button
          type="button"
          :tabindex="innerTab"
          :class="[iconButton, 'phone:hidden']"
          :aria-label="t('card.sendToComfy')"
          :title="t('card.sendHint')"
          @click.stop="emit('send', item, $event.shiftKey)"
        >
          <AppIcon name="send" :size="15" />
        </button>
        <button type="button" :tabindex="innerTab" :class="[iconButton, 'phone:hidden']" :aria-label="t('detail.copySyntax')" :title="t('detail.copySyntax')" @click.stop="emit('copy', item)">
          <AppIcon name="copy" :size="15" />
        </button>
      </template>
      <button
        type="button"
        :tabindex="innerTab"
        :class="[iconButton, item.favorite ? 'text-accent' : '']"
        :aria-label="t('detail.toggleFavorite')"
        :aria-pressed="!!item.favorite"
        @click.stop="emit('toggle-favorite', item)"
      >
        <AppIcon name="star" :size="16" :filled="!!item.favorite" />
      </button>
      <button
        type="button"
        :tabindex="innerTab"
        :class="iconButton"
        :aria-label="t('actions.menu', { name: displayName })"
        :title="t('actions.menuTitle')"
        aria-haspopup="menu"
        @click.stop="openMenuFromButton"
      >
        <AppIcon name="more" :size="16" />
      </button>
    </div>
  </article>
</template>
