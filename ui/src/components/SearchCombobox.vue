<script setup lang="ts">
/**
 * Search input with an autocomplete listbox (WAI-ARIA combobox pattern),
 * used by the global top-bar search (scope 'all') and the local library
 * search (scope = library prefix or 'recipes').
 *
 * Keyboard: Down/Up move through the options (wrapping), Enter picks the
 * active option or commits the text, Escape closes the list (a second Escape
 * clears the box), Tab closes the list and moves on.
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppIcon, { type IconName } from './AppIcon.vue'
import SearchThumb from './SearchThumb.vue'
import { useSuggestions } from '@/composables/useSearch'
import { NAV_TABS } from '@/config/navigation'
import { isModelScope } from '@/api/suggestSource'
import { useAppSettings } from '@/composables/useAppSettings'
import {
  buildSuggestOptions,
  moveActive,
  sectionOptions,
  splitHighlight,
  SUGGEST_MIN_CHARS,
  type SuggestOption,
} from '@/utils/suggest'
import { t, type MessageKey } from '@/i18n'

const props = withDefaults(
  defineProps<{
    id: string
    scope: string
    modelValue: string
    placeholder: string
    label: string
    /** 'global' adds section names per library, type icons and "See all" rows. */
    mode?: 'global' | 'local'
    maxPerGroup?: number
    maxTags?: number
    activeTags?: string[]
    /** Shown as a keyboard hint inside the box (e.g. "/"). */
    shortcutHint?: string
    /** Positioning/size classes of the dropdown panel. */
    panelClass?: string
    inputClass?: string
  }>(),
  {
    mode: 'local',
    maxPerGroup: 6,
    maxTags: 5,
    activeTags: () => [],
    shortcutHint: '',
    panelClass: 'inset-x-0 top-[calc(100%+var(--lm-space-1))]',
    inputClass: '',
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  /** Plain search with the given text ('' = cleared). */
  commit: [value: string]
  /** An item, "See all" or tag option. */
  choose: [option: SuggestOption]
}>()

const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const activeIndex = ref(-1)
const listboxId = `${props.id}-listbox`
const { load: loadSettings } = useAppSettings()
const suggestions = useSuggestions(() => props.scope)

const text = computed(() => props.modelValue)
const options = computed(() =>
  buildSuggestOptions(suggestions.result.value, text.value, {
    idPrefix: props.id,
    maxPerGroup: props.maxPerGroup,
    maxTags: props.maxTags,
    seeAll: props.mode === 'global',
    activeTags: props.activeTags,
  }),
)
const sections = computed(() => sectionOptions(options.value))
const expanded = computed(() => open.value && text.value.trim().length >= SUGGEST_MIN_CHARS && options.value.length > 0)
const activeId = computed(() => (expanded.value ? options.value[activeIndex.value]?.id : undefined))
const resultCount = computed(() => options.value.filter((option) => option.kind === 'item' || option.kind === 'tag').length)

const SCOPE_LABEL: Record<string, MessageKey> = {
  loras: 'nav.loras',
  checkpoints: 'nav.checkpoints',
  embeddings: 'nav.embeddings',
  recipes: 'nav.recipes',
}

function sectionLabel(group: string): string {
  if (group === 'tags') return t('suggest.tags')
  if (group === 'search') return ''
  if (props.mode === 'global') return SCOPE_LABEL[group] ? t(SCOPE_LABEL[group]) : group
  return t(isModelScope(group) ? 'suggest.items' : 'suggest.recipes')
}

function scopeIcon(scope: string): IconName {
  return NAV_TABS.find((tab) => tab.to === `/${scope}`)?.icon ?? 'search'
}

watch(
  () => props.scope,
  () => {
    suggestions.reset()
    close()
  },
)

// Keep the active option in range when the list changes.
watch(options, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = -1
})

onMounted(() => void loadSettings())

function close(): void {
  open.value = false
  activeIndex.value = -1
}

function onInput(event: Event): void {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
  activeIndex.value = -1
  open.value = true
  suggestions.request(value)
}

function reopen(): void {
  if (text.value.trim().length < SUGGEST_MIN_CHARS) return
  open.value = true
  if (!suggestions.result.value) suggestions.request(text.value)
}

function clearText(): void {
  emit('update:modelValue', '')
  emit('commit', '')
  suggestions.reset()
  close()
}

function choose(option: SuggestOption): void {
  close()
  if (option.kind === 'search') emit('commit', option.query)
  else emit('choose', option)
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      event.preventDefault()
      if (!expanded.value) {
        reopen()
        return
      }
      activeIndex.value = moveActive(activeIndex.value, options.value.length, event.key === 'ArrowDown' ? 1 : -1)
      document.getElementById(options.value[activeIndex.value]?.id ?? '')?.scrollIntoView({ block: 'nearest' })
      return
    }
    case 'Enter': {
      if (event.isComposing) return
      event.preventDefault()
      const option = expanded.value ? options.value[activeIndex.value] : undefined
      if (option) choose(option)
      else {
        close()
        emit('commit', text.value.trim())
      }
      return
    }
    case 'Escape':
      if (expanded.value) {
        event.preventDefault()
        event.stopPropagation()
        close()
      } else if (text.value) {
        event.preventDefault()
        event.stopPropagation()
        clearText()
      }
      return
    case 'Tab':
      close()
      return
  }
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget as Node | null
  if (!next || !(event.currentTarget as HTMLElement).contains(next)) close()
}

defineExpose({
  focus: () => {
    input.value?.focus()
    input.value?.select()
  },
})
</script>

