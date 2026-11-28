<script setup lang="ts">
import type { TabsListProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TabsList } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsListProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <TabsList data-slot="tabs-list" v-bind="delegatedProps" :class="cn('flex flex-none gap-1 overflow-x-auto hairline-b border-border', props.class)">
    <slot />
  </TabsList>
</template>
