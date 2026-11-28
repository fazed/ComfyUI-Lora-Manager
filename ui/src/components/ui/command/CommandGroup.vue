<script setup lang="ts">
import type { ListboxGroupProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxGroup, ListboxGroupLabel } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<ListboxGroupProps & { class?: HTMLAttributes['class']; heading?: string }>()
const delegatedProps = reactiveOmit(props, 'class', 'heading')
</script>

<template>
  <ListboxGroup data-slot="command-group" v-bind="delegatedProps" :class="cn('py-1', props.class)">
    <ListboxGroupLabel v-if="heading" data-slot="command-group-heading" class="lm-overline px-2 pt-1 pb-1">{{ heading }}</ListboxGroupLabel>
    <slot />
  </ListboxGroup>
</template>
