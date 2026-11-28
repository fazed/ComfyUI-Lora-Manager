<script setup lang="ts">
/**
 * Recipe card: the image box (base model, favourite state, the hover action
 * bar with Favorite, "Send to ComfyUI" (Shift = replace) and the action menu,
 * the mature-content "Show" overlay) and two fixed lines below it: the title
 * and the LoRA availability (all in library / N missing / N unavailable).
 * Same interaction model and text-block height rule as ModelCard
 * (the page passes `cardTextHeight(2)` to the grid).
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { RecipeItem } from '@/api/types'
import { useCardInteractions, type MenuPoint } from '@/composables/useCardInteractions'
import type { CardFit } from '@/composables/useLibraryFilters'
import { withMountPrefix } from '@/utils/basePath'
import { isBlurred } from '@/utils/mature'
import { availability } from '@/utils/recipes'
import { t } from '@/i18n'

const props = defineProps<{ item: RecipeItem; selectionMode: boolean; selected: boolean; blurMature: boolean; fit?: CardFit; revealed?: boolean }>()
const emit = defineEmits<{
  open: [item: RecipeItem]
  /** shift = Shift+click: select a range from the last toggled card (Ctrl/Cmd+click also toggles outside selection mode). */
  'toggle-select': [item: RecipeItem, shift: boolean]
  'toggle-favorite': [item: RecipeItem]
  send: [item: RecipeItem, replace: boolean]
  reveal: [item: RecipeItem]
  menu: [item: RecipeItem, point: MenuPoint, opener: HTMLElement | null]
}>()

const media = ref<InstanceType<typeof LazyMedia> | null>(null)
const video = computed(() => (media.value?.element instanceof HTMLVideoElement ? media.value.element : null))
const previewUrl = computed(() => (props.item.file_url ? withMountPrefix(props.item.file_url) : ''))
const title = computed(() => props.item.title || props.item.id)
const blurred = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature) && !props.revealed)
const mediaClass = computed(() => [
  'lm-zoom-media size-full',
  props.fit === 'contain' ? 'object-contain' : 'object-cover',
  blurred.value && 'scale-110 blur-[18px]',
])
const status = computed(() => availability(props.item.loras ?? []))
const statusLabel = computed(() => {
  const value = status.value
  if (!value.total) return t('recipes.card.noLoras')
  if (value.missing) return t('recipes.card.missing', { missing: value.missing, total: value.total })
  if (value.deleted) return t('recipes.card.unavailable', { count: value.deleted, total: value.total })
  return t('recipes.loras', { count: value.total })
})
const statusClass = computed(() => (status.value.missing ? 'text-warning' : status.value.deleted ? 'text-danger' : 'text-muted'))

const actionClass =
  'pointer-events-auto inline-grid size-[1.875rem] cursor-pointer place-items-center rounded-sm text-on-scrim hover:bg-accent hover:text-on-accent'
const lineClass = 'h-[1.25rem] truncate leading-[1.25rem]'

const root = ref<HTMLElement | null>(null)
const { activate, openMenuFromButton, openContextMenu } = useCardInteractions<RecipeItem>({
  item: () => props.item,
  target: root,
  selectionMode: () => props.selectionMode,
  open: (item) => emit('open', item),
  toggle: (item, shift) => emit('toggle-select', item, shift),
  menu: (item, point, opener) => emit('menu', item, point, opener),
})
</script>

