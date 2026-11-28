<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <div data-slot="command-empty" role="status" :class="cn('px-2 py-6 text-center text-sm text-muted', props.class)">
    <slot />
  </div>
</template>
