<script setup lang="ts">
import type { TabsTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TabsTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<TabsTriggerProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <TabsTrigger
    data-slot="tabs-trigger"
    v-bind="delegatedProps"
    :class="
      cn(
        '-mb-px inline-flex cursor-pointer items-center gap-2 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg phone:min-h-touch',
        props.class,
      )
    "
  >
    <slot />
  </TabsTrigger>
</template>
