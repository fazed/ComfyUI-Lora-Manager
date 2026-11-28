<script setup lang="ts">
import type { ListboxRootEmits, ListboxRootProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxRoot, useForwardPropsEmits } from 'reka-ui'
import { ref } from 'vue'
import { cn } from '@/lib/utils'

// Without the shadcn filter state: the caller ranks and renders its own groups (async results).
const props = withDefaults(defineProps<ListboxRootProps & { class?: HTMLAttributes['class'] }>(), { highlightOnHover: true })
const emits = defineEmits<ListboxRootEmits>()
const delegatedProps = reactiveOmit(props, 'class')
const forwarded = useForwardPropsEmits(delegatedProps, emits)
const root = ref<{ highlightFirstItem: () => void } | null>(null)

defineExpose({ highlightFirstItem: () => root.value?.highlightFirstItem() })
</script>

<template>
  <ListboxRoot
    ref="root"
    data-slot="command"
    v-bind="forwarded"
    :class="cn('flex size-full flex-col overflow-hidden rounded-md bg-elevated text-fg', props.class)"
  >
    <slot />
  </ListboxRoot>
</template>