<template>
  <article
    ref="root"
    class="group relative flex h-full flex-col select-none [-webkit-touch-callout:none] lm-zoom-host"
    @mouseenter="video?.play().catch(() => undefined)"
    @mouseleave="video?.pause()"
    @contextmenu="openContextMenu"
  >
    <button
      type="button"
      class="absolute inset-0 z-2 cursor-pointer rounded-md focus-visible:-outline-offset-3"
      :aria-label="selectionMode ? t('card.selectItem', { name: title }) : t('recipes.card.open', { name: title })"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="activate"
    ></button>
    <div
      class="relative min-h-0 flex-1 overflow-hidden rounded-md hairline bg-sunken transition-[box-shadow,border-color]"
      :class="selected ? 'border-accent ring-selected' : 'border-border group-hover:border-border-strong'"
    >
      <LazyMedia ref="media" class="absolute! inset-0" :src="previewUrl" :media-class="mediaClass" loop>
        <template #fallback="{ broken }">
          <span class="flex flex-col items-center justify-center gap-2 px-2 text-center text-xs" :data-preview="broken ? 'broken' : 'none'">
            <AppIcon :name="broken ? 'alert' : 'book'" :size="32" />
            <span>{{ broken ? t('card.previewBroken') : t('card.noPreview') }}</span>
          </span>
        </template>
      </LazyMedia>
      <div v-if="blurred" class="pointer-events-none absolute inset-0 z-3 grid place-content-center justify-items-center gap-2 p-2 text-center text-sm text-on-scrim">
        <span class="rounded-sm bg-scrim px-2 py-px">{{ t('card.mature') }}</span>
        <button type="button" class="lm-btn lm-btn--sm pointer-events-auto" :aria-label="`${t('card.show')}: ${title}`" @click.stop="emit('reveal', item)">
          <AppIcon name="eye" :size="14" />{{ t('card.show') }}
        </button>
      </div>
      <div class="pointer-events-none absolute inset-x-2 top-2 z-3 flex items-start gap-1">
        <span
          v-if="selectionMode"
          class="inline-grid size-[1.375rem] flex-none place-items-center rounded-sm border-2"
          :class="selected ? 'border-accent bg-accent text-on-accent' : 'border-on-scrim bg-scrim text-on-scrim'"
          aria-hidden="true"
        >
          <AppIcon v-if="selected" name="check" :size="14" />
        </span>
        <span v-if="item.base_model" class="min-w-0 truncate rounded-sm bg-scrim px-2 py-px text-xs font-medium text-on-scrim">{{ item.base_model }}</span>
        <span
          v-if="item.favorite"
          class="inline-grid size-[1.5rem] flex-none place-items-center rounded-sm bg-scrim text-on-scrim"
          role="img"
          :aria-label="t('card.favorite')"
          :title="t('card.favorite')"
        >
          <AppIcon name="star" :size="13" filled />
        </span>
      </div>
      <div
        v-if="!selectionMode"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-3 flex items-center gap-[0.125rem] bg-scrim p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100"
      >
        <button
          type="button"
          :class="actionClass"
          :aria-label="t('detail.toggleFavorite')"
          :title="t('detail.toggleFavorite')"
          :aria-pressed="!!item.favorite"
          @click.stop="emit('toggle-favorite', item)"
        >
          <AppIcon name="star" :size="16" :filled="!!item.favorite" />
        </button>
        <span class="flex-1" aria-hidden="true"></span>
        <button
          type="button"
          :class="[actionClass, 'phone:hidden']"
          :aria-label="t('recipes.send')"
          :title="t('recipes.sendHint')"
          @click.stop="emit('send', item, $event.shiftKey)"
        >
          <AppIcon name="send" :size="15" />
        </button>
        <button
          type="button"
          :class="actionClass"
          :aria-label="t('actions.menu', { name: title })"
          :title="t('actions.menuTitle')"
          aria-haspopup="menu"
          @click.stop="openMenuFromButton"
        >
          <AppIcon name="more" :size="16" />
        </button>
      </div>
    </div>
    <div class="pointer-events-none flex-none px-[0.125rem] pt-[0.5rem]">
      <p :class="[lineClass, 'text-sm font-medium']">{{ title }}</p>
      <p :class="[lineClass, 'flex items-center gap-1 text-xs', statusClass]">
        <AppIcon v-if="status.missing || status.deleted" name="alert" :size="12" />{{ statusLabel }}
      </p>
    </div>
  </article>
</template>
