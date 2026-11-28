<script setup lang="ts">
import type { TooltipContentEmits, TooltipContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TooltipContent, TooltipPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<TooltipContentProps & { class?: HTMLAttributes['class'] }>(), { sideOffset: 6 })
const emits = defineEmits<TooltipContentEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <TooltipPortal>
    <TooltipContent
      data-slot="tooltip-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn('z-90 rounded-sm bg-fg px-2 py-1 text-xs whitespace-nowrap text-page shadow-md data-[state=delayed-open]:animate-fade-in', props.class)"
    >
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
