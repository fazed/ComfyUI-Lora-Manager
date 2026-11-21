<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { ModelItem } from '@/api/types'
import { useCardInteractions } from '@/composables/useCardInteractions'
import type { ModelItemViewEmits, ModelItemViewProps } from './modelItemView'
import { withMountPrefix } from '@/utils/basePath'
import { isBlurred } from '@/utils/mature'
import { t } from '@/i18n'

// Shared contract with ModelRow (see modelItemView.ts).
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
const blurred = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature))
const tags = computed(() => (props.item.tags ?? []).slice(0, 3))
// Blurred media keeps its own fixed scale (the utility wins over the hover zoom).
const mediaClass = computed(() => ['lm-zoom-media size-full object-cover', blurred.value && 'scale-110 blur-[18px]'])

const pillClass =
  'inline-flex min-w-0 max-w-[60%] shrink items-center gap-[2px] overflow-hidden rounded-pill px-2 py-px text-xs font-medium text-ellipsis whitespace-nowrap'
/** Round 28px button/indicator in the top-right corner (favorite star, selection check). */
const roundClass = 'inline-grid size-[28px] cursor-pointer place-items-center rounded-pill'
/** Hover-revealed corner buttons: always visible on touch devices and while focused. */
const revealClass = 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 touch:opacity-100'

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
    class="group select-none [-webkit-touch-callout:none] lm-zoom-host relative h-full overflow-hidden rounded-md hairline bg-sunken transition-[box-shadow,border-color]"
    :class="selected ? 'border-accent ring-selected' : 'border-border shadow-sm hover:shadow-md'"
    @mouseenter="play"
    @mouseleave="pause"
    @contextmenu="openContextMenu"
  >
    <button
      type="button"
      class="absolute inset-0 z-2 cursor-pointer rounded-[inherit] focus-visible:-outline-offset-3"
      :aria-label="selectionMode ? t('card.selectItem', { name: displayName }) : t('card.open', { name: displayName })"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="activate"
      @focus="play"
      @blur="pause"
    ></button>
    <LazyMedia ref="media" class="absolute! inset-0" :src="previewUrl" :media-class="mediaClass" loop>
      <template #fallback>
        <span class="flex flex-col items-center justify-center gap-2 text-xs">
          <AppIcon name="image" :size="32" />
          <span>{{ t('card.noPreview') }}</span>
        </span>
      </template>
    </LazyMedia>
    <div class="pointer-events-none absolute inset-x-2 top-2 z-3 flex items-start gap-1">
      <span v-if="item.base_model" :class="[pillClass, 'bg-scrim text-on-scrim']">{{ item.base_model }}</span>
      <span v-if="item.update_available" :class="[pillClass, 'bg-accent text-on-accent']">
        <AppIcon name="arrowUp" :size="12" />{{ t('card.update') }}
      </span>
      <span class="flex-1"></span>
      <span
        v-if="selectionMode"
        :class="[
          roundClass,
          'pointer-events-none border-2',
          selected ? 'border-accent bg-accent text-on-accent' : 'border-on-scrim bg-scrim text-on-scrim',
        ]"
        aria-hidden="true"
      >
        <AppIcon v-if="selected" name="check" :size="14" />
      </span>
      <button
        v-if="!selectionMode && canSend"
        type="button"
        :class="[roundClass, 'pointer-events-auto bg-scrim text-on-scrim transition-opacity hover:bg-accent hover:text-on-accent', revealClass]"
        :aria-label="t('card.sendToComfy')"
        :title="t('card.sendHint')"
        @click.stop="emit('send', item, $event.shiftKey)"
      >
        <AppIcon name="send" :size="15" />
      </button>
      <button
        v-if="!selectionMode"
        type="button"
        :class="[
          roundClass,
          'pointer-events-auto bg-scrim transition-opacity',
          item.favorite ? 'text-warning' : ['text-on-scrim', revealClass],
        ]"
        :aria-label="t('detail.toggleFavorite')"
        :aria-pressed="!!item.favorite"
        @click.stop="emit('toggle-favorite', item)"
      >
        <AppIcon name="star" :size="16" :filled="!!item.favorite" />
      </button>
      <button
        v-if="!selectionMode"
        type="button"
        :class="[roundClass, 'pointer-events-auto bg-scrim text-on-scrim transition-opacity hover:bg-accent hover:text-on-accent', revealClass]"
        :aria-label="t('actions.menu', { name: displayName })"
        :title="t('actions.menuTitle')"
        aria-haspopup="menu"
        @click.stop="openMenuFromButton"
      >
        <AppIcon name="more" :size="16" />
      </button>
    </div>
    <div class="pointer-events-none absolute inset-x-0 bottom-0 z-1 bg-scrim-fade px-3 pt-10 pb-3 text-on-scrim">
      <p class="line-clamp-2 text-sm font-bold" :title="displayName">{{ displayName }}</p>
      <p v-if="tags.length" class="mt-1 truncate text-xs opacity-85">{{ tags.join(' · ') }}</p>
    </div>
  </article>
</template>
