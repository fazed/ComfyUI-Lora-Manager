/**
 * Theme + density state (app-wide singleton).
 *
 * The inline bootstrap in index.html applies the stored choice before first
 * paint; this composable takes over afterwards: it follows the system color
 * scheme for the "system" choice, loads user themes from the backend and
 * persists changes.
 */

import { computed, ref } from 'vue'
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
import { readJson, readStorage, writeStorage } from '@/utils/storage'

export type Density = 'comfortable' | 'compact'

const choice = ref<string>(readStorage(THEME_STORAGE_KEY) || SYSTEM_THEME)
const density = ref<Density>(readStorage(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable')
const userThemes = ref<ThemeDefinition[]>([])
const userThemesDir = ref('')
const prefersDark = ref(false)
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

function persist(): void {
  writeStorage(THEME_STORAGE_KEY, choice.value)
  writeStorage(DENSITY_STORAGE_KEY, density.value)
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
  try {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    prefersDark.value = media.matches
    media.addEventListener('change', (event) => {
      prefersDark.value = event.matches
      apply()
    })
  } catch {
    prefersDark.value = false
  }
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
