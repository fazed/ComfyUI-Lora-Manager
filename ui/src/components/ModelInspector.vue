<script setup lang="ts">
/**
 * Quick view: a right-hand panel beside the grid that shows the focused model
 * (a single click on a card or row while it is open). Everything comes from
 * the list item itself (trigger words are `civitai.trainedWords` of the list
 * payload), so moving the focus never sends a request. Send / Copy syntax /
 * Open details reuse the page's handlers; Send and Copy syntax use the
 * strength stepper, which starts at the model's usage-tip strength. A
 * trigger-word chip copies that word, a tag filters the library by it.
 */
import { computed, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import LazyMedia from './LazyMedia.vue'
import type { ModelItem } from '@/api/types'
import { copyText, useToasts } from '@/composables/useFeedback'
import { withMountPrefix } from '@/utils/basePath'
import { formatBytes } from '@/utils/format'
import { isBlurred } from '@/utils/mature'
import { formatStrength, loraStrengths } from '@/utils/workflow'
import { t } from '@/i18n'

const props = defineProps<{ item: ModelItem | null; canSend: boolean; blurMature: boolean; revealed: boolean }>()
const emit = defineEmits<{
  open: [item: ModelItem]
  /** strength: the stepper value (the usage-tip strength unless changed). */
  send: [item: ModelItem, replace: boolean, strength: number]
  copy: [item: ModelItem, strength: number]
  reveal: [item: ModelItem]
  'filter-tag': [tag: string]
  close: []
}>()

const toasts = useToasts()
const previewUrl = computed(() => (props.item?.preview_url ? withMountPrefix(props.item.preview_url) : ''))
const blurred = computed(() => !!props.item && isBlurred(props.item.preview_nsfw_level, props.blurMature) && !props.revealed)
const tipStrength = () => loraStrengths(props.item?.usage_tips).strength
const strength = ref(tipStrength())
// Back to the model's usage-tip strength whenever another model is shown.
watch(() => props.item?.file_path, () => (strength.value = tipStrength()))
/** The stepper value, or the usage-tip strength while the field is empty or invalid. */
const effectiveStrength = computed(() => (Number.isFinite(strength.value) ? strength.value : tipStrength()))
const strengthText = computed(() => formatStrength(effectiveStrength.value))
const words = computed(() => [...new Set((props.item?.civitai?.trainedWords ?? []).map((word) => word.trim()).filter(Boolean))])
const facts = computed(() => {
  const item = props.item
  if (!item) return []
  return [
    { label: t('inspector.baseModel'), value: item.base_model || '-' },
    { label: t('inspector.folder'), value: item.folder || t('row.rootFolder') },
    { label: t('inspector.size'), value: item.file_size ? formatBytes(item.file_size) : '-' },
    { label: t('inspector.used'), value: t('inspector.usedCount', { count: item.usage_count ?? 0 }) },
    { label: t('inspector.version'), value: item.update_available ? t('inspector.updateAvailable') : t('inspector.latest') },
  ]
})

async function copyWord(word: string): Promise<void> {
  if (await copyText(word)) toasts.success(t('common.copied'))
  else toasts.error(t('common.copyFailed'))
}
</script>

<template>
  <aside class="flex w-(--lm-inspector-width) flex-none flex-col hairline-l border-border bg-surface" :aria-label="t('inspector.label')" data-testid="inspector">
    <div class="flex flex-none items-center gap-2 hairline-b border-border px-3 py-2">
      <h2 class="flex-1 text-sm font-medium text-muted">{{ t('inspector.label') }}</h2>
      <button type="button" class="lm-btn lm-btn--ghost lm-btn--icon" :aria-label="t('inspector.close')" :title="t('inspector.close')" @click="emit('close')">
        <AppIcon name="close" :size="16" />
      </button>
    </div>
    <p v-if="!item" class="p-4 text-sm text-muted">{{ t('inspector.empty') }}</p>
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="relative grid h-[22rem] place-items-center overflow-hidden hairline-b border-border bg-sunken">
        <LazyMedia
          :key="item.file_path"
          class="absolute! inset-0"
          :src="previewUrl"
          :media-class="['size-full object-contain', blurred && 'scale-110 blur-[18px]']"
          :data-blurred="blurred || undefined"
          loop
          autoplay
        >
          <template #fallback><AppIcon name="image" :size="32" /></template>
        </LazyMedia>
        <button v-if="blurred" type="button" class="lm-btn lm-btn--sm relative z-1" @click="emit('reveal', item)">
          <AppIcon name="eye" :size="14" />{{ t('card.show') }}
        </button>
      </div>
      <div class="grid gap-5 p-4">
        <div class="min-w-0">
          <h3 class="text-lg font-medium break-words" data-testid="inspector-name">{{ item.model_name || item.file_name }}</h3>
          <p class="mt-1 font-mono text-xs break-all text-muted">{{ item.file_name }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <template v-if="canSend">
            <label class="flex items-center gap-2 text-sm text-muted" for="inspector-strength">
              {{ t('detail.strength') }}
              <input
                id="inspector-strength"
                v-model.number="strength"
                class="lm-input w-[5.25rem] tabular-nums"
                type="number"
                step="0.05"
                min="-10"
                max="10"
              />
            </label>
            <button
              type="button"
              class="lm-btn lm-btn--primary"
              :aria-label="t('send.withStrength', { strength: strengthText })"
              :title="t('card.sendHint')"
              @click="emit('send', item, $event.shiftKey, effectiveStrength)"
            >
              <AppIcon name="send" :size="16" />{{ t('card.sendToComfy') }}<span class="tabular-nums" aria-hidden="true">{{ strengthText }}</span>
            </button>
            <button type="button" class="lm-btn lm-btn--icon" :aria-label="t('detail.copySyntax')" :title="t('detail.copySyntax')" @click="emit('copy', item, effectiveStrength)">
              <AppIcon name="copy" :size="16" />
            </button>
          </template>
          <button type="button" class="lm-btn" @click="emit('open', item)">
            <AppIcon name="external" :size="16" />{{ t('inspector.openDetails') }}
          </button>
        </div>
        <dl class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <template v-for="fact in facts" :key="fact.label">
            <dt class="text-muted">{{ fact.label }}</dt>
            <dd class="[overflow-wrap:anywhere]">{{ fact.value }}</dd>
          </template>
        </dl>
        <section>
          <h3 class="lm-label">{{ t('inspector.triggerWords') }}</h3>
          <div v-if="words.length" class="flex flex-wrap gap-2">
            <button
              v-for="word in words"
              :key="word"
              type="button"
              class="lm-chip cursor-pointer hover:bg-sunken"
              :aria-label="t('inspector.copyWord', { word })"
              :title="t('inspector.copyWord', { word })"
              @click="copyWord(word)"
            >
              {{ word }}<AppIcon name="copy" :size="12" />
            </button>
          </div>
          <p v-else class="text-sm text-muted">{{ t('inspector.noTriggerWords') }}</p>
        </section>
        <section v-if="item.tags?.length">
          <h3 class="lm-label">{{ t('inspector.tags') }}</h3>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tag in item.tags"
              :key="tag"
              type="button"
              class="lm-chip cursor-pointer hover:bg-sunken"
              :aria-label="t('inspector.filterTag', { tag })"
              @click="emit('filter-tag', tag)"
            >
              {{ tag }}
            </button>
          </div>
        </section>
      </div>
    </div>
  </aside>
</template>
