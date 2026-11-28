<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <kbd data-slot="command-shortcut" :class="cn('ml-auto flex-none rounded-sm hairline border-border px-1 font-mono text-xs text-muted', props.class)" aria-hidden="true">
    <slot />
  </kbd>
</template>
