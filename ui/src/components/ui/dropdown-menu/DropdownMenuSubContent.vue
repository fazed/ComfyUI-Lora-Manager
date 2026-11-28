<script setup lang="ts">
import type { DropdownMenuSubContentEmits, DropdownMenuSubContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DropdownMenuPortal, DropdownMenuSubContent, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<DropdownMenuSubContentProps & { class?: HTMLAttributes['class'] }>(), { sideOffset: 2 })
const emits = defineEmits<DropdownMenuSubContentEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DropdownMenuPortal>
    <DropdownMenuSubContent
      data-slot="dropdown-menu-sub-content"
      v-bind="forwarded"
      :class="
        cn(
          'z-80 flex max-h-[var(--reka-dropdown-menu-content-available-height)] min-w-[12rem] flex-col overflow-y-auto rounded-md hairline border-border bg-elevated p-1 text-fg shadow-lg outline-none data-[state=open]:animate-fade-in',
          props.class,
        )
      "
    >
      <slot />
    </DropdownMenuSubContent>
  </DropdownMenuPortal>
</template>
