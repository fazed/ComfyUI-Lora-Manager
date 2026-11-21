<script setup lang="ts">
/** Small preview (image or video) of a search hit, with a placeholder and mature blur. */
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { useAppSettings } from '@/composables/useAppSettings'
import { withMountPrefix } from '@/utils/basePath'
import { isVideoUrl } from '@/utils/format'
import type { SuggestItem } from '@/utils/suggest'

const props = withDefaults(defineProps<{ item: SuggestItem; size?: number }>(), { size: 36 })
const { settings } = useAppSettings()
const failed = ref(false)

watch(
  () => props.item.thumb,
  () => (failed.value = false),
)

const url = computed(() => (props.item.thumb && !failed.value ? withMountPrefix(props.item.thumb) : ''))
const video = computed(() => isVideoUrl(props.item.thumb))
const blurred = computed(() => !!settings.value?.blur_mature_content && (props.item.nsfwLevel ?? 0) >= 4)
</script>

<template>
  <span
    class="relative flex-none overflow-hidden rounded-sm bg-sunken text-muted"
    :style="{ width: `${size}px`, height: `${size}px` }"
    aria-hidden="true"
  >
    <template v-if="url">
      <video
        v-if="video"
        class="size-full object-cover"
        :class="{ 'blur-[6px]': blurred }"
        :src="url"
        muted
        playsinline
        preload="metadata"
        @error="failed = true"
      ></video>
      <img
        v-else
        class="size-full object-cover"
        :class="{ 'blur-[6px]': blurred }"
        :src="url"
        alt=""
        loading="lazy"
        decoding="async"
        @error="failed = true"
      />
    </template>
    <span v-else class="grid size-full place-items-center"><AppIcon name="image" :size="Math.round(size / 2.2)" /></span>
  </span>
</template>
