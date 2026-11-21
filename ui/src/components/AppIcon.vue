<script setup lang="ts">
/**
 * Inline stroke icons (24x24 grid). They only ever use currentColor, so every
 * theme colours them through the surrounding text color.
 */
import { computed } from 'vue'
import { ICON_PATHS, type IconName } from './icons'

export type { IconName }

const props = withDefaults(defineProps<{ name: IconName; size?: number; label?: string; filled?: boolean }>(), {
  size: 18,
  label: '',
  filled: false,
})

const paths = computed(() => ICON_PATHS[props.name])
</script>

<template>
  <svg
    class="inline-block flex-none align-middle"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
