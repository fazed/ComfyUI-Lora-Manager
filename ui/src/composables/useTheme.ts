/**
 * Theme + density state (app-wide singleton).
 *
 * The inline bootstrap in index.html applies the stored choice before first
 * paint; this composable takes over afterwards: it follows the system color
 * scheme for the "system" choice, loads user themes from the backend and
 * persists changes.
 */

import { computed, ref, watch } from 'vue'
import { useLocalStorage, usePreferredDark } from '@vueuse/core'
import { themesApi } from '@/api/endpoints'
import {
  BUILTIN_THEMES,
  DENSITY_STORAGE_KEY,
  SYSTEM_THEME,
  THEME_STORAGE_KEY,
  USER_THEME_STORAGE_KEY,
  resolveThemeId,
  toUserTheme,
  type ThemeDefinition,
} from '@/themes/registry'
import { appUrl } from '@/utils/basePath'
import { readJson, writeStorage } from '@/utils/storage'

export type Density = 'comfortable' | 'compact'

// Stored as plain strings under the keys the pre-paint script in index.html reads;
// written on change only, blocked storage is ignored.
const storageOptions = { writeDefaults: false, onError: () => undefined } as const
const choice = useLocalStorage<string>(THEME_STORAGE_KEY, SYSTEM_THEME, {
  ...storageOptions,
  serializer: { read: (raw) => raw || SYSTEM_THEME, write: (value) => value },
})
const density = useLocalStorage<Density>(DENSITY_STORAGE_KEY, 'comfortable', {
  ...storageOptions,
  serializer: { read: (raw) => (raw === 'compact' ? 'compact' : 'comfortable'), write: (value) => value },
})
const userThemes = ref<ThemeDefinition[]>([])
const userThemesDir = ref('')
// Live (prefers-color-scheme: dark); false where matchMedia is unavailable.
const prefersDark = usePreferredDark()
let initialised = false

const available = computed<ThemeDefinition[]>(() => [...BUILTIN_THEMES, ...userThemes.value])
const activeId = computed(() => resolveThemeId(choice.value, prefersDark.value, available.value))
const activeTheme = computed(() => available.value.find((theme) => theme.id === activeId.value) ?? BUILTIN_THEMES[0])

function apply(): void {
  const root = document.documentElement
  const theme = activeTheme.value
  root.setAttribute('data-theme', theme.id)
  root.setAttribute('data-density', density.value)
  root.style.colorScheme = theme.scheme

  // Exactly one user-theme stylesheet, and only for the active user theme.
  const existing = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[data-user-theme]'))
  for (const link of existing) {
    if (link.getAttribute('data-user-theme') !== theme.id) link.remove()
  }
  if (theme.source === 'user' && theme.href && !existing.some((l) => l.getAttribute('data-user-theme') === theme.id && l.isConnected)) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = appUrl(theme.href)
    link.setAttribute('data-user-theme', theme.id)
    document.head.appendChild(link)
  }
}

/** The theme choice and density persist through their storage refs; the active user theme's stylesheet is cached here. */
function persist(): void {
  const theme = activeTheme.value
  writeStorage(
    USER_THEME_STORAGE_KEY,
    theme.source === 'user' ? JSON.stringify({ id: theme.id, href: theme.href, scheme: theme.scheme }) : null,
  )
}

async function loadUserThemes(): Promise<void> {
  try {
    const response = await themesApi.list()
    userThemes.value = (response.themes ?? []).map(toUserTheme).filter((t): t is ThemeDefinition => t !== null)
    userThemesDir.value = response.directory ?? ''
  } catch {
    // Older backends without the theme endpoint: built-in themes only.
    userThemes.value = []
  }
  apply()
}

function init(): void {
  if (initialised) return
  initialised = true
  watch(prefersDark, () => apply())
  // Seed the stored user theme so the first apply() keeps the stylesheet the
  // inline bootstrap already attached (no flash while the list loads).
  const stored = toUserTheme(readJson<unknown>(USER_THEME_STORAGE_KEY, null))
  if (stored && stored.id === choice.value) userThemes.value = [stored]
  apply()
  void loadUserThemes()
}

export function useTheme() {
  init()
  return {
    choice,
    density,
    available,
    userThemes,
    userThemesDir,
    activeTheme,
    setTheme(id: string) {
      choice.value = id
      apply()
      persist()
    },
    setDensity(value: Density) {
      density.value = value
      apply()
      persist()
    },
    reloadUserThemes: loadUserThemes,
  }
}
