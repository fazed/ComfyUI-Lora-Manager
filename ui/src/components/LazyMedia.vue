<script setup lang="ts">
/**
 * Image or video with a loading placeholder and a fade-in (all app media uses it).
 *
 * - While loading: a skeleton (skeleton token, subtle shimmer that starts after a
 *   short delay and is off under prefers-reduced-motion) fills the box, which the
 *   caller sizes (classes on this component), so nothing shifts on load.
 * - Loaded: the media fades in (--lm-fade-duration); media that is already
 *   complete when shown (cache) appears at once, without a fade.
 * - Error / no src: the `fallback` slot (default: an image icon; `broken` tells
 *   a failed load from a missing preview); with `retry`
 *   the fallback is a button that loads the media again.
 * - A new `src` (recycled card, next lightbox image) resets the state.
 *
 * `mediaClass` goes on the <img>/<video> (object-fit, lm-zoom-media, blur...),
 * so the card hover zoom keeps scaling the media inside this wrapper.
 * State machine: utils/mediaLoad.ts.
 */
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useTimeoutFn } from '@vueuse/core'
import AppIcon from './AppIcon.vue'
import { initialMediaState, isMediaComplete, loadEventType, mediaReducer, type MediaEvent } from '@/utils/mediaLoad'
import { isVideoUrl } from '@/utils/format'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{
    src: string
    /** Force image/video; default: guessed from the URL. */
    kind?: 'image' | 'video'
    alt?: string
    mediaClass?: unknown
    loading?: 'lazy' | 'eager'
    fetchpriority?: 'high' | 'low' | 'auto'
    /** Click on the error fallback retries. */
    retry?: boolean
    iconSize?: number
    // Video attributes.
    autoplay?: boolean
    controls?: boolean
    loop?: boolean
    muted?: boolean
    preload?: 'none' | 'metadata' | 'auto'
  }>(),
  {
    kind: undefined,
    alt: '',
    mediaClass: undefined,
    loading: 'lazy',
    fetchpriority: undefined,
    retry: false,
    iconSize: 28,
    autoplay: false,
    controls: false,
    loop: false,
    muted: true,
    preload: 'metadata',
  },
)

const state = shallowRef(initialMediaState)
const attempt = ref(0)
const element = ref<HTMLImageElement | HTMLVideoElement | null>(null)
const isVideo = computed(() => (props.kind ? props.kind === 'video' : isVideoUrl(props.src)))

function send(event: MediaEvent): void {
  state.value = mediaReducer(state.value, event)
}

// Keep the placeholder under the media until the fade has finished.
const placeholderGone = ref(false)
const { start: hidePlaceholderLater, stop: keepPlaceholder } = useTimeoutFn(() => (placeholderGone.value = true), 600, {
  immediate: false,
})

watch(
  () => state.value.status,
  (status) => {
    keepPlaceholder()
    placeholderGone.value = false
    if (status === 'loaded') {
      if (state.value.instant) placeholderGone.value = true
      else hidePlaceholderLater()
    }
  },
)

let startedAt = 0

async function begin(): Promise<void> {
  send({ type: 'start', src: props.src })
  startedAt = performance.now()
  const token = state.value.token
  await nextTick()
  if (isMediaComplete(element.value)) send({ type: 'cached', token })
}

onMounted(begin)
watch(() => props.src, begin)

function onLoad(): void {
  const token = state.value.token
  const type = loadEventType(performance.now() - startedAt)
  const el = element.value
  // Decode off the main thread before fading in (no jank mid-fade).
  if (el instanceof HTMLImageElement && typeof el.decode === 'function') {
    void el.decode().catch(() => undefined).finally(() => send({ type, token }))
  } else {
    send({ type, token })
  }
}

function onError(): void {
  send({ type: 'error', token: state.value.token })
}

function retryLoad(): void {
  attempt.value++
  void begin()
}

const showMedia = computed(() => !!props.src && state.value.status !== 'error' && state.value.status !== 'empty')
const showFallback = computed(() => state.value.status === 'error' || state.value.status === 'empty')
const fadeClass = computed(() => [
  'lm-fade',
  state.value.status === 'loaded' && 'is-loaded',
  state.value.instant && 'is-instant',
])

defineExpose({ element, state })
</script>

<template>
  <span class="relative block overflow-hidden">
    <span
      v-if="!placeholderGone || showFallback"
      class="lm-media-placeholder absolute inset-0 grid place-items-center text-muted"
      :class="{ 'is-loading': state.status === 'loading' }"
      aria-hidden="true"
    ></span>
    <template v-if="showMedia">
      <video
        v-if="isVideo"
        :key="`v${attempt}`"
        ref="element"
        :class="[mediaClass, fadeClass, 'relative']"
        :src="src"
        :autoplay="autoplay"
        :controls="controls"
        :loop="loop"
        :muted="muted"
        :preload="preload"
        playsinline
        @loadeddata="onLoad"
        @error="onError"
      ></video>
      <img
        v-else
        :key="`i${attempt}`"
        ref="element"
        :class="[mediaClass, fadeClass, 'relative']"
        :src="src"
        :alt="alt"
        :loading="loading"
        decoding="async"
        :fetchpriority="fetchpriority"
        @load="onLoad"
        @error="onError"
      />
    </template>
    <span v-if="showFallback" class="absolute inset-0 grid place-items-center text-muted">
      <button
        v-if="retry && src"
        type="button"
        class="inline-flex cursor-pointer flex-col items-center gap-1 rounded-sm p-2 text-xs hover:text-fg"
        :title="t('common.retry')"
        @click.stop="retryLoad"
      >
        <AppIcon name="image" :size="iconSize" />
        <span>{{ t('common.retry') }}</span>
      </button>
      <!-- `broken`: the media failed to load (as opposed to having no preview at all). -->
      <slot v-else name="fallback" :broken="state.status === 'error'">
        <AppIcon name="image" :size="iconSize" />
      </slot>
    </span>
  </span>
</template>
