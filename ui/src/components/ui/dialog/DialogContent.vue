<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { DialogClose, DialogContent, DialogPortal, useForwardPropsEmits } from 'reka-ui'
import AppIcon from '@/components/AppIcon.vue'
import { cn } from '@/lib/utils'
import { t } from '@/i18n'
import DialogOverlay from './DialogOverlay.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes['class']; showCloseButton?: boolean }>(), {
  showCloseButton: true,
})
const emits = defineEmits<DialogContentEmits>()
const delegatedProps = reactiveOmit(props, 'class', 'showCloseButton')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
</script>

<template>
  <DialogPortal>
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      aria-modal="true"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="
        cn(
          'fixed top-1/2 left-1/2 z-80 grid w-full max-w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg hairline border-border bg-elevated p-6 text-fg shadow-lg outline-none data-[state=open]:animate-fade-in',
          props.class,
        )
      "
    >
      <slot />
      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm absolute top-3 right-3"
        :aria-label="t('common.close')"
      >
        <AppIcon name="close" :size="16" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
