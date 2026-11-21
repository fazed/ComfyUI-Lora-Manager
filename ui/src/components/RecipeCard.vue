<script setup lang="ts">
/**
 * Recipe card: preview, base model, LoRA availability (all in library /
 * N missing / N unavailable), favorite, "Send to ComfyUI" (Shift = replace)
 * and the action menu. Same interaction model as ModelCard.
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { RecipeItem } from '@/api/types'
import { withMountPrefix } from '@/utils/basePath'
import { availability } from '@/utils/recipes'
import { t } from '@/i18n'

const props = defineProps<{ item: RecipeItem; selectionMode: boolean; selected: boolean; blurMature: boolean }>()
const emit = defineEmits<{
  open: [item: RecipeItem]
  /** shift = Shift+click (select a range from the last toggled card). */
  /** shift = Shift+click: select a range from the last toggled card. */
  'toggle-select': [item: RecipeItem, shift: boolean]
  'toggle-favorite': [item: RecipeItem]
  send: [item: RecipeItem, replace: boolean]
  menu: [item: RecipeItem, point: { x: number; y: number }, opener: HTMLElement | null]
}>()

const media = ref<InstanceType<typeof LazyMedia> | null>(null)
const video = computed(() => (media.value?.element instanceof HTMLVideoElement ? media.value.element : null))
const previewUrl = computed(() => (props.item.file_url ? withMountPrefix(props.item.file_url) : ''))
const title = computed(() => props.item.title || props.item.id)
const blurred = computed(() => props.blurMature && (props.item.preview_nsfw_level ?? 0) >= 4)
const mediaClass = computed(() => ['lm-zoom-media size-full object-cover', blurred.value && 'scale-110 blur-[18px]'])
const status = computed(() => availability(props.item.loras ?? []))
const statusLabel = computed(() => {
  const value = status.value
  if (!value.total) return t('recipes.card.noLoras')
  if (value.missing) return t('recipes.card.missing', { missing: value.missing, total: value.total })
  if (value.deleted) return t('recipes.card.unavailable', { count: value.deleted, total: value.total })
  return t('recipes.loras', { count: value.total })
})
const statusClass = computed(() =>
  status.value.missing ? 'bg-warning text-on-danger' : status.value.deleted ? 'bg-danger text-on-danger' : 'bg-scrim text-on-scrim',
)

const pillClass =
  'inline-flex min-w-0 max-w-[60%] shrink items-center gap-[2px] overflow-hidden rounded-pill px-2 py-px text-xs font-medium text-ellipsis whitespace-nowrap'
const roundClass = 'inline-grid size-[28px] cursor-pointer place-items-center rounded-pill'
const revealClass = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch:opacity-100'

function activate(event: MouseEvent): void {
  if (props.selectionMode) emit('toggle-select', props.item, event.shiftKey)
  else emit('open', props.item)
}

function openMenuFromButton(event: MouseEvent): void {
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  emit('menu', props.item, { x: rect.right - 220, y: rect.bottom + 4 }, button)
}

function openContextMenu(event: MouseEvent): void {
  if (props.selectionMode) return
  event.preventDefault()
  emit('menu', props.item, { x: event.clientX, y: event.clientY }, event.currentTarget instanceof HTMLElement ? event.currentTarget.querySelector('button') : null)
}
</script>

<template>
  <article
    class="group lm-zoom-host relative h-full overflow-hidden rounded-md hairline bg-sunken transition-[box-shadow,border-color]"
    :class="selected ? 'border-accent ring-selected' : 'border-border shadow-sm hover:shadow-md'"
    @mouseenter="video?.play().catch(() => undefined)"
    @mouseleave="video?.pause()"
    @contextmenu="openContextMenu"
  >
    <button
      type="button"
      class="absolute inset-0 z-2 cursor-pointer rounded-[inherit] focus-visible:-outline-offset-3"
      :aria-label="selectionMode ? t('card.selectItem', { name: title }) : t('recipes.card.open', { name: title })"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="activate"
    ></button>
    <LazyMedia ref="media" class="absolute! inset-0" :src="previewUrl" :media-class="mediaClass" loop>
      <template #fallback>
        <span class="flex flex-col items-center justify-center gap-2 text-xs">
          <AppIcon name="book" :size="32" />
          <span>{{ t('card.noPreview') }}</span>
        </span>
      </template>
    </LazyMedia>
    <div class="pointer-events-none absolute inset-x-2 top-2 z-3 flex items-start gap-1">
      <span v-if="item.base_model" :class="[pillClass, 'bg-scrim text-on-scrim']">{{ item.base_model }}</span>
      <span class="flex-1"></span>
      <span
        v-if="selectionMode"
        :class="[roundClass, 'pointer-events-none border-2', selected ? 'border-accent bg-accent text-on-accent' : 'border-on-scrim bg-scrim text-on-scrim']"
        aria-hidden="true"
      >
        <AppIcon v-if="selected" name="check" :size="14" />
      </span>
      <template v-else>
        <button
          type="button"
          :class="[roundClass, 'pointer-events-auto bg-scrim text-on-scrim transition-opacity hover:bg-accent hover:text-on-accent phone:hidden', revealClass]"
          :aria-label="t('recipes.send')"
          :title="t('recipes.sendHint')"
          @click.stop="emit('send', item, $event.shiftKey)"
        >
          <AppIcon name="send" :size="15" />
        </button>
        <button
          type="button"
          :class="[roundClass, 'pointer-events-auto bg-scrim transition-opacity', item.favorite ? 'text-warning' : ['text-on-scrim', revealClass]]"
          :aria-label="t('detail.toggleFavorite')"
          :aria-pressed="!!item.favorite"
          @click.stop="emit('toggle-favorite', item)"
        >
          <AppIcon name="star" :size="16" :filled="!!item.favorite" />
        </button>
        <button
          type="button"
          :class="[roundClass, 'pointer-events-auto bg-scrim text-on-scrim transition-opacity hover:bg-accent hover:text-on-accent', revealClass]"
          :aria-label="t('actions.menu', { name: title })"
          :title="t('actions.menuTitle')"
          aria-haspopup="menu"
          @click.stop="openMenuFromButton"
        >
          <AppIcon name="more" :size="16" />
        </button>
      </template>
    </div>
    <div class="pointer-events-none absolute inset-x-0 bottom-0 z-1 bg-scrim-fade px-3 pt-10 pb-3 text-on-scrim">
      <p class="line-clamp-2 text-sm font-bold" :title="title">{{ title }}</p>
      <div class="mt-1 flex items-center gap-1">
        <span :class="[pillClass, 'max-w-full', statusClass]">
          <AppIcon v-if="status.missing || status.deleted" name="alert" :size="12" />{{ statusLabel }}
        </span>
      </div>
    </div>
  </article>
</template>
