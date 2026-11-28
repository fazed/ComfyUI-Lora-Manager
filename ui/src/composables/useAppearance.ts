/**
 * Highlight colour + text size (app-wide singleton, next to useTheme).
 *
 * The inline bootstrap in index.html applies the stored scale and the stored
 * resolved highlight before first paint; this composable keeps them in sync
 * afterwards. The highlight only applies to the built-in themes: with a user
 * theme active, its own accent tokens win.
 */

import { watch } from 'vue'
import { useLocalStorage } from '@vueuse/core'
import { useTheme } from '@/composables/useTheme'
import { BUILTIN_SURFACES, DEFAULT_HIGHLIGHT, isHighlightChoice, resolveHighlight, type HighlightVars } from '@/themes/highlight'
import { HIGHLIGHT_STORAGE_KEY, HIGHLIGHT_VARS_STORAGE_KEY, SCALE_STORAGE_KEY, type ColorScheme } from '@/themes/registry'
import { writeStorage } from '@/utils/storage'

export type TextScale = 's' | 'm' | 'l' | 'xl'
export const TEXT_SCALES: readonly TextScale[] = ['s', 'm', 'l', 'xl']
const SCHEMES: readonly ColorScheme[] = ['dark', 'light']

const storageOptions = { writeDefaults: false, onError: () => undefined } as const
const highlight = useLocalStorage<string>(HIGHLIGHT_STORAGE_KEY, DEFAULT_HIGHLIGHT, {
  ...storageOptions,
  serializer: { read: (raw) => (raw && isHighlightChoice(raw) ? raw : DEFAULT_HIGHLIGHT), write: (value) => value },
})
const scale = useLocalStorage<TextScale>(SCALE_STORAGE_KEY, 'm', {
  ...storageOptions,
  serializer: { read: (raw) => (TEXT_SCALES.includes(raw as TextScale) ? (raw as TextScale) : 'm'), write: (value) => value },
})
let initialised = false

const ACCENT_PROPERTIES: Record<keyof HighlightVars, string> = {
  accent: '--lm-color-accent',
  accentHover: '--lm-color-accent-hover',
  accentSoft: '--lm-color-accent-soft',
  onAccent: '--lm-color-on-accent',
}

function apply(): void {
  const root = document.documentElement
  root.setAttribute('data-scale', scale.value)
  const theme = useTheme().activeTheme.value
  const custom = highlight.value !== DEFAULT_HIGHLIGHT
  const vars = custom && theme.source === 'builtin' ? resolveHighlight(highlight.value, theme.scheme, BUILTIN_SURFACES[theme.scheme]) : null
  for (const [key, property] of Object.entries(ACCENT_PROPERTIES) as [keyof HighlightVars, string][]) {
    if (vars) root.style.setProperty(property, vars[key])
    else root.style.removeProperty(property)
  }
}

/** Resolved values for both schemes, read by the pre-paint script (no entry for the default: the theme files already match it). */
function persistVars(): void {
  writeStorage(
    HIGHLIGHT_VARS_STORAGE_KEY,
    highlight.value === DEFAULT_HIGHLIGHT
      ? null
      : JSON.stringify(
          Object.fromEntries(SCHEMES.map((scheme) => [scheme, resolveHighlight(highlight.value, scheme, BUILTIN_SURFACES[scheme])])),
        ),
  )
}

function init(): void {
  if (initialised) return
  initialised = true
  watch(() => useTheme().activeTheme.value, apply)
  apply()
}

export function useAppearance() {
  init()
  return {
    highlight,
    scale,
    setHighlight(value: string) {
      highlight.value = value
      persistVars()
      apply()
    },
    setScale(value: TextScale) {
      scale.value = value
      apply()
    },
  }
}
