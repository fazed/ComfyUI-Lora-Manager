<script setup lang="ts">
/**
 * One model in the card grid: the image box (base-model badge, state icons
 * and the update flag on top, a hover / focus action bar at the bottom, the
 * mature-content "Show" overlay) and, below it, the lines chosen in the View
 * popover (name, size and usage, version row, tags). The text block has a
 * fixed height per line (`cardTextHeight` in utils/gridLayout.ts), so the
 * virtual grid knows the cell height without measuring.
 */
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { ModelItem } from '@/api/types'
import { useCardInteractions } from '@/composables/useCardInteractions'
import { DEFAULT_CARD_DISPLAY, type ModelItemViewEmits, type ModelItemViewProps } from './modelItemView'
import { withMountPrefix } from '@/utils/basePath'
import { civitaiModelUrl } from '@/utils/civitai'
import { formatBytes } from '@/utils/format'
import { isBlurred } from '@/utils/mature'
import { t } from '@/i18n'

// Shared contract with ModelRow (see modelItemView.ts).
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
const display = computed(() => props.display ?? DEFAULT_CARD_DISPLAY)
const previewUrl = computed(() => (props.item.preview_url ? withMountPrefix(props.item.preview_url) : ''))
const displayName = computed(() => props.item.model_name || props.item.file_name)
const mature = computed(() => isBlurred(props.item.preview_nsfw_level, props.blurMature))
const blurred = computed(() => mature.value && !props.revealed)
const civitaiUrl = computed(() => (props.civitaiHost ? civitaiModelUrl(props.civitaiHost, props.item.civitai?.modelId, props.item.civitai?.id) : ''))
const metaText = computed(() =>
  [props.item.file_size ? formatBytes(props.item.file_size) : '', t('card.used', { count: props.item.usage_count ?? 0 })].filter(Boolean).join(' · '),
)
const modes = computed(() => (props.item.auto_tags ?? []).filter((tag) => tag === 'HIGH' || tag === 'LOW'))
const versionCount = computed(() => props.item.version_count ?? 0)
const tagsText = computed(() => (props.item.tags ?? []).slice(0, 3).join(' · '))
// Blurred media keeps its own fixed scale (the utility wins over the hover zoom).
const mediaClass = computed(() => [
  'lm-zoom-media size-full',
  display.value.fit === 'contain' ? 'object-contain' : 'object-cover',
  blurred.value && 'scale-110 blur-[18px]',
])

/** Small square state icon / toggle on the image (favorite, skipped, excluded, blur toggle). */
const stateClass = 'pointer-events-auto inline-grid size-[1.5rem] flex-none place-items-center rounded-sm bg-scrim text-on-scrim'
/** Buttons of the hover action bar. */
const actionClass =
  'pointer-events-auto inline-grid size-[1.875rem] cursor-pointer place-items-center rounded-sm text-on-scrim hover:bg-accent hover:text-on-accent'
