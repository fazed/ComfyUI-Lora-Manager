<script setup lang="ts">
import type { ListboxContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxContent, useForwardProps } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<ListboxContentProps & { class?: HTMLAttributes['class']; id?: string }>()
const delegatedProps = reactiveOmit(props, 'class', 'id')
const forwarded = useForwardProps(delegatedProps)
</script>

<template>
  <ListboxContent
    data-slot="command-list"
    v-bind="{ ...forwarded, id }"
    :class="cn('max-h-[min(60vh,28rem)] overflow-x-hidden overflow-y-auto overscroll-contain p-1', props.class)"
  >
    <slot />
  </ListboxContent>
</template>
