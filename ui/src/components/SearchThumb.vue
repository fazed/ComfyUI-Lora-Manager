<script setup lang="ts">
/** Small preview (image or video) of a search hit, with a placeholder and mature blur. */
import { computed } from 'vue'
import LazyMedia from './LazyMedia.vue'
import { useAppSettings } from '@/composables/useAppSettings'
import { withMountPrefix } from '@/utils/basePath'
import type { SuggestItem } from '@/utils/suggest'

const props = withDefaults(defineProps<{ item: SuggestItem; size?: number }>(), { size: 36 })
const { settings } = useAppSettings()

const url = computed(() => (props.item.thumb ? withMountPrefix(props.item.thumb) : ''))
const blurred = computed(() => !!settings.value?.blur_mature_content && (props.item.nsfwLevel ?? 0) >= 4)
</script>

<template>
  <LazyMedia
    class="flex-none rounded-sm bg-sunken"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :media-class="['size-full object-cover', blurred && 'blur-[6px]']"
    :src="url"
    :icon-size="Math.round(size / 2.2)"
    aria-hidden="true"
  />
</template>