/** A fixed-height line of the text block (cardTextHeight). */
const lineClass = 'h-[1.25rem] truncate leading-[1.25rem]'

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
    class="group relative flex h-full flex-col select-none [-webkit-touch-callout:none] lm-zoom-host"
    @mouseenter="play"
    @mouseleave="pause"
    @contextmenu="openContextMenu"
  >
    <button
      type="button"
      data-grid-primary
      :tabindex="tabbable === false ? -1 : 0"
      class="absolute inset-0 z-2 cursor-pointer rounded-md focus-visible:-outline-offset-3"
      :aria-label="selectionMode ? t('card.selectItem', { name: displayName }) : t('card.open', { name: displayName })"
      :aria-pressed="selectionMode ? selected : undefined"
      :aria-current="focused && !selectionMode ? 'true' : undefined"
      :title="display.name ? undefined : displayName"
      @click="activate"
      @focus="play"
      @blur="pause"
    ></button>
    <div
      class="relative min-h-0 flex-1 overflow-hidden rounded-md hairline bg-sunken transition-[box-shadow,border-color]"
      :class="selected || focused ? 'border-accent ring-selected' : 'border-border group-hover:border-border-strong'"
    >
      <LazyMedia ref="media" class="absolute! inset-0" :src="previewUrl" :media-class="mediaClass" :data-blurred="blurred || undefined" loop>
        <template #fallback="{ broken }">
          <span class="flex flex-col items-center justify-center gap-2 px-2 text-center text-xs" :data-preview="broken ? 'broken' : 'none'">
            <AppIcon :name="broken ? 'alert' : 'image'" :size="32" />
            <span>{{ broken ? t('card.previewBroken') : t('card.noPreview') }}</span>
          </span>
        </template>
      </LazyMedia>

      <div v-if="blurred" class="pointer-events-none absolute inset-0 z-3 grid place-content-center justify-items-center gap-2 p-2 text-center text-sm text-on-scrim">
        <span class="rounded-sm bg-scrim px-2 py-px">{{ t('card.mature') }}</span>
        <button
          type="button"
          :tabindex="innerTab"
          class="lm-btn lm-btn--sm pointer-events-auto"
          :aria-label="`${t('card.show')}: ${displayName}`"
          data-testid="reveal"
          @click.stop="emit('reveal', item)"
        >
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
        <span v-if="display.baseModel && item.base_model" class="min-w-0 truncate rounded-sm bg-scrim px-2 py-px text-xs font-medium text-on-scrim">{{ item.base_model }}</span>
        <span v-if="display.favorite && item.favorite" :class="stateClass" role="img" :aria-label="t('card.favorite')" :title="t('card.favorite')" @click="activate">
          <AppIcon name="star" :size="13" filled />
        </span>
        <span v-if="item.skip_metadata_refresh" :class="stateClass" role="img" :aria-label="t('card.skipped')" :title="t('card.skipped')" @click="activate">
          <AppIcon name="ban" :size="13" />
        </span>
        <span v-if="item.exclude" :class="stateClass" role="img" :aria-label="t('card.excluded')" :title="t('card.excluded')" @click="activate">
          <AppIcon name="eyeOff" :size="13" />
        </span>
        <button
          v-if="mature && revealed"
          type="button"
          :tabindex="innerTab"
          :class="[stateClass, 'cursor-pointer hover:bg-accent hover:text-on-accent']"
          :aria-label="`${t('card.hideAgain')}: ${displayName}`"
          :title="t('card.hideAgain')"
          @click.stop="emit('reveal', item)"
        >
          <AppIcon name="eyeOff" :size="13" />
        </button>
        <!-- Takes the pointer only for its tooltip; a click still opens / selects the card. -->
        <span
          v-if="item.update_available"
          class="pointer-events-auto ml-auto inline-flex flex-none cursor-pointer items-center gap-[2px] rounded-sm bg-accent px-2 py-px text-xs font-medium text-on-accent"
          :title="t('library.updatesFlagHint')"
          data-testid="update-flag"
          @click="activate"
        >
          <AppIcon name="arrowUp" :size="12" />{{ t('card.update') }}
        </span>
      </div>

      <div
        v-if="!selectionMode"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-3 flex items-center gap-[0.125rem] bg-scrim p-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 touch:opacity-100"
        data-testid="card-actions"
      >
        <button
          v-if="display.favorite"
          type="button"
          :tabindex="innerTab"
          :class="actionClass"
          :aria-label="t('detail.toggleFavorite')"
          :title="t('detail.toggleFavorite')"
          :aria-pressed="!!item.favorite"
          @click.stop="emit('toggle-favorite', item)"
        >
          <AppIcon name="star" :size="16" :filled="!!item.favorite" />
        </button>
        <a
          v-if="civitaiUrl"
          :tabindex="innerTab"
          :href="civitaiUrl"
          target="_blank"
          rel="noopener noreferrer"
          :class="actionClass"
          :aria-label="t('detail.civitai')"
          :title="t('detail.civitai')"
          @click.stop
        >
          <AppIcon name="external" :size="16" />
        </a>
        <span class="flex-1" aria-hidden="true"></span>
        <template v-if="canSend">
          <button
            type="button"
            :tabindex="innerTab"
            :class="actionClass"
            :aria-label="t('card.sendToComfy')"
            :title="t('card.sendHint')"
            @click.stop="emit('send', item, $event.shiftKey)"
          >
            <AppIcon name="send" :size="15" />
          </button>
          <button type="button" :tabindex="innerTab" :class="actionClass" :aria-label="t('detail.copySyntax')" :title="t('detail.copySyntax')" @click.stop="emit('copy', item)">
            <AppIcon name="copy" :size="15" />
          </button>
        </template>
        <button
          type="button"
          :tabindex="innerTab"
          :class="actionClass"
          :aria-label="t('actions.menu', { name: displayName })"
          :title="t('actions.menuTitle')"
          aria-haspopup="menu"
          @click.stop="openMenuFromButton"
        >
          <AppIcon name="more" :size="16" />
        </button>
      </div>
    </div>

    <div v-if="display.name || display.meta || display.versionRow || display.tags" class="pointer-events-none flex-none px-[0.125rem] pt-[0.5rem]">
      <p v-if="display.name" :class="[lineClass, 'text-sm font-medium']" :title="displayName">{{ displayName }}</p>
      <p v-if="display.meta" :class="[lineClass, 'text-xs text-muted tabular-nums']" data-testid="card-meta">{{ metaText }}</p>
      <p v-if="display.versionRow" :class="[lineClass, 'flex items-center gap-1 text-xs text-muted']" data-testid="card-version">
        <span v-if="item.civitai?.name" class="min-w-0 truncate">{{ item.civitai?.name }}</span>
        <span v-if="item.quantization" class="flex-none rounded-sm hairline border-border-strong px-1 leading-[1rem]">{{ item.quantization }}</span>
        <span v-for="mode in modes" :key="mode" class="flex-none rounded-sm hairline border-border-strong px-1 leading-[1rem]">{{ mode }}</span>
        <span v-if="versionCount > 1" class="flex-none">{{ t('card.versions', { count: versionCount }) }}</span>
      </p>
      <p v-if="display.tags" :class="[lineClass, 'text-xs text-muted']">{{ tagsText }}</p>
    </div>
  </article>
</template>
