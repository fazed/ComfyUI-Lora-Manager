<script setup lang="ts">
import type { ListboxFilterProps } from 'reka-ui'
import { computed, type HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { ListboxFilter, useForwardProps } from 'reka-ui'
import AppIcon from '@/components/AppIcon.vue'
import { cn } from '@/lib/utils'

// The filter is a combobox that controls the list (`listId`); the listbox moves the highlight (aria-activedescendant).
const props = defineProps<ListboxFilterProps & { class?: HTMLAttributes['class']; id?: string; placeholder?: string; listId?: string }>()
const emits = defineEmits<{ 'update:modelValue': [value: string]; keydown: [event: KeyboardEvent] }>()
const delegatedProps = reactiveOmit(props, 'class', 'id', 'placeholder', 'listId')
const forwarded = useForwardProps(delegatedProps)
// Native attributes of the <input> (the filter's own props are typed strictly, so they go through v-bind).
const inputAttrs = computed(() => ({
  id: props.id,
  role: 'combobox',
  'aria-expanded': 'true',
  'aria-autocomplete': 'list',
  'aria-controls': props.listId,
  placeholder: props.placeholder,
  autocomplete: 'off',
  spellcheck: 'false',
  enterkeyhint: 'search',
  onKeydown: (event: KeyboardEvent) => emits('keydown', event),
}))
</script>

<template>
  <div data-slot="command-input-wrapper" class="flex items-center gap-2 hairline-b border-border px-3">
    <AppIcon name="search" :size="18" class="flex-none text-muted" />
    <ListboxFilter
      data-slot="command-input"
      v-bind="{ ...forwarded, ...inputAttrs }"
      :class="cn('min-h-[3rem] w-full min-w-0 bg-transparent text-md text-fg outline-none placeholder:text-placeholder', props.class)"
      @update:model-value="emits('update:modelValue', $event)"
    />
    <slot />
  </div>
</template>
