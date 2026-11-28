<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

defineProps<{ title: string }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ openAutoFocus: [event: Event] }>()
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      :show-close-button="false"
      class="top-[12vh] max-w-none translate-y-0 gap-0 overflow-hidden p-0 w-[min(40rem,calc(100vw-var(--lm-space-6)))]"
      :aria-describedby="undefined"
      @open-auto-focus="emit('openAutoFocus', $event)"
    >
      <DialogTitle class="sr-only">{{ title }}</DialogTitle>
      <slot />
    </DialogContent>
  </Dialog>
</template>
