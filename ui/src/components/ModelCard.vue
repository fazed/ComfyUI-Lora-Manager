<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from './AppIcon.vue'
import type { ModelItem } from '@/api/types'
import { withMountPrefix } from '@/utils/basePath'
import { isVideoUrl } from '@/utils/format'
import { t } from '@/i18n'

const props = defineProps<{
  item: ModelItem
  selectionMode: boolean
  selected: boolean
  blurMature: boolean
}>()

const emit = defineEmits<{
  open: [item: ModelItem]
  'toggle-select': [item: ModelItem]
  'toggle-favorite': [item: ModelItem]
}>()

const failed = ref(false)
const video = ref<HTMLVideoElement | null>(null)
const previewUrl = computed(() => (props.item.preview_url ? withMountPrefix(props.item.preview_url) : ''))
const isVideo = computed(() => isVideoUrl(props.item.preview_url))
const displayName = computed(() => props.item.model_name || props.item.file_name)
// Civitai NSFW levels: 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX.
const blurred = computed(() => props.blurMature && (props.item.preview_nsfw_level ?? 0) >= 4)
const tags = computed(() => (props.item.tags ?? []).slice(0, 3))

function activate(): void {
  if (props.selectionMode) emit('toggle-select', props.item)
  else emit('open', props.item)
}

function play(): void {
  void video.value?.play().catch(() => undefined)
}

function pause(): void {
  video.value?.pause()
}
</script>

<template>
  <article
    class="card"
    :class="{ 'card--selected': selected, 'card--selecting': selectionMode }"
    @mouseenter="play"
    @mouseleave="pause"
  >
    <button
      type="button"
      class="card__hit"
      :aria-label="selectionMode ? t('card.selectItem', { name: displayName }) : t('card.open', { name: displayName })"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="activate"
      @focus="play"
      @blur="pause"
    ></button>

    <div class="card__media" :class="{ 'card__media--blurred': blurred }">
      <template v-if="previewUrl && !failed">
        <video
          v-if="isVideo"
          ref="video"
          :src="previewUrl"
          muted
          loop
          playsinline
          preload="metadata"
          @error="failed = true"
        ></video>
        <img v-else :src="previewUrl" :alt="''" loading="lazy" decoding="async" @error="failed = true" />
      </template>
      <div v-else class="card__placeholder">
        <AppIcon name="image" :size="32" />
        <span>{{ t('card.noPreview') }}</span>
      </div>
    </div>

    <div class="card__top">
      <span v-if="item.base_model" class="card__pill">{{ item.base_model }}</span>
      <span v-if="item.update_available" class="card__pill card__pill--accent">
        <AppIcon name="arrowUp" :size="12" />{{ t('card.update') }}
      </span>
      <span class="card__spacer"></span>
      <span v-if="selectionMode" class="card__check" :class="{ 'card__check--on': selected }" aria-hidden="true">
        <AppIcon v-if="selected" name="check" :size="14" />
      </span>
      <button
        v-else
        type="button"
        class="card__fav"
        :class="{ 'card__fav--on': item.favorite }"
        :aria-label="t('detail.toggleFavorite')"
        :aria-pressed="!!item.favorite"
        @click.stop="emit('toggle-favorite', item)"
      >
        <AppIcon name="star" :size="16" :filled="!!item.favorite" />
      </button>
    </div>

    <div class="card__info">
      <h3 class="card__name" :title="displayName">{{ displayName }}</h3>
      <div v-if="tags.length" class="card__tags">
        <span v-for="tag in tags" :key="tag" class="card__tag">{{ tag }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  height: 100%;
  overflow: hidden;
  border: var(--lm-border-width) solid var(--lm-color-border);
  border-radius: var(--lm-radius-md);
  background: var(--lm-color-sunken);
  box-shadow: var(--lm-shadow-sm);
  transition:
    transform var(--lm-motion-fast) var(--lm-ease),
    box-shadow var(--lm-motion-fast) var(--lm-ease),
    border-color var(--lm-motion-fast) var(--lm-ease);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--lm-shadow-md);
}

.card--selected {
  border-color: var(--lm-color-accent);
  box-shadow: 0 0 0 var(--lm-focus-ring-width) var(--lm-color-accent);
}

.card__hit {
  position: absolute;
  inset: 0;
  z-index: 2;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: inherit;
}

.card__hit:focus-visible {
  outline-offset: -3px;
}

.card__media {
  position: absolute;
  inset: 0;
}

.card__media img,
.card__media video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card__media--blurred img,
.card__media--blurred video {
  filter: blur(18px);
  transform: scale(1.1);
}

.card__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--lm-space-2);
  height: 100%;
  color: var(--lm-color-muted);
  font-size: var(--lm-font-size-xs);
}

.card__top {
  position: absolute;
  inset: var(--lm-space-2) var(--lm-space-2) auto var(--lm-space-2);
  z-index: 3;
  display: flex;
  align-items: flex-start;
  gap: var(--lm-space-1);
  pointer-events: none;
}

.card__spacer {
  flex: 1;
}

.card__pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 1px var(--lm-space-2);
  border-radius: var(--lm-radius-pill);
  background: var(--lm-color-scrim);
  color: var(--lm-color-on-scrim);
  font-size: var(--lm-font-size-xs);
  font-weight: var(--lm-font-weight-medium);
  white-space: nowrap;
}

.card__pill--accent {
  background: var(--lm-color-accent);
  color: var(--lm-color-on-accent);
}

.card__fav,
.card__check {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: var(--lm-radius-pill);
  background: var(--lm-color-scrim);
  color: var(--lm-color-on-scrim);
  pointer-events: auto;
  cursor: pointer;
}

.card__fav {
  opacity: 0;
  transition: opacity var(--lm-motion-fast) var(--lm-ease);
}

.card:hover .card__fav,
.card__fav:focus-visible,
.card__fav--on {
  opacity: 1;
}

.card__fav--on {
  color: var(--lm-color-warning);
}

.card__check {
  pointer-events: none;
  border: 2px solid var(--lm-color-on-scrim);
}

.card__check--on {
  background: var(--lm-color-accent);
  border-color: var(--lm-color-accent);
  color: var(--lm-color-on-accent);
}

.card__info {
  position: absolute;
  inset: auto 0 0 0;
  z-index: 1;
  padding: var(--lm-space-6) var(--lm-space-3) var(--lm-space-3);
  background: linear-gradient(to top, var(--lm-color-scrim), transparent);
  color: var(--lm-color-on-scrim);
  pointer-events: none;
}

.card__name {
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: var(--lm-font-size-sm);
  font-weight: var(--lm-font-weight-bold);
}

.card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lm-space-1);
  margin-top: var(--lm-space-1);
  max-height: 1.6em;
  overflow: hidden;
}

.card__tag {
  font-size: var(--lm-font-size-xs);
  opacity: 0.85;
}

.card__tag:not(:last-child)::after {
  content: '\00B7';
  margin-left: var(--lm-space-1);
}
</style>
