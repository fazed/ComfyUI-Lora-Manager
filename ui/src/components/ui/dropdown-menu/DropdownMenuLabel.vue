<script setup lang="ts">
import type { DropdownMenuLabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DropdownMenuLabel } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<DropdownMenuLabelProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <DropdownMenuLabel data-slot="dropdown-menu-label" v-bind="delegatedProps" :class="cn('truncate px-3 pt-2 pb-1 text-xs font-medium text-muted', props.class)">
    <slot />
  </DropdownMenuLabel>
</template>
