<script setup lang="ts">
import type { DropdownMenuSubTriggerProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DropdownMenuSubTrigger } from 'reka-ui'
import AppIcon from '@/components/AppIcon.vue'
import { cn } from '@/lib/utils'

const props = defineProps<DropdownMenuSubTriggerProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <DropdownMenuSubTrigger
    data-slot="dropdown-menu-sub-trigger"
    v-bind="delegatedProps"
    :class="
      cn(
        'relative flex min-h-[2.125rem] cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[highlighted]:bg-sunken data-[state=open]:bg-sunken',
        props.class,
      )
    "
  >
    <slot />
    <AppIcon name="chevronRight" :size="14" class="ml-auto flex-none text-muted" />
  </DropdownMenuSubTrigger>
</template>
