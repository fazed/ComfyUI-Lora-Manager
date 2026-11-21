<script setup lang="ts">
/**
 * One model in the compact list ("Rows") view: same props, events and
 * pointer behaviour as ModelCard (shared useCardInteractions), laid out as a
 * row of fixed-width columns so rows line up like a table. The send / favorite
 * / menu buttons are always visible. Phone: name on the first line, base model
 * and size on the second; folder, date and tags are dropped.
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
import { t } from '@/i18n'

// Shared contract with ModelCard (see modelItemView.ts).
const props = defineProps<ModelItemViewProps>()
const emit = defineEmits<ModelItemViewEmits>()

const root = ref<HTMLElement | null>(null)
const { activate, openMenuFromButton, openContextMenu } = useCardInteractions<ModelItem>({
  item: () => props.item,
  target: root,
  selectionMode: () => props.selectionMode,
  open: (item) => emit('open', item),
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
const blurred = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature))
// A smaller blur than the card: the thumbnail is only --lm-row-thumb wide.
const mediaClass = computed(() => ['lm-zoom-media size-full object-cover', blurred.value && 'scale-110 blur-[6px]'])

/** Trailing icon buttons: 32px with a mouse, the 44px touch target on phones / touch screens. */
const iconButton = 'lm-btn lm-btn--ghost lm-btn--icon size-[32px] min-h-0 phone:size-touch touch:size-touch'
const cell = 'pointer-events-none relative flex-none text-xs text-muted tabular-nums'

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
    :class="selected ? 'border-accent bg-accent-soft ring-selected' : 'border-border bg-surface hover:bg-sunken'"
    @mouseenter="play"
    @mouseleave="pause"
    @contextmenu="openContextMenu"
  >
    <button
      type="button"
      class="absolute inset-0 z-1 cursor-pointer rounded-[inherit] focus-visible:-outline-offset-3"
      :aria-label="selectionMode ? t('card.selectItem', { name: displayName }) : t('card.open', { name: displayName })"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="activate"
      @focus="play"
      @blur="pause"
    ></button>
    <span
      v-if="selectionMode"
      data-selection-indicator
      class="pointer-events-none relative z-2 inline-grid size-[20px] flex-none place-items-center rounded-sm border-2"
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
      <template #fallback><AppIcon name="image" :size="16" /></template>
    </LazyMedia>
    <div class="pointer-events-none relative min-w-0 flex-1">
      <p class="flex min-w-0 items-center gap-2 text-sm leading-tight font-medium">
        <span class="truncate" :title="displayName">{{ displayName }}</span>
        <span v-if="item.update_available" class="lm-badge lm-badge--accent flex-none"><AppIcon name="arrowUp" :size="12" />{{ t('card.update') }}</span>
      </p>
      <p class="mt-px truncate text-xs leading-tight text-muted phone:hidden" :title="folderText">{{ folderText }}</p>
      <p class="mt-px hidden min-w-0 items-center gap-2 text-xs leading-tight text-muted phone:flex">
        <span v-if="item.base_model" class="lm-badge min-w-0 truncate">{{ item.base_model }}</span>
        <span class="flex-none tabular-nums">{{ sizeText }}</span>
      </p>
    </div>
    <span :class="[cell, 'w-[140px] phone:hidden']">
      <span v-if="item.base_model" class="lm-badge max-w-full truncate" :title="item.base_model">{{ item.base_model }}</span>
    </span>
    <span :class="[cell, 'w-[72px] text-right phone:hidden']">{{ sizeText }}</span>
    <span :class="[cell, 'w-[150px] truncate @max-[820px]:hidden']">{{ dateText }}</span>
    <span :class="[cell, 'w-[200px] truncate @max-[1060px]:hidden']" :title="tagsText">{{ tagsText }}</span>
    <div class="relative z-2 flex flex-none items-center gap-1 phone:gap-0">
      <button
        v-if="canSend"
        type="button"
        :class="[iconButton, 'phone:hidden']"
        :aria-label="t('card.sendToComfy')"
        :title="t('card.sendHint')"
        @click.stop="emit('send', item, $event.shiftKey)"
      >
        <AppIcon name="send" :size="15" />
      </button>
      <button
        type="button"
        :class="[iconButton, item.favorite ? 'text-warning' : '']"
        :aria-label="t('detail.toggleFavorite')"
        :aria-pressed="!!item.favorite"
        @click.stop="emit('toggle-favorite', item)"
      >
        <AppIcon name="star" :size="16" :filled="!!item.favorite" />
      </button>
      <button
        type="button"
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
