<script setup lang="ts">
/**
 * Example image lightbox: media on the left (top on phones), generation data
 * (prompt, negative prompt, parameters, resources) beside it. A modal <dialog>
 * keeps focus inside; arrows navigate, Escape or a click on the backdrop closes
 * (only the lightbox, not the drawer below); focus returns to the opener
 * (handled by the drawer).
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { CivitaiImage } from '@/api/types'
import { useDismissLayer } from '@/composables/useDismiss'
import { copyText, useToasts } from '@/composables/useFeedback'
import { isVideoUrl } from '@/utils/format'
import { toGenerationView } from '@/utils/generation'
import { t } from '@/i18n'

const props = defineProps<{ images: CivitaiImage[]; index: number }>()
const emit = defineEmits<{ close: []; 'update:index': [index: number] }>()

const toasts = useToasts()
const dialog = ref<HTMLDialogElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)
// Escape arrives as the native `cancel` event; the layer keeps the drawer below from reacting.
const { backdrop } = useDismissLayer({ active: () => true, close: () => emit('close'), escape: false, backdrop: 'dialog' })

const count = computed(() => props.images.length)
const image = computed(() => props.images[props.index])
const isVideo = computed(() => !!image.value && (image.value.type === 'video' || isVideoUrl(image.value.url)))
const view = computed(() => toGenerationView(image.value?.meta))
const position = computed(() => ({ index: props.index + 1, count: count.value }))

const blockTitle = 'lm-overline flex items-center justify-between gap-2'
const textBlock = 'mt-1 max-h-[220px] overflow-y-auto rounded-sm bg-sunken p-3 font-mono text-xs leading-normal whitespace-pre-wrap wrap-anywhere'
const navButton =
  'absolute top-1/2 z-2 inline-grid size-[40px] -translate-y-1/2 cursor-pointer place-items-center rounded-pill bg-scrim text-on-scrim hover:bg-accent hover:text-on-accent disabled:cursor-default disabled:opacity-0'

function go(delta: number): void {
  const next = props.index + delta
  if (next >= 0 && next < count.value) emit('update:index', next)
}

function onKey(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select')) return
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    go(-1)
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    go(1)
  }
}

async function copy(value: string): Promise<void> {
  if (await copyText(value)) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}

onMounted(async () => {
  dialog.value?.showModal()
  await nextTick()
  closeButton.value?.focus()
})

// Keep focus inside after the media element is swapped.
watch(
  () => props.index,
  async () => {
    await nextTick()
    if (!dialog.value?.contains(document.activeElement)) closeButton.value?.focus()
  },
)
</script>

<template>
  <dialog
    ref="dialog"
    class="m-auto open:grid h-[min(880px,calc(100dvh-var(--lm-space-8)))] max-h-none w-[min(1240px,calc(100vw-var(--lm-space-8)))] max-w-none grid-cols-[minmax(0,1fr)_minmax(300px,380px)] overflow-hidden rounded-lg hairline border-border bg-elevated p-0 text-fg shadow-lg backdrop:bg-overlay tablet:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] phone:h-dvh phone:w-screen phone:grid-cols-1 phone:grid-rows-[minmax(0,52dvh)_minmax(0,1fr)] phone:rounded-none phone:border-0"
    :aria-label="t('lightbox.label', position)"
    @cancel.prevent="emit('close')"
    @keydown="onKey"
    @pointerdown="backdrop.pointerdown"
    @click="backdrop.click"
  >
    <div class="relative flex min-h-0 items-center justify-center bg-sunken">
      <LazyMedia
        v-if="image"
        class="size-full"
        media-class="size-full object-contain"
        :src="image.url"
        :kind="isVideo ? 'video' : 'image'"
        :alt="t('lightbox.label', position)"
        loading="eager"
        fetchpriority="high"
        controls
        autoplay
        loop
        retry
        :icon-size="40"
      />
      <span class="absolute top-3 left-3 z-2 rounded-pill bg-scrim px-2 py-px text-xs text-on-scrim tabular-nums" aria-hidden="true">
        {{ t('lightbox.counter', position) }}
      </span>
      <button type="button" :class="[navButton, 'left-3']" :disabled="index <= 0" :aria-label="t('lightbox.previous')" @click="go(-1)">
        <AppIcon name="chevronLeft" :size="22" />
      </button>
      <button type="button" :class="[navButton, 'right-3']" :disabled="index >= count - 1" :aria-label="t('lightbox.next')" @click="go(1)">
        <AppIcon name="chevronRight" :size="22" />
      </button>
    </div>

    <aside class="flex min-h-0 flex-col hairline-l border-border phone:border-l-0 phone:hairline-t">
      <header class="flex items-center gap-2 hairline-b border-border px-4 py-3">
        <h2 class="flex-1 text-md">{{ t('generation.title') }}</h2>
        <a v-if="image?.url" class="lm-btn lm-btn--ghost lm-btn--sm" :href="image.url" target="_blank" rel="noopener noreferrer">
          <AppIcon name="external" :size="14" />{{ t('lightbox.openOriginal') }}
        </a>
        <button ref="closeButton" type="button" class="lm-btn lm-btn--ghost lm-btn--icon" :aria-label="t('common.close')" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </header>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <template v-if="view">
          <section v-if="view.prompt">
            <h3 :class="blockTitle">
              {{ t('generation.prompt') }}
              <button type="button" class="lm-btn lm-btn--sm normal-case" :aria-label="t('generation.copyPrompt')" @click="copy(view.prompt)">
                <AppIcon name="copy" :size="14" />{{ t('common.copy') }}
              </button>
            </h3>
            <p :class="textBlock">{{ view.prompt }}</p>
          </section>
          <section v-if="view.negativePrompt">
            <h3 :class="blockTitle">
              {{ t('generation.negativePrompt') }}
              <button
                type="button"
                class="lm-btn lm-btn--sm normal-case"
                :aria-label="t('generation.copyNegative')"
                @click="copy(view.negativePrompt)"
              >
                <AppIcon name="copy" :size="14" />{{ t('common.copy') }}
              </button>
            </h3>
            <p :class="textBlock">{{ view.negativePrompt }}</p>
          </section>
          <section v-if="view.params.length">
            <h3 class="lm-overline mb-2">{{ t('generation.parameters') }}</h3>
            <ul class="flex flex-wrap gap-1">
              <li v-for="param in view.params" :key="param.key" class="lm-chip max-w-full whitespace-normal">
                <span class="text-muted">{{ t(param.label) }}</span>
                <span class="font-medium wrap-anywhere">{{ param.value }}</span>
              </li>
            </ul>
          </section>
          <section v-if="view.resources.length">
            <h3 class="lm-overline mb-2">{{ t('generation.resources') }}</h3>
            <ul class="flex flex-col gap-1 text-sm">
              <li v-for="resource in view.resources" :key="`${resource.type}|${resource.name}`" class="flex items-baseline gap-2">
                <span class="lm-badge flex-none">{{ resource.type }}</span>
                <span class="min-w-0 flex-1 wrap-anywhere">{{ resource.name }}</span>
                <span v-if="resource.weight" class="text-xs text-muted tabular-nums">{{ resource.weight }}</span>
              </li>
            </ul>
          </section>
        </template>
        <div v-else class="flex flex-col items-center gap-2 py-8 text-center text-muted">
          <AppIcon name="text" :size="28" />
          <p class="font-medium text-fg">{{ t('generation.none') }}</p>
          <p class="text-sm">{{ t('generation.noneHint') }}</p>
        </div>
      </div>
    </aside>
  </dialog>
</template>