<template>
  <!-- The root positions the dropdown (a parent may make it static to anchor the panel elsewhere); the inner box positions the icons. -->
  <div class="relative" @focusout="onFocusOut">
    <div class="relative">
      <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <label class="sr-only" :for="id">{{ label }}</label>
      <input
        :id="id"
        ref="input"
        :value="modelValue"
        class="lm-input pl-[calc(var(--lm-space-3)*2+18px)]"
        :class="[inputClass, modelValue ? 'pr-[64px]' : shortcutHint ? 'pr-[36px] phone:pr-3' : 'pr-3']"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        enterkeyhint="search"
        aria-autocomplete="list"
        :aria-expanded="expanded"
        :aria-controls="listboxId"
        :aria-activedescendant="activeId"
        :placeholder="placeholder"
        @input="onInput"
        @keydown="onKeydown"
        @click="reopen"
      />
      <div class="absolute inset-y-0 right-2 flex items-center gap-1">
        <span
          v-if="suggestions.loading.value && open"
          class="size-[14px] animate-spinner rounded-pill border-2 border-border border-t-accent"
          role="status"
          :aria-label="t('suggest.loading')"
        ></span>
        <button
          v-if="modelValue"
          type="button"
          class="lm-btn lm-btn--ghost lm-btn--icon lm-btn--sm"
          :aria-label="t('suggest.clear')"
          :title="t('suggest.clear')"
          @click="clearText(), input?.focus()"
        >
          <AppIcon name="close" :size="14" />
        </button>
        <kbd
          v-else-if="shortcutHint"
          class="rounded-sm hairline border-border px-1 font-mono text-xs text-muted phone:hidden"
          aria-hidden="true"
        >{{ shortcutHint }}</kbd>
      </div>
    </div>

    <div
      v-show="expanded"
      :id="listboxId"
      role="listbox"
      :aria-label="label"
      :aria-busy="suggestions.loading.value"
      class="absolute z-60 max-h-[min(70vh,520px)] overflow-y-auto overscroll-contain rounded-md hairline border-border bg-elevated p-1 shadow-lg"
      :class="panelClass"
    >
      <div
        v-for="section in sections"
        :key="section.group"
        role="group"
        :aria-labelledby="section.group === 'search' ? undefined : `${id}-sec-${section.group}`"
        :aria-label="section.group === 'search' ? t('topbar.search') : undefined"
        class="hairline-t border-border py-1 first:border-t-0"
      >
        <div
          v-if="section.group !== 'search'"
          :id="`${id}-sec-${section.group}`"
          role="presentation"
          class="lm-overline px-2 pt-1 pb-1"
        >
          {{ sectionLabel(section.group) }}
        </div>
        <div
          v-for="option in section.options"
          :id="option.id"
          :key="option.id"
          role="option"
          :aria-selected="option.id === activeId"
          class="flex min-h-control cursor-pointer items-center gap-3 rounded-sm px-2 py-1 text-sm"
          :class="option.id === activeId ? 'bg-accent-soft' : 'hover:bg-sunken'"
          @mousedown.prevent
          @mousemove="activeIndex = options.indexOf(option)"
          @click="choose(option)"
        >
          <template v-if="option.kind === 'item'">
            <SearchThumb :item="option.item" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-fg">
                <template v-for="(part, index) in splitHighlight(option.item.name, modelValue)" :key="index">
                  <mark v-if="part.match" class="bg-transparent font-bold text-accent">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span
                v-if="option.item.secondary && option.item.secondary !== option.item.name"
                class="truncate text-xs text-muted"
              >
                <template v-for="(part, index) in splitHighlight(option.item.secondary, modelValue)" :key="index">
                  <mark v-if="part.match" class="bg-transparent font-medium text-fg">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </span>
            <span v-if="option.item.badge" class="lm-badge max-w-[40%] flex-none truncate">{{ option.item.badge }}</span>
            <AppIcon v-if="mode === 'global'" :name="scopeIcon(option.group)" :size="14" class="flex-none text-muted" />
          </template>

          <template v-else-if="option.kind === 'more'">
            <AppIcon name="chevronRight" :size="16" class="flex-none text-muted" />
            <span class="flex-1 text-accent">
              {{ t('suggest.seeAll', { count: option.total.toLocaleString(), section: sectionLabel(option.scope) }) }}
            </span>
          </template>

          <template v-else-if="option.kind === 'tag'">
            <AppIcon name="tag" :size="16" class="flex-none text-muted" />
            <span class="min-w-0 flex-1 truncate">
              <template v-for="(part, index) in splitHighlight(option.tag.tag, modelValue)" :key="index">
                <mark v-if="part.match" class="bg-transparent font-bold text-accent">{{ part.text }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
            <span class="flex-none text-xs text-muted tabular-nums">{{ option.tag.count }}</span>
          </template>

          <template v-else>
            <AppIcon name="search" :size="16" class="flex-none text-muted" />
            <span class="min-w-0 flex-1 truncate">
              {{ t(mode === 'global' ? 'suggest.searchAllFor' : 'suggest.searchFor', { query: option.query }) }}
            </span>
            <kbd class="flex-none font-mono text-xs text-muted phone:hidden" aria-hidden="true">Enter</kbd>
          </template>
        </div>
      </div>
    </div>
    <span class="sr-only" aria-live="polite">{{
      expanded && !suggestions.loading.value ? t('suggest.count', { count: resultCount }) : ''
    }}</span>
  </div>
</template>
