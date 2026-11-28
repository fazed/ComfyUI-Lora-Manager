<script setup lang="ts">
import type { DropdownMenuItemEmits, DropdownMenuItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DropdownMenuItem, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = withDefaults(defineProps<DropdownMenuItemProps & { class?: HTMLAttributes['class']; variant?: 'default' | 'danger' }>(), {
  variant: 'default',
})
const emits = defineEmits<DropdownMenuItemEmits>()
const delegatedProps = reactiveOmit(props, 'class', 'variant')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DropdownMenuItem
    data-slot="dropdown-menu-item"
    :data-variant="variant"
    v-bind="forwarded"
    :class="
      cn(
        'relative flex min-h-[2.125rem] cursor-pointer items-center gap-2 rounded-sm px-3 text-left text-sm outline-none select-none data-[disabled]:cursor-not-allowed data-[disabled]:text-muted data-[highlighted]:bg-sunken data-[variant=danger]:text-danger',
        props.class,
      )
    "
  >
    <slot />
  </DropdownMenuItem>
</template>
