<script setup lang="ts">
/**
 * Apply the filename template to selected models or a folder: the dry run
 * (POST, dry_run=true) runs on open and lists the planned renames; "Rename
 * files..." asks a danger confirm before the real run.
 */
import { computed, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import ModalShell from './ModalShell.vue'
import StateBlock from './StateBlock.vue'
import type { TemplateScope } from '@/api/endpoints'
import type { ModelTools } from '@/composables/useModelTools'
import type { TemplatePlan } from '@/utils/modelTools'
import { t } from '@/i18n'

/** `template`: the type's filename template from Settings (the dry run does not report it). */
const props = defineProps<{ tools: ModelTools; scope: TemplateScope; scopeLabel: string; template: string }>()
const emit = defineEmits<{ close: [] }>()

const SHOWN = 200
const plan = ref<TemplatePlan | null>(null)
const loading = ref(true)
const busy = ref(false)

const hasRenames = computed(() => (plan.value?.renames.length ?? 0) > 0)

async function preview(): Promise<void> {
  loading.value = true
  const result = await props.tools.previewTemplate(props.scope)
  if (result && !result.template) result.template = props.template || null
  plan.value = result
  loading.value = false
}

onMounted(preview)

async function apply(): Promise<void> {
  if (!plan.value) return
  busy.value = true
  try {
    if (await props.tools.applyTemplate(props.scope, plan.value)) emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalShell :title="t('tools.template.title')" title-id="template-dialog-title" :busy="busy" wide @close="emit('close')">
    <div class="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pb-5">
      <p class="text-sm">{{ scopeLabel }}</p>
      <StateBlock v-if="loading" kind="loading" :message="t('tools.template.previewing')" />
      <StateBlock v-else-if="!plan" kind="error" :message="t('tools.template.previewFailed', { error: '' })" @retry="preview" />
      <template v-else>
        <p class="text-sm text-muted">
          {{ plan.template ? t('tools.template.template', { template: plan.template }) : t('tools.template.revert') }}
        </p>
        <div class="flex flex-wrap gap-2 text-sm">
          <span class="lm-badge lm-badge--accent">{{ t('tools.template.renames', { count: plan.renames.length }) }}</span>
          <span class="lm-badge">{{ t('tools.template.skipped', { count: plan.skipped }) }}</span>
          <span v-if="plan.failures.length" class="lm-badge lm-badge--warning">{{ t('tools.template.failures', { count: plan.failures.length }) }}</span>
        </div>
        <p v-if="!hasRenames" class="text-sm" role="status">{{ t('tools.template.nothing') }}</p>
        <div v-else class="max-h-[min(360px,45vh)] overflow-y-auto rounded-md hairline border-border">
          <table class="w-full text-left text-xs">
            <tbody>
              <tr v-for="rename in plan.renames.slice(0, SHOWN)" :key="rename.dir + rename.from" class="hairline-b border-border">
                <td class="lm-mono p-2 wrap-anywhere">{{ rename.from }}</td>
                <td class="p-2 text-muted" aria-hidden="true">→</td>
                <td class="lm-mono p-2 font-bold wrap-anywhere">{{ rename.to }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="plan.renames.length > SHOWN" class="p-2 text-xs text-muted">{{ t('organize.moreRows', { count: plan.renames.length - SHOWN }) }}</p>
        </div>
        <ul v-if="plan.failures.length" class="flex flex-col gap-1 rounded-md bg-warning-soft p-3 text-xs">
          <li v-for="failure in plan.failures.slice(0, 50)" :key="failure.model"><strong>{{ failure.model }}</strong>: {{ failure.message }}</li>
        </ul>
      </template>
      <div class="lm-dialog-footer">
        <button type="button" class="lm-btn" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</button>
        <button type="button" class="lm-btn lm-btn--danger" :disabled="busy || loading || !hasRenames" @click="apply">
          <AppIcon name="pencil" :size="16" />{{ t('tools.template.apply') }}
        </button>
      </div>
    </div>
  </ModalShell>
</template>
