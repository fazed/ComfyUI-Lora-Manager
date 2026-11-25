<script setup lang="ts">
/**
 * Shared shell of every `content` page (Downloads, Stats, Diagnostics,
 * Settings, Search, Not found): the page scroller, one centered container
 * (`max-w-page` = --lm-page-max-width, the --lm-space-6 gutter / --lm-space-4
 * on phones) and one header (the only h1 of the page, optional description and
 * a right-aligned actions slot, followed by the page's refresh button when the
 * page registered one, see composables/useRefresh.ts). Library grid pages do
 * not use it.
 *
 * The scroller reserves the scrollbar gutter, so pages with and without a
 * vertical scrollbar keep identical edges. `footer` renders after the
 * container inside the scroller (Settings' sticky save bar).
 */
import { ref } from 'vue'
import RefreshButton from './RefreshButton.vue'
import { useRefresh } from '@/composables/useRefresh'

defineProps<{ title: string }>()

const refresh = useRefresh()

const scroller = ref<HTMLElement | null>(null)
defineExpose({ scroller })
</script>

<template>
  <div ref="scroller" class="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">
    <div class="mx-auto flex w-full max-w-page flex-1 flex-col gap-5 p-6 phone:p-4">
      <header class="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div class="min-w-[min(100%,260px)] flex-1">
          <h1 class="text-2xl text-balance">{{ title }}</h1>
          <div v-if="$slots.description" class="mt-1 text-sm text-muted"><slot name="description" /></div>
        </div>
        <!-- Page actions, then Refresh at the end. With actions the group takes its own row on phones
             (Refresh stays at its right end); without, Refresh sits next to the title. -->
        <div v-if="$slots.actions || refresh.showButton.value" class="flex flex-wrap items-center gap-2" :class="{ 'phone:w-full': $slots.actions }">
          <slot name="actions" />
          <RefreshButton class="phone:ml-auto" />
        </div>
      </header>
      <slot />
    </div>
    <slot name="footer" />
  </div>
</template>
