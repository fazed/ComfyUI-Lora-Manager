<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogContent, DialogOverlay, DialogPortal, useForwardPropsEmits } from 'reka-ui'
import { cn } from '@/lib/utils'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes['class']; side?: 'bottom' | 'right' }>(), {
  side: 'right',
})
const emits = defineEmits<DialogContentEmits>()
const delegatedProps = reactiveOmit(props, 'class', 'side')
const forwarded = useForwardPropsEmits(delegatedProps, emits)

const SIDES = {
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg hairline-t data-[state=open]:animate-fade-in',
  right: 'inset-y-0 right-0 h-full w-[min(var(--lm-drawer-width),100vw)] hairline-l data-[state=open]:animate-slide-in',
}
</script>

<template>
  <DialogPortal>
    <DialogOverlay data-slot="sheet-overlay" class="fixed inset-0 z-80 bg-overlay data-[state=open]:animate-fade-in" />
    <DialogContent
      data-slot="sheet-content"
      aria-modal="true"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn('fixed z-80 flex flex-col border-border bg-elevated text-fg shadow-lg outline-none', SIDES[side], props.class)"
    >
      <slot />
    </DialogContent>
  </DialogPortal>
</template>
