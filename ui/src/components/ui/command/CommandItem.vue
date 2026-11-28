<script setup lang="ts">
import type { ListboxItemEmits, ListboxItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxItem, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<ListboxItemProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<ListboxItemEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <ListboxItem
    data-slot="command-item"
    v-bind="forwarded"
    :class="
      cn(
        'flex min-h-control cursor-pointer items-center gap-3 rounded-sm px-2 py-1 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:text-muted data-[highlighted]:bg-accent-soft',
        props.class,
      )
    "
  >
    <slot />
  </ListboxItem>
</template>
