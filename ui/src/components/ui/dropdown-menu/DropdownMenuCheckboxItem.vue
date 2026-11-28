<script setup lang="ts">
import type { DropdownMenuCheckboxItemEmits, DropdownMenuCheckboxItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DropdownMenuCheckboxItem, DropdownMenuItemIndicator, useForwardPropsEmits } from 'reka-ui'
import AppIcon from '@/components/AppIcon.vue'
import { cn } from '@/lib/utils'

const props = defineProps<DropdownMenuCheckboxItemProps & { class?: HTMLAttributes['class'] }>()
const emits = defineEmits<DropdownMenuCheckboxItemEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DropdownMenuCheckboxItem
    data-slot="dropdown-menu-checkbox-item"
    v-bind="forwarded"
    :class="
      cn(
        'relative flex min-h-[2.125rem] cursor-pointer items-center gap-2 rounded-sm pr-3 pl-8 text-left text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[highlighted]:bg-sunken',
        props.class,
      )
    "
  >
    <span class="pointer-events-none absolute left-2 inline-grid size-[1rem] place-items-center">
      <DropdownMenuItemIndicator>
        <AppIcon name="check" :size="14" />
      </DropdownMenuItemIndicator>
    </span>
    <slot />
  </DropdownMenuCheckboxItem>
</template>
