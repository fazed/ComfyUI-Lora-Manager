<script setup lang="ts">
/**
 * Prompt, negative prompt (with copy buttons), parameter chips and resources
 * of one generation (utils/generation.ts view). Shared by the example
 * lightbox and the recipe drawer; the `empty` slot renders when there is
 * nothing to show.
 */
import AppIcon from './AppIcon.vue'
import { copyText, useToasts } from '@/composables/useFeedback'
import type { GenerationView } from '@/utils/generation'
import { t } from '@/i18n'

withDefaults(defineProps<{ view: GenerationView | null; showResources?: boolean }>(), { showResources: true })

const toasts = useToasts()
const blockTitle = 'lm-overline flex items-center justify-between gap-2'
const textBlock = 'mt-1 max-h-[220px] overflow-y-auto rounded-sm bg-sunken p-3 font-mono text-xs leading-normal whitespace-pre-wrap wrap-anywhere'

async function copy(value: string): Promise<void> {
  if (await copyText(value)) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}
</script>

<template>
  <template v-if="view">
    <section v-if="view.prompt">
      <h3 :class="blockTitle">
        {{ t('generation.prompt') }}
        <button type="button" class="lm-btn lm-btn--sm normal-case" :aria-label="t('generation.copyPrompt')" @click="copy(view.prompt)">
          <AppIcon name="copy" :size="14" />{{ t('common.copy') }}
        </button>
      </h3>
      <p :class="textBlock">{{ view.prompt }}</p>
    </section>
    <section v-if="view.negativePrompt">
      <h3 :class="blockTitle">
        {{ t('generation.negativePrompt') }}
        <button
          type="button"
          class="lm-btn lm-btn--sm normal-case"
          :aria-label="t('generation.copyNegative')"
          @click="copy(view.negativePrompt)"
        >
          <AppIcon name="copy" :size="14" />{{ t('common.copy') }}
        </button>
      </h3>
      <p :class="textBlock">{{ view.negativePrompt }}</p>
    </section>
    <section v-if="view.params.length">
      <h3 class="lm-overline mb-2">{{ t('generation.parameters') }}</h3>
      <ul class="flex flex-wrap gap-1">
        <li v-for="param in view.params" :key="param.key" class="lm-chip max-w-full whitespace-normal">
          <span class="text-muted">{{ t(param.label) }}</span>
          <span class="font-medium wrap-anywhere">{{ param.value }}</span>
        </li>
      </ul>
    </section>
    <section v-if="showResources && view.resources.length">
      <h3 class="lm-overline mb-2">{{ t('generation.resources') }}</h3>
      <ul class="flex flex-col gap-1 text-sm">
        <li v-for="resource in view.resources" :key="`${resource.type}|${resource.name}`" class="flex items-baseline gap-2">
          <span class="lm-badge flex-none">{{ resource.type }}</span>
          <span class="min-w-0 flex-1 wrap-anywhere">{{ resource.name }}</span>
          <span v-if="resource.weight" class="text-xs text-muted tabular-nums">{{ resource.weight }}</span>
        </li>
      </ul>
    </section>
  </template>
  <slot v-else name="empty" />
</template>
