/**
 * Theme registry: the single list of selectable themes.
 *
 * Built-in themes are bundled CSS files in this folder. User themes are CSS
 * files the backend lists from `<settings dir>/ui-themes/` (see
 * py/routes/modern_ui_routes.py) and are registered at runtime.
 *
 * Keep the storage keys in sync with the inline bootstrap in ui/index.html.
 */

export type ColorScheme = 'light' | 'dark'

export interface ThemeDefinition {
  id: string
  label: string
  scheme: ColorScheme
  description?: string
  source: 'builtin' | 'user'
  /** Stylesheet URL relative to the app base (user themes only). */
  href?: string
}

export const SYSTEM_THEME = 'system'
export const THEME_STORAGE_KEY = 'lm-ui.theme'
export const USER_THEME_STORAGE_KEY = 'lm-ui.theme.user'
export const DENSITY_STORAGE_KEY = 'lm-ui.density'
/** Highlight choice: a preset id or `#rrggbb` (themes/highlight.ts). */
export const HIGHLIGHT_STORAGE_KEY = 'lm-ui.highlight'
/** The resolved accent tokens for both schemes, so the pre-paint script needs no colour maths. */
export const HIGHLIGHT_VARS_STORAGE_KEY = 'lm-ui.highlight.vars'
/** Text size: s | m | l | xl (data-scale on <html>). */
export const SCALE_STORAGE_KEY = 'lm-ui.scale'
export const DEFAULT_LIGHT_THEME = 'default-light'
export const DEFAULT_DARK_THEME = 'default-dark'

export const BUILTIN_THEMES: readonly ThemeDefinition[] = [
  { id: DEFAULT_LIGHT_THEME, label: 'Light', scheme: 'light', source: 'builtin', description: 'Default light theme' },
  { id: DEFAULT_DARK_THEME, label: 'Dark', scheme: 'dark', source: 'builtin', description: 'Default dark theme' },
]

const USER_THEME_HREF_RE = /^user-themes\/[\w.-]+\.css$/
const THEME_ID_RE = /^[A-Za-z0-9][\w-]*$/

/** Validate and normalise a theme entry returned by GET /api/lm/ui/themes. */
export function toUserTheme(raw: unknown): ThemeDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const id = typeof entry.id === 'string' ? entry.id : ''
  const href = typeof entry.href === 'string' ? entry.href : ''
  if (!THEME_ID_RE.test(id) || !USER_THEME_HREF_RE.test(href)) return null
  if (BUILTIN_THEMES.some((theme) => theme.id === id)) return null
  return {
    id,
    href,
    label: typeof entry.label === 'string' && entry.label ? entry.label : id,
    scheme: entry.scheme === 'dark' ? 'dark' : 'light',
    description: typeof entry.description === 'string' ? entry.description : '',
    source: 'user',
  }
}

/** Resolve a stored choice ("system" or a theme id) to a concrete theme id. */
export function resolveThemeId(
  choice: string,
  prefersDark: boolean,
  available: readonly ThemeDefinition[],
): string {
  if (choice !== SYSTEM_THEME && available.some((theme) => theme.id === choice)) {
    return choice
  }
  return prefersDark ? DEFAULT_DARK_THEME : DEFAULT_LIGHT_THEME
}
