# LoRA Manager modern UI (`ui/`)

A fork-local, single-page replacement for the classic LoRA Manager web UI.
It is built with Vue 3 + Vite + TypeScript (same toolchain versions as
`vue-widgets/`) and styled with Tailwind CSS v4 on top of design tokens, talks to the same `/api/lm/...` endpoints as the classic UI,
and is served by the backend at **`/lm-ui/`**. The classic UI
(`templates/` + `static/`) is untouched and keeps working at `/loras`.

Open it at `http://<comfyui-host>:<port>/lm-ui/` (for example
`http://127.0.0.1:8188/lm-ui/`). Behind a reverse proxy that mounts ComfyUI
under a prefix, use `<prefix>/lm-ui/`.

## Architecture

```
ui/
  index.html              pre-paint theme bootstrap (inline script) + app mount
  src/
    main.ts, App.vue      app shell (top bar, full-width content, toasts, confirm dialog)
    router.ts             history routes below the app base (/lm-ui/...)
    api/                  typed client: http.ts (fetch wrapper, ApiError),
                          endpoints.ts (model/download/settings/recipe/theme APIs),
                          types.ts (response shapes)
    composables/          useInfiniteList, usePolling (visibility-aware),
                          useDownloadQueue (shared poller), useTheme,
                          useLibraryFilters, useAppSettings, useFeedback, useSearch,
                          useFolderPanel, useDismiss (overlay stack: Escape and
                          outside/backdrop clicks close only the topmost overlay;
                          a backdrop click needs pointerdown + click on the backdrop)
    components/           TopBar, AppMenu/ThemeOptions, SearchCombobox, VirtualGrid,
                          ModelCard, ModelDrawer, ExampleLightbox,
                          BaseModelQuickFilter, NodePickerDialog, FolderTree,
                          ModelActionMenu, ModalShell, InputDialog, MoveDialog,
                          OrganizeDialog, GenerationDetails, Recipe* (card,
                          drawer, reconnect form, import / batch import /
                          move / duplicates dialogs), ...
    pages/                LibraryPage (generic, per model type), RecipesPage,
                          SearchPage, DownloadsPage, SettingsPage, NotFoundPage
    config/libraries.ts   per-type config (loras / checkpoints / embeddings)
    config/navigation.ts  top-bar tabs, active state, search route targets
    themes/               design tokens + themes + registry.ts
    styles/main.css       stylesheet entry: Tailwind + tokens.css + app.css
    styles/tokens.css     Tailwind theme mapped onto the design tokens
    styles/app.css        base rules + shared classes (buttons, inputs, chips)
    i18n/index.ts         all English UI strings in one table, t(key, params)
    utils/                basePath, format, civitai URL parsing, query builder,
                          HTML sanitizer, settings form helpers, suggest (autocomplete core)
  tests/                  vitest (jsdom): API client, helpers, composables,
                          theme registry, style-token lint
  dist/                   build output - COMMITTED (users have no Node/Bun)
```

Runtime dependencies: `vue`, `vue-router` and `@vueuse/core` (pinned 13.9.0,
tree-shaken: only the imported functions end up in the bundle). No UI kit, no
CDN, no runtime-fetched assets; icons are inline SVG paths using `currentColor`.
Tailwind (`tailwindcss` + `@tailwindcss/vite`, pinned 4.3.5) is a build-time
dev dependency only: the compiled, purged CSS ends up in `ui/dist`.

### VueUse

Prefer a VueUse function over hand-rolled listener/timer/observer code; it
cleans up with the component scope. Currently used:

- `useEventListener` (drawer keys, top-bar `/` and Ctrl/Cmd+K shortcut,
  grid stylesheet loads, `useDismiss` Escape/outside listeners attached only
  while an overlay is open);
- `useResizeObserver`, `useMutationObserver` (VirtualGrid width and theme/density
  token re-reads);
- `useTimeoutFn` (search-suggestion debounce, library/recipes search apply,
  LazyMedia placeholder removal);
- `useLocalStorage` (theme choice, density, remembered toggles such as the
  drawer specifications; same keys and plain-string values as before, written
  on change only, blocked storage ignored);
- `usePreferredDark` (the "System" theme follows the OS live).

Kept custom on purpose: `createPoller` (shared, scope-less download poller with
no-overlap rescheduling and visibility pause; `useIntervalFn` cannot express
"next run after the previous finished"), `copyText` (`useClipboard` cannot
report a failed copy, which the error toast needs), the per-library
sort/card-size store (validated on read), `useFolderPanel` (writes only on wide
viewports; tested with an injected width) and the grid virtualisation
(`useVirtualList` is not a 2-D grid). No `useScrollLock`: the page body never
scrolls (the grid and drawer scroll inside the app shell).

### Media loading (LazyMedia)

`components/LazyMedia.vue` renders every image/video (library cards, drawer
cover, example thumbnails, version thumbs, lightbox, search thumbnails,
downloads, recipes). The caller sizes the box (classes on the component), so
loading never shifts the layout; `media-class` goes on the `<img>`/`<video>`
(object-fit, `lm-zoom-media`, blur), so the card hover zoom still scales the
media. States (`utils/mediaLoad.ts`): loading shows a `--lm-color-skeleton`
placeholder with a subtle shimmer (starts after 250 ms, off for
`prefers-reduced-motion`); loaded fades in over `--lm-fade-duration` after
`img.decode()`; media that is already complete, or loads within 120 ms (cache,
e.g. a card scrolled back into the virtual grid), appears at once; error/no
src shows the `fallback` slot (default an image icon) and, with `retry`, a
Retry button. A new `src` resets the state. Images use `loading="lazy"` and
`decoding="async"` (the drawer cover and lightbox are `eager` with
`fetchpriority="high"`); native lazy loading is used instead of an
IntersectionObserver per card, because the virtual grid only renders rows near
the viewport anyway.

### Backend route and prefix handling

`py/routes/modern_ui_routes.py` (new, fork-only module) registers:

| Route | Purpose |
| --- | --- |
| `GET /lm-ui` | relative redirect to `lm-ui/` (keeps any proxy prefix) |
| `GET /lm-ui/{tail}` | files with an extension are served from `ui/dist` (404 when missing, long cache for hashed `assets/`); everything else falls back to `index.html` |
| `GET /lm-ui/user-themes/{file}.css` | user theme files (see Theming) |
| `GET /api/lm/ui/themes` | lists user themes from `<settings dir>/ui-themes/` |

Prefix handling mirrors the classic UI's `relative_root_prefix`: the backend
only sees the stripped path, so for the SPA fallback it injects a **relative**
`<base href>` (`./` for `/lm-ui/x`, `../` for `/lm-ui/x/y`, ...). Vite builds
with `base: './'`, so every asset resolves against that base. At runtime
`src/utils/basePath.ts` derives:

* `appPath` - router history base (`<prefix>/lm-ui/`), from `document.baseURI`;
* `mountPrefix` - the part in front of `/lm-ui` (`""` normally, `/comfy` behind
  a proxy). Every API call and every root-absolute URL coming from the backend
  (`preview_url: "/api/lm/previews?..."`) is prefixed with it.

This works in ComfyUI plugin mode, in `standalone.py`, and behind proxies
that strip a path prefix.

## Development

Bun is used for everything (no Node/npm required):

```bash
cd ui
bun install
bun run dev        # Vite dev server on http://localhost:5174/lm-ui/
                   # proxies /api, /loras_static, /example_images_static and
                   # /lm-ui/user-themes to http://127.0.0.1:8188
                   # (override with LM_BACKEND=http://host:port)
bun run typecheck  # vue-tsc
bun run test       # vitest
bun run build      # typecheck + production build into ui/dist
```

Note that `bun run dev` talks to a real backend: actions such as saving
notes, editing settings or queueing downloads really happen there.

### Build and commit rule

`ui/dist` is committed because end users install the node without any
JavaScript toolchain. After every change under `ui/src` (or `index.html`):

1. `bun run test && bun run build`
2. commit the source **and** the regenerated `ui/dist` together.

`ui/node_modules/` is git-ignored.

## Syncing the fork with upstream safely

Everything lives in new paths (`ui/`, `py/routes/modern_ui_routes.py`,
`tests/routes/test_modern_ui_routes.py`), so upstream merges normally do not
conflict. The only upstream-owned files that were touched are listed below;
if a merge conflicts there, keep upstream's version and re-add the two lines.

| File | Change |
| --- | --- |
| `py/lora_manager.py` | after `PreviewRoutes.setup_routes(app)` in `LoraManager.add_routes`: a comment line plus `from .routes.modern_ui_routes import ModernUiRoutes; ModernUiRoutes.setup_routes(app)` |
| `standalone.py` | after `PreviewRoutes.setup_routes(app)` in `StandaloneLoraManager.add_routes`: a comment line plus `from py.routes.modern_ui_routes import ModernUiRoutes; ModernUiRoutes.setup_routes(app)` |
| `.gitignore` | `ui/node_modules/` (plus a comment) |

No templates, static files or locale files were changed. A "Modern UI" link
in the classic UI would require editing upstream templates, so it was left
out; use `/lm-ui/` directly (the new UI links back to the classic one).

After pulling upstream, check that the endpoints used in `src/api/endpoints.ts`
still exist (`py/routes/model_route_registrar.py`, `misc_route_registrar.py`,
`recipe_route_registrar.py`) and run `bun run test`.

## Theming

All visual styling goes through CSS custom properties (design tokens).
Components are styled with Tailwind utility classes, and every utility
resolves to a token (see "Tailwind and the tokens" below), so themes, density
and user themes change the whole UI without touching a component. Icons use
`currentColor`, so they follow the text color of any theme.

**Rule: no raw colors, no default palette.** `tests/styleTokens.test.ts`
fails, anywhere in `src/` outside `src/themes/` and `src/styles/tokens.css`, on:

* raw hex/rgb/hsl/oklch/named colors, raw `border-radius`, `font-family` or
  `box-shadow` values in CSS (`.css` files, `<style>` blocks);
* raw color literals in templates and scripts, and arbitrary-value utilities
  with raw values (`bg-[#fff]`, `text-[rgb(...)]`, `bg-[color:red]`,
  `rounded-[12px]`, `shadow-[...]`, `font-['Arial']`);
* Tailwind default-palette utilities (`bg-red-500`, `text-white`,
  `border-slate-200/50`, ...) - they do not even compile, because the default
  palette is reset, but the test keeps them out of the source too;
* the `dark:` variant: light/dark is a theme (`data-theme`), not a variant.

Arbitrary values are fine when they use tokens or plain geometry, e.g.
`w-[min(var(--lm-drawer-width),100vw)]` or `size-[28px]`.

### Tailwind and the tokens

Tailwind v4 is configured CSS-first, no `tailwind.config.*`:

* `src/styles/main.css` imports Tailwind (preflight + utilities),
  `tokens.css` and `app.css`, and limits source scanning to `index.html` and
  `src/**/*.{vue,ts}` (the committed `dist/` never feeds back in).
* `src/styles/tokens.css` is the only place utilities are defined. Its
  `@theme inline` block resets Tailwind's default colors, fonts, text sizes,
  radii, shadows, breakpoints, ... (`--color-*: initial`, etc.) and maps every
  remaining theme key to a `--lm-*` token. `inline` makes the utility emit
  `var(--lm-...)` directly, so it resolves on the element itself; that is
  what lets the theme-picker swatches (which carry their own `data-theme`)
  show another theme's colors.
* `src/styles/app.css` holds the base rules (body font, headings, links,
  focus ring, plus a few rules that give back browser defaults preflight
  removes) and the shared classes in `@layer components`: `lm-btn` (+
  `--primary`, `--danger`, `--ghost`, `--icon`, `--sm`), `lm-input`,
  `lm-select`, `lm-textarea`, `lm-check`, `lm-label`, `lm-hint`,
  `lm-error-text`, `lm-chip`, `lm-badge` (+ variants), `lm-panel`, `lm-row`
  (selectable rows), `lm-thumb`, `lm-overline`, `lm-toolbar`, `lm-page`,
  `lm-page-header`, `lm-prose` (sanitized HTML). Utilities always win over
  these classes (`lm-btn px-2` works).
* Theme files stay plain CSS that only set tokens; nothing about writing a
  theme changed.

| Utility | Resolves to |
| --- | --- |
| `bg-page` | `--lm-color-bg` |
| `bg-surface`, `bg-elevated`, `bg-sunken` | `--lm-color-surface` / `-elevated` / `-sunken` |
| `text-fg`, `text-muted` | `--lm-color-text` / `--lm-color-muted` |
| `border-border`, `border-border-strong` (+ `hairline`, `hairline-t/r/b/l` for `--lm-border-width`) | `--lm-color-border` / `-border-strong` |
| `bg-accent`, `text-accent`, `bg-accent-hover`, `bg-accent-soft`, `text-on-accent`, `accent-accent` | `--lm-color-accent`, `-accent-hover`, `-accent-soft`, `--lm-color-on-accent` |
| `danger`, `danger-soft`, `on-danger`, `success`, `success-soft`, `warning`, `warning-soft` (with any color utility: `text-`, `bg-`, `border-`, `border-l-`, ...) | the matching `--lm-color-*` token |
| `bg-overlay`, `backdrop:bg-overlay`, `bg-scrim`, `text-on-scrim`, `bg-skeleton`, `outline-focus` | `--lm-color-overlay`, `-scrim`, `-on-scrim`, `-skeleton`, `-focus` |
| `bg-scrim-fade` | gradient from `--lm-color-scrim` to transparent (text over card media) |
| `font-sans`, `font-mono` | `--lm-font-sans` / `--lm-font-mono` |
| `text-xs` ... `text-2xl` (also `text-md`) | `--lm-font-size-xs` ... `-2xl` |
| `font-regular`, `font-medium`, `font-bold` | `--lm-font-weight-*` |
| `leading-normal`, `leading-tight` | `--lm-line-height`, `--lm-line-height-tight` |
| `p-1` ... `p-6`, `p-8` (also `m-`, `gap-`, `inset-`, `w-`, `h-`, ...) | `--lm-space-1` ... `--lm-space-8` (density aware) |
| `h-control`, `min-h-control`, `w-control`, `*-control-sm`, `h-topbar` | `--lm-control-height` (`-8px` for `-sm`), `--lm-topbar-height` |
| `gap-card`, `aspect-card` | `--lm-card-gap`, `--lm-card-aspect` |
| `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-pill` | `--lm-radius-*` |
| `shadow-sm`, `shadow-md`, `shadow-lg` | `--lm-shadow-*` (plain `box-shadow`) |
| `ring-selected`, `focus-ring` | accent ring / focus outline built from `--lm-focus-ring-width` |
| `transition-*` defaults, `ease-standard` | `--lm-motion-fast`, `--lm-ease`; use `duration-(--lm-motion-normal)` for the slower step |
| `animate-skeleton`, `animate-spinner`, `animate-fade-in`, `animate-slide-in` | app keyframes timed with the motion tokens |

Only the spacing steps above exist (there is no `--spacing` multiplier, so
`p-7` or `gap-0.5` do not compile); fixed geometry such as icon boxes and
thumbnails uses arbitrary px values (`size-[28px]`).

Responsive variants are desktop-first and keep the original breakpoints:
`narrow:` (max-width 1100px), `tablet:` (900px), `phone:` (720px). Tailwind's
`sm:`/`md:`/`lg:` are not available. A `compact:` variant
(`[data-density='compact']`) exists for the rare case where density needs more
than the spacing tokens; there is deliberately no `dark:` variant.

### How a theme is selected

* `src/themes/base.css` defines the non-color tokens on `:root` (and the
  compact density on `:root[data-density='compact']`).
* Each theme is one CSS file that sets tokens on `[data-theme='<id>']`
  (`default-light.css` also targets `:root` as the fallback).
* `src/themes/registry.ts` lists the built-in themes (`id`, `label`,
  `scheme: 'light' | 'dark'`, `description`). The picker in the top-bar "More options" menu and on
  the Settings page lists every registered theme plus **System** (follows
  `prefers-color-scheme`, mapping to `default-light` / `default-dark`).
* The choice is stored in `localStorage` (`lm-ui.theme`, `lm-ui.theme.user`,
  `lm-ui.density`; failures are ignored) and applied by a tiny inline script in
  `index.html` before the first paint, so there is no flash.

Built-in themes: **Light**, **Dark**, **Midnight** (navy + amber with
rounder corners).

**Rule: themes are colors and appearance; layout is shared.** Built-in theme
files may only set `color-scheme`, `--lm-color-*`, `--lm-radius-*` and
`--lm-shadow-*` (radii and shadows never change a box's size). All structural
tokens - spacing, control/top-bar/drawer sizes, card aspect, card gap, border
and focus-ring widths, fonts, font sizes/weights, line heights, motion - live
only in `base.css` (plus the compact density block), so cards and controls
have the same geometry in every theme. `tests/themes.test.ts` fails when a
built-in theme sets anything else; a deliberate exception must be added to
the explicit allow-list there (`THEME_LAYOUT_OPT_IN`, empty today) and
documented here. (Midnight used to widen `--lm-card-gap` to 18px, which made
its cards about 3px narrower than in the other themes.) User themes may
still override any token - that is their own choice.

To add a built-in theme: create `src/themes/<id>.css`, import it in
`src/themes/index.ts`, add an entry to `BUILTIN_THEMES`, rebuild. The theme
tests check that every built-in theme defines the same color tokens and no
layout tokens.

### User themes (no rebuild)

Drop a `.css` file into `<LoRA Manager settings dir>/ui-themes/` (the folder
that holds `settings.json`; the Settings page shows the exact path) and reload
the page. The file is listed by `GET /api/lm/ui/themes`, served from
`/lm-ui/user-themes/<file>.css` and appears in the theme picker with a
"Custom" badge. Only the active user theme's stylesheet is loaded.

Declare the theme in a header comment (all fields optional; `id` defaults to
the file name, `scheme` to `light`). Use `:root[data-theme=...]` so the theme
wins over the bundled defaults regardless of stylesheet order, and also list
`[data-theme=...]` so the picker swatch can use the theme's colors (only while
its stylesheet is loaded, i.e. while it is the active theme). Tokens you omit fall
back to the default light values.

```css
/* @lm-theme {"id": "sunset", "label": "Sunset", "scheme": "light", "description": "Warm paper"} */
:root[data-theme='sunset'],
[data-theme='sunset'] {
  color-scheme: light;
  --lm-color-bg: #fbf3ea;
  --lm-color-surface: #fffaf4;
  --lm-color-sunken: #f3e6d8;
  --lm-color-border: #ead8c4;
  --lm-color-text: #2b1d12;
  --lm-color-muted: #7a5f49;
  --lm-color-accent: #d9480f;
  --lm-color-accent-hover: #b83d0c;
  --lm-color-accent-soft: rgba(217, 72, 15, 0.12);
  --lm-color-on-accent: #ffffff;
  --lm-radius-md: 4px;
}
```

### Token reference

Colors (set by every theme):

| Token | Used for |
| --- | --- |
| `--lm-color-bg` | page background |
| `--lm-color-surface` | top bar, folder panel, panels, inputs |
| `--lm-color-elevated` | drawer, menus, dialogs, toasts |
| `--lm-color-sunken` | wells, hover backgrounds, image placeholders |
| `--lm-color-border` / `--lm-color-border-strong` | hairlines / emphasised borders |
| `--lm-color-text` / `--lm-color-muted` | primary / secondary text |
| `--lm-color-accent`, `-accent-hover`, `-accent-soft` | primary actions, selection, active tab |
| `--lm-color-on-accent` | text/icons on accent backgrounds |
| `--lm-color-danger`, `-danger-soft`, `--lm-color-on-danger` | destructive actions, errors |
| `--lm-color-success`, `-success-soft` | success states |
| `--lm-color-warning`, `-warning-soft` | warnings, paused queue, favorites star |
| `--lm-color-focus` | keyboard focus ring |
| `--lm-color-overlay` | modal/drawer backdrop |
| `--lm-color-scrim`, `--lm-color-on-scrim` | gradient + text over card media |
| `--lm-color-skeleton` | loading placeholders |
| `--lm-color-shadow` | color part of the shadow tokens |

Non-color tokens (defaults in `base.css`, any theme may override):

| Group | Tokens |
| --- | --- |
| Typography | `--lm-font-sans`, `--lm-font-mono`, `--lm-font-size-xs/sm/md/lg/xl/2xl`, `--lm-font-weight-regular/medium/bold`, `--lm-line-height`, `--lm-line-height-tight` |
| Radii | `--lm-radius-sm/md/lg/pill` |
| Spacing | `--lm-space-1/2/3/4/5/6/8` (compact density shrinks them) |
| Shadows | `--lm-shadow-sm/md/lg` |
| Motion | `--lm-motion-fast`, `--lm-motion-normal`, `--lm-fade-duration` (media fade-in), `--lm-ease` (durations zeroed for `prefers-reduced-motion`) |
| Layout | `--lm-topbar-height`, `--lm-drawer-width`, `--lm-control-height`, `--lm-border-width`, `--lm-focus-ring-width` |
| Cards | `--lm-card-aspect` (e.g. `2 / 3`), `--lm-card-gap` (card width comes from the per-library size slider), `--lm-card-zoom` (hover/focus zoom of card media, default `1.05`, `1` = off; forced to `1` for `prefers-reduced-motion`) |

The virtualised grid reads `--lm-card-aspect` and `--lm-card-gap` at runtime,
so a theme or density switch re-lays out the grid.

## Navigation and layout

There is no sidebar: the content area uses the full width.

* **Top bar** (`components/TopBar.vue`): logo (links to LoRAs), the library
  tabs LoRAs / Checkpoints / Embeddings / Recipes (`<nav aria-label="Libraries">`
  with links; the active one is highlighted and has `aria-current="page"`;
  `isNavActive` in `config/navigation.ts` also matches sub-paths), the global
  search, and on the right the Downloads indicator (live `active/total`
  badge, links to the Downloads page), Settings, and a **More options** menu
  (`components/AppMenu.vue`) with the theme and density pickers and the
  **Classic UI** link. Theme/density are also on the Settings page.
* Responsive: one row on desktop; at the `tablet:` breakpoint the search moves
  to a second full-width row; on `phone:` the tabs become a full-width
  segmented strip on the second row (scrolls horizontally if it ever does not
  fit) and the search sits next to the logo. No hamburger menu.
* **Folders**: the folder tree of a library page is hidden by default. The
  **Folders** toolbar button (`aria-expanded`, `aria-controls`) shows/hides it;
  the state is remembered **per library** in `localStorage`
  (`lm-ui.library.<prefix>.folders`, `composables/useFolderPanel.ts`, storage
  errors ignored). At the `narrow:` breakpoint the panel overlays the grid, so
  it always starts closed there and toggling it is not remembered. An active
  folder filter is always shown as a "Folder: x" chip (plus a dot on the
  button while the panel is hidden).
* **Card hover**: cards never move or resize on hover. Only the image/video
  inside zooms slightly (`lm-zoom-host` / `lm-zoom-media` in `app.css`, factor
  `--lm-card-zoom`), on hover only under `@media (hover: hover)` and on
  keyboard focus; the drawer's example thumbnails use the same classes.

## Search

Two entry points with clear scopes, sharing one autocomplete component
(`components/SearchCombobox.vue`, WAI-ARIA combobox: `role="combobox"` +
`listbox` / `group` / `option`, `aria-activedescendant`; Up/Down wrap, Enter
picks or searches, Escape closes then clears, Tab closes) and one core
(`utils/suggest.ts`: highlight splitting into text parts (no `v-html`),
ranking, grouped merge, LRU cache, abortable suggester;
`composables/useSearch.ts`: 150 ms debounce, minimum 2 characters, shared
cache, stale answers dropped). Errors are silent: a failed group is just empty
and the plain-search row always remains.

The backend has **no dedicated suggest endpoint**; suggestions use existing
read-only endpoints (`api/suggestSource.ts`):

| Data | Endpoint |
| --- | --- |
| model hits | `GET /api/lm/{loras,checkpoints,embeddings}/list?search=...&page_size=N&sort_by=name:asc` (default search fields: file name + model name) |
| recipe hits | `GET /api/lm/recipes?search=...&page_size=N` (title, tags, LoRA names, prompt) |
| tags | `GET /api/lm/{prefix}/search-tags?q=...&limit=N`, `GET /api/lm/recipes/search-tags?q=...` |

* **Global search** (top bar, every page, "Search everything...", `/` or
  Ctrl/Cmd+K focuses it): one lookup fires the list requests of all four
  libraries plus the LoRA `search-tags` in parallel (the previous lookup is
  aborted). Sections LoRAs, Checkpoints, Embeddings, Recipes (top 4 each, type
  icon, base-model badge, "See all N results in ...") and Tags, then "Search
  all for ...". A model hit opens `/<library>?open=<file_path>` (the drawer;
  the parameter stays in sync with the drawer, so reloads and shared links
  work), a recipe hit searches the recipes page for its title, "See all" opens
  `/<library>?q=<text>` (prefills the local search), a tag opens
  `/loras?tag=<tag>`, and Enter / "Search all" opens **`/search?q=...`**
  (`pages/SearchPage.vue`: per-library sections with up to 12 hits and "See
  all").
* **Local search** (library and recipes toolbars, "Search LoRAs..."): filters
  the grid while typing (250 ms) through the list endpoint's `search`; it is
  part of the library filter state (chip "Search: x", cleared by "Clear
  all"). Its autocomplete is scoped to that library (Models/Recipes + Tags +
  "Search for ..."): a model opens the drawer, a tag adds the tag filter
  (recipes: searches for the tag). The list endpoint's extra search fields
  (`search_tags`, `search_creator`, `search_trigger_words`, `fuzzy_search`) are
  not exposed yet.

## Library quick filter, detail drawer and "Send to ComfyUI"

* **Base-model quick filter** (`components/BaseModelQuickFilter.vue`): a
  horizontally scrolling chip row under the library toolbar, built from
  `GET /api/lm/{prefix}/base-models` (count desc, `utils/baseModelChips.ts`).
  "All" clears the base-model filter; the top N chips (per library:
  `quickBaseModels` in `config/libraries.ts`, 8 for LoRAs and checkpoints, 0 =
  off for embeddings) toggle it, the rest sit in a "More" popover. Multi-select
  works (the list endpoint takes repeated `base_model`). The chips write to the
  same `state.baseModels` of `useLibraryFilters` as the filter panel and the
  active-filter chips, so there is one source of truth and nothing extra is
  persisted. A selected base model from "More" joins the visible row.
* **Detail drawer** tabs: Overview, Description, Versions (the Examples tab is
  gone). The overview shows the cover with the example thumbnails beside it
  when the drawer is wide (container query at 460px) and as a horizontal strip
  under it when narrow. Thumbnails open `ExampleLightbox.vue` (modal `<dialog>`,
  arrow keys, Escape, focus returns to the thumbnail) with the generation data
  of Civitai `images[].meta` normalised by `utils/generation.ts`: prompt and
  negative prompt with copy buttons, parameter chips (model, sampler,
  scheduler, steps, CFG, seed, size, clip skip, denoise, VAE) and resources;
  "No generation data" when the image has none. Thumbnails with a prompt get a
  small text badge and the prompt as tooltip.
* **Tags** are uniform pills (click = filter the library by that tag and close
  the drawer, x = remove), collapsed after 12 with "+N more"
  (`utils/tags.ts`). **Specifications** (file name, path, folder, base model,
  type, file type, size, dates, hash; copy path/hash) are a collapsible
  section, closed by default, remembered in `localStorage`
  (`lm-ui.detail.specsOpen`, `composables/usePersistentToggle.ts`).
* **Send to ComfyUI** (LoRAs, `config.sendToComfy`): a button on every card
  (shown on hover/focus, always on touch devices; Shift+click replaces), one
  in the drawer header, and Send / Replace / Copy LoRA syntax with a strength
  field in the overview. Same flow as the classic UI
  (`utils/workflow.ts`, `composables/useSendToWorkflow.ts`):
  `GET /api/lm/get-registry` lists the nodes of the open ComfyUI tabs, enabled
  LoRA-capable nodes not excluded by `send_to_workflow_exclusions` are kept,
  several targets open a node picker, and `POST /api/lm/update-lora-code`
  `{lora_code, mode: append|replace, node_ids: [{node_id, graph_id}]}` makes
  the backend push `lora_code_update` over the PromptServer websocket. The
  syntax follows `lora_syntax_format` (legacy = bare file name) and the usage
  tips strength; copying adds trigger words when `include_trigger_words` is
  on. Without an open workflow, in standalone mode or when no LoRA node is
  found, a warning toast offers "Copy syntax" instead. Checkpoint/embedding
  "send to workflow" is still classic-UI only.

## Model management actions (phase A)

Ported from the classic UI (`BulkManager.js`, `MoveManager.js`, the card
context menu and the model modal). Everything below goes through
`composables/useModelActions.ts` (flows), `utils/modelActions.ts` (pure
helpers) and the typed calls in `api/endpoints.ts`.

* **Card menu** ("..." button on every card, or right-click): Move...,
  Rename file..., Exclude from library..., Delete... (WAI-ARIA menu: arrow
  keys, Home/End, Escape returns focus to the button). The **drawer** has the
  same four actions under the Civitai links.
* **Selection mode** toolbar: count, Select all loaded (also Ctrl/Cmd+A while
  selection mode is on and focus is not in a field), Select none, Invert, then
  Move..., Add tags..., Send to ComfyUI (LoRAs; all selected LoRAs as one
  `, `-joined code, Shift+click replaces), Copy names and Delete... .
* **Organize...** (library toolbar) opens the auto-organize dialog.

### What the backend does (discovery, pinned by tests)

| Action | Endpoint | Behaviour |
| --- | --- | --- |
| Delete | `POST /api/lm/{prefix}/delete {file_path}` | Not a recycle bin: the model file, its `.metadata.json`, the workflow document and every preview (`PREVIEW_EXTENSIONS`, e.g. `.jpeg`, `.preview.png`, `.webp`, `.mp4`) are **renamed into `<model folder>/.lm-pending-delete/<batch_id>/`** with a `manifest.json` (`expires_at` = now + `PENDING_DELETE_TTL_SECONDS` = **20 s**). After the window a timer (or the next stage/undo/startup sweep) deletes the batch **permanently**. The response carries `batch_id`; it is `null` when staging was impossible (no root found, rename error) and the backend fell back to a **direct hard delete**: the UI then says "deleted permanently" and offers no Undo. A third-party `.civitai.info` is **not** touched (it stays where the model was). |
| Bulk delete | `POST /api/lm/{prefix}/bulk-delete {file_paths}` | Stages every file the same way and merges the batches into **one** `batch_id` (fallback: `batch_ids[]`, undone one by one). `success` is false only when nothing was deleted; per-file `results[]`. |
| Undo | `POST /api/lm/undo-delete {batch_id}` | Renames every staged file back, re-adds the cache entries from the manifest snapshot and removes the staging folder. `404` with "Undo window expired", "Unknown batch id" or "Target path occupied" (a new file took the name). |
| Rename | `POST /api/lm/{prefix}/rename {file_path, new_file_name}` | `new_file_name` is the stem; the extension is kept. Renames the model, `.metadata.json` (+`.bak`), workflow document and previews in place; rewrites `file_name` / `file_path` / `preview_url` in the metadata and records `original_file_name`; LoRA recipes referencing the hash are re-pointed. `400` for any of `/ \ : * ? " < > \|` or an existing target ("A file with this name already exists"). **Not** renamed: `.civitai.info`. |
| Move | `POST /api/lm/{prefix}/move_model {file_path, target_path}` | `target_path` is an absolute folder inside a library root; it is **created** when missing. Moves the model and **every file sharing its base name** (`<stem>.*`, including `.civitai.info`) and rewrites the metadata paths. A same-named file in the target is never overwritten: the moved file gets a hash suffix (read `new_file_path`). Same folder = successful no-op; outside the roots = error. |
| Bulk move | `POST /api/lm/{prefix}/move_models_bulk {file_paths, target_path}` | Per-file `results[]` (`success`, `new_file_path`, `message`), `success_count` / `failure_count`; HTTP 200 even when some fail. |
| Exclude | `POST /api/lm/{prefix}/exclude` / `unexclude` | Sets `exclude: true` in the metadata and drops the cache entry; the file stays. Undo in the toast calls `unexclude`. |
| Add tags | `POST /api/lm/{prefix}/add-tags {file_path, tags}` | One request per model (no bulk endpoint); `409` when the file vanished. |
| Auto-organize | `GET /api/lm/{prefix}/auto-organize?dry_run=true` (preview), `POST /api/lm/{prefix}/auto-organize {}` (real run), `GET .../auto-organize-progress` | Only folders change (download path template of the type; flat when empty); file names stay. The dry run returns `planned_moves[]` and every `results[]` entry (`status` skipped/issue + `reason` code). The real run is one long request that moves files of the **whole type** and afterwards **removes empty folders below the roots**; progress is a global snapshot (`404` when idle); `409` when a run is active. **A GET without `dry_run=true` runs for real**: the UI only ever sends the preview as a GET. |

Folder pickers use `GET /{prefix}/roots` and
`GET /{prefix}/folder-tree?model_root=..&include_empty=true` (one root, empty
folders included); a typed "new subfolder" is created by the move itself (no
separate `create-folder` call, like the classic move modal).

### UI semantics and safety

* Delete (single and bulk) and exclude always ask first (danger confirm that
  states the 20 s window; bulk shows the count). The cards disappear at once;
  the toast offers **Undo for 18 s** (`UNDO_TOAST_MS`, 2 s under the backend
  window so a late click never races the purge). An expired undo says so.
* Rename validates locally (characters above, trailing dot/space, length,
  unchanged name) and shows backend errors in the dialog. An open drawer
  follows a renamed or moved model.
* Move dialog: root, filterable folder list (current folder preselected),
  optional new subfolder (validated: no `..`, drive letters or illegal
  characters), destination preview; Move is disabled when nothing would
  change. After a partial bulk move the failures stay listed and Move retries
  only those. The grid and folder tree reload afterwards.
* Auto-organize: model type (current library preselected), then **Preview
  (dry run)** (planned moves, already in place, skipped, would fail), then
  **Start organizing...**, enabled only after a preview with moves, asks an
  explicit danger confirm naming the type, the number of files that WILL be
  moved, the template, the empty-folder cleanup and that there is no undo.
  Progress is polled every second; the final summary shows moved / skipped /
  failed.

Tests: `tests/modelActions.test.ts` (request builders, helpers, confirm /
undo / rename / move / exclude / tags flows against a mocked backend, written
before the UI) and the backend contract tests
`tests/services/test_model_actions_contract.py` (real temp files: which
sidecars travel with rename / move / delete, delete -> undo and rename / move
round trips byte-identical, expired and occupied undo, bulk move conflict
suffix). The flows were also verified once against a running backend on one
small LoRA, with a verified backup taken first (rename -> back, move -> back,
delete -> undo; all files hash-identical afterwards).

## Downloads and model tools (phase B1)

Ported from the classic UI (`DownloadManager.js`, `ModelDuplicatesManager.js`,
`SidebarManager.js` folder actions, `MoveManager.js` default path, the
context-menu metadata actions). Flows live in
`composables/useBatchDownload.ts` and `composables/useModelTools.ts`, pure
helpers in `utils/downloads.ts` and `utils/modelTools.ts`. Backend semantics:
see "Phase B1 discovery" at the end of this file.

* **Download dialog** (`components/DownloadDialog.vue`): library toolbar
  **Tools > Download...**, the **Download...** button on the Downloads page
  (takes the typed URL along) and **Download...** per version in the drawer's
  Versions tab (model + version preselected). It takes **one or many**
  entries (batch); a single entry is a batch of one. Flow: model type + a
  textarea (plus **Paste from clipboard**) -> one row per entry -> one shared
  destination -> **Add N to queue**. The queue worker downloads them; the
  dialog never calls the blocking `download-model` endpoint. Logic:
  `utils/batchDownload.ts` (pure) and `composables/useBatchDownload.ts`.
  * **Input rules** (`parseBatchInput`): entries are separated by new lines
    (LF, CRLF, CR), spaces, tabs, commas or semicolons. Recognised: model
    pages on any `civitai.<tld>` host (`.com`, `.red`, `.green`, `www.`, with
    or without `https://`) incl. `?modelVersionId=`, `/model-versions/<id>`
    (web and `api/v1`), download links `/api/download/models/<version>`
    (`?fileId=` preselects that file) and bare numeric model ids. A line that
    contains links is free text: its links and bare ids count, other words
    are ignored. On other lines every token must be an entry; a line without
    any is listed whole under **Could not parse** (one click removes the
    list). Identical entries (same model / version / file) are dropped and
    counted; the live preview under the textarea shows found / unparseable /
    duplicates.
  * **Rows**: lookups run 2 at a time (abortable with **Stop**; stopped rows
    become retryable) using the same read-only GETs as before; one
    `civitai/versions` request per model is shared by its rows, plus one
    `civitai/model/version` request per model for the model name (download
    links get it from their own lookup). Each row: thumbnail, model name,
    version select (URL version, else the newest), file select when the
    version has several weight files (linked file, else the first missing
    one of a partly downloaded version, else the primary), badges In library
    / Partly / File in library / Downloaded before / Queued / Early access,
    remove button, and on a failed lookup the reason (not found / private /
    rate limited / type mismatch) with **Retry** (plus "Retry failed
    lookups"). Rows already in the library, already queued or resolving to
    the same version + file as another selected row start **deselected**
    with the reason shown; the checkbox overrides it.
  * **Destination**: one library root plus "Use the default path template"
    (remembered per type) or a folder (suggestions from the root's folders or
    a new relative path; validated) for all rows, with the target preview.
    No per-row override.
  * **Submit**: requests go out sequentially with live progress (`x/N`,
    `aria-live`); the button is disabled while submitting. Added and
    already-queued rows are locked; failed rows stay selected with their
    reason, so pressing Add again retries **only** those. A summary (added /
    already queued / failed with reasons) and **Open downloads** follow. The
    body scrolls with a sticky footer; at phone width thumbnails are hidden.
* **Queue destination (backend, fork-only)**: `GET /downloads/queue/add`
  accepts `model_root`, `relative_path`, `use_default_paths`. The root must be
  a configured LoRA / checkpoint / unet / embedding root (extra roots too),
  the folder a relative path without `..`, drive letters or `<>:"|?*`; else
  400 and nothing is queued. The row stores it in a new nullable
  `destination` column (added by migration to `download_queue` and
  `download_history`); it survives history and retry, and the worker passes
  it on (`use_default_paths` + a chosen root = `use_save_dir_as_root`). Rows
  without a destination behave exactly as before. Tests:
  `tests/routes/test_download_queue_destination.py`.
* **Tools menu** (library toolbar): Download..., Find duplicates...,
  Excluded models..., Fetch missing Civitai metadata... (confirm; the request
  runs until done, then a summary toast).
* **Duplicates** (`DuplicatesDialog.vue`): hash groups side by side (preview,
  path, size, modified, base model, Civitai version), **Verify hashes** per
  group (files that differ are marked and cannot be selected), selection with
  the rule that one real copy of every group stays, **Delete selected...**
  through the phase A delete (confirm + 20 s Undo). Second tab: file name
  conflicts (read-only; a click opens the model).
* **Excluded models** (`ExcludedDialog.vue`): searchable paged list with
  **Restore** (unexclude).
* **Per model** (card menu and drawer): Apply filename template..., Replace
  preview... (file or image URL plus the rating of the new preview; warns that
  the old preview is deleted), Content rating... (PG ... XXX), Refresh from
  Civitai (the confirm says model name and base model are overwritten),
  Re-link to Civitai... (model URL with optional version).
* **Filename template** (`TemplateDialog.vue`, also for a selection and a
  folder): the dry run (always a POST with `dry_run: true` and an explicit
  scope) lists the planned renames; **Rename files...** asks a danger confirm
  with the count and the template. The API client refuses a call without
  `file_paths` / `folder_paths` (no accidental whole-library run). The
  template shown comes from Settings (`download_filename_templates`; the dry
  run does not report it).
* **Move dialog**: "Use the default path template" sends the root with
  `use_default_paths: true`; the backend appends each model's template folder.
* **Folder panel** ("..." in its header): New folder... (inside the selected
  folder or a chosen root), Rename folder..., Apply filename template...,
  Delete folder.... Delete always runs the dry run first: a folder with models
  is refused with the count; otherwise the confirm says whether it is empty or
  how many non-model files (and bytes) are deleted with it. A folder present
  in several roots is not deleted from the new UI. The panel tree now
  includes empty folders (`include_empty=true`), so a new folder can be
  renamed or deleted.
* **Not ported on purpose**: bulk base model / favorite / content rating
  (there is no bulk endpoint; the classic UI loops `save-metadata` per model),
  the recipe-only missing-LoRA batch download (done in phase B2a), multi-root folder
  delete, WebSocket progress for fetch-all.

Safety: every destructive step has a confirm that states what happens on
disk; the filename template and folder delete always preview first. Frontend
tests `tests/downloadDialog.test.ts` and `tests/modelTools.test.ts` were
written before the UI. Backend contract tests
`tests/services/test_model_tools_contract.py`: preview replace deletes old
previews and writes WebP (keeps GIF), `save-metadata` changes only the sent
key but stamps `size`/`modified`, verify-duplicates writes the corrected
hash, folder create/rename/delete, delete refuses folders with models,
default-path moves. The flows were checked in a browser against a mock
harness and once live on the smallest LoRA with a verified backup (content
rating, favorite, replace preview + restore, create / rename / delete of an
empty throwaway folder; files, API record and folder tree identical
afterwards). Refresh/relink from Civitai was not run live (it rewrites cached
metadata that restoring the files cannot reset).

## Recipes (phase B2a)

Ported from the classic UI (`RecipeCard.js`, `RecipeModal.js`,
`ImportManager.js` + `managers/import/*`, `BatchImportManager.js`,
`BulkMissingLoraDownloadManager.js`, `DuplicatesManager.js` in recipe mode).
API client `api/recipes.ts` (re-exported as `recipesApi` from
`api/endpoints.ts`), pure helpers `utils/recipes.ts`, flows
`composables/useRecipeActions.ts` and `composables/useRecipeImport.ts`.
Backend semantics: "Phase B2a discovery" at the end of this file.

* **Library page** (`pages/RecipesPage.vue`): the same toolbar as the model
  libraries: local search with recipe/tag autocomplete, **Import**, Folders
  (recipe subfolders; remembered under `lm-ui.library.recipes.folders`), sort
  (newest/oldest, name, most LoRAs, recently opened), filters (base models,
  top tags, favorites only, **missing LoRAs only** = `lora_availability=missing`)
  with chips, the base-model quick filter (the synthetic "Unknown" bucket is
  left out), card size, **Tools** (Batch import..., Find duplicates...) and
  selection mode: Select all loaded (Ctrl/Cmd+A) / none / invert, Move...,
  Add tags... (one update per recipe, no bulk endpoint), Download missing
  LoRAs..., Delete... . `?open=<recipe id>` opens the drawer and stays in sync.
* **Cards** (`RecipeCard.vue`): preview, base model, LoRA status (`N LoRAs`,
  `x of N LoRAs missing` in warning, `x of N unavailable` in danger), favorite,
  Send to ComfyUI (Shift+click replaces) and the action menu (right-click or
  "..."; `ModelActionMenu` now takes an `items` list): Send, Copy recipe
  syntax, Rename..., Move..., Download missing LoRAs..., Delete... .
* **Drawer** (`RecipeDrawer.vue`): preview; Send to ComfyUI / Copy recipe
  syntax (`GET /recipe/{id}/syntax` through the shared send-to-workflow
  composable and node picker, like the classic card), Load workflow in
  ComfyUI (only when the image embeds one), source link; Rename..., Move...,
  Re-match, Delete...; checkpoint and LoRAs with thumbnail, strength and
  status (In library / Missing / Unavailable / Excluded), a link to the model
  drawer (`/loras?open=<localPath>`, `/checkpoints?open=...`) when in the
  library, **Reconnect** (inline form, `RecipeReconnectForm.vue`: ranked
  suggestions with their match reason, search-as-you-type, free text or
  `<lora:name:1>` syntax, the backend's error shown inline; a same-family base
  model succeeds with a warning toast), **Restore** for a reconnected entry,
  and "Download N missing LoRAs..."; generation data through the shared
  `GenerationDetails.vue` (also used by the example lightbox now); tags
  editor (click = filter); details (dates, folder, source, id, JSON path).
  Opening the drawer stamps `POST /recipe/{id}/opened` like the classic modal
  (feeds the "Recently opened" sort; writes only the open-stats file).
* **Import** (`RecipeImportDialog.vue`): drop / choose / paste (Ctrl+V) an
  image, or type an http(s) image URL, a Civitai image URL or an image path
  on the server -> analysis (spinner; "no metadata" and backend errors stay on
  the first step with the message) -> review: preview, title (first 10 prompt
  words, else the file name), tags, base model, a warning listing recipes
  with the same LoRAs, the checkpoint and LoRAs with their status, generation
  data, **Download N missing LoRAs...** -> **Save recipe** -> done (Open
  recipe, Import another, download missing). A newer analysis supersedes an
  older one (`useRecipeImport` state machine: input -> analyzing -> review ->
  saving -> done).
* **Missing LoRAs**: every "download missing" button feeds
  `https://civitai.com/api/download/models/<versionId>` lines (analysis rows
  with a model id use the model URL) into the **phase B1 download dialog**
  (`DownloadDialog` with `prefix="loras"`), so they go through the queue
  worker with its lookups, badges and destination picker; nothing is
  downloaded without that dialog's own confirmation. Missing entries without
  a Civitai version id are counted in a warning; unavailable (deleted /
  hash-invalid) ones are skipped, like the classic manager.
* **Move** (`RecipeMoveDialog.vue`): the recipes root, its folders and an
  optional new subfolder (validated like the model move); the target is sent
  relative to the root (the root itself as its absolute path). Failures stay
  listed and Move retries only those.
* **Batch import** (`RecipeBatchImportDialog.vue`): one URL or server image
  path per line (live preview of recognised / not recognised / duplicate
  lines), tags, "skip images without generation data"; the backend job is
  polled every second (visibility-aware `createPoller`) with per-item status
  and Cancel. Directory import (server-side folder browsing) stays in the
  classic UI.
* **Duplicates** (`RecipeDuplicatesDialog.vue`): groups by LoRA fingerprint
  (optionally also the prompt) and by source URL; "Keep newest, select the
  rest"; one recipe of every group can never be selected; Delete selected
  goes through the normal delete.

### Safety

* Delete (single, bulk, duplicates) always asks a danger confirm that says
  the image and `.recipe.json` are removed, that Undo works for 20 s and that
  LoRA/checkpoint files are not affected; the toast offers **Undo for 18 s**
  (`POST /undo-delete`, the same staging as models). A `batch_id: null`
  answer (hard delete) says "deleted permanently" and offers no Undo.
* `recipesApi.update` only ever sends the editable keys (`pickRecipeUpdate`):
  the backend would store any key it receives.
* Re-match only touches deleted / hash-invalid entries (no "relaxed" option
  in the new UI). Re-import (delete + re-create from the source), global
  re-match, sharing and the recipe preview replacement (no endpoint) are not
  ported.

### Tests and verification

* Backend contract tests `tests/routes/test_recipe_ui_contract.py` (written
  before the UI; real routes, persistence, ExifUtils and RecipeScanner on temp
  directories): save writes `<id>.webp` + `<id>.recipe.json` into the root
  and lists enriched LoRAs, save needs a name, analyze answers HTTP 200 +
  `error` without metadata and parses A1111 parameters offline, update writes
  only the sent keys and refuses a body without an editable key, move to a
  subfolder and back keeps the image bytes, reconnect + restore round trip,
  syntax keeps missing LoRAs and skips hash-invalid ones, delete -> undo is
  byte-identical, bulk delete merges into one batch, unknown ids are 404.
* Frontend `tests/recipes.test.ts` (written before the UI): request builders,
  analysis normalisation, missing-LoRA collection feeding the B1 parser,
  reconnect/tag/batch input parsing, the import state machine (no metadata,
  backend error, URL vs. local path, stale analysis, failed save) and the
  delete / undo / bulk / favorite / rename / tags / reconnect / move flows.
* Checked in a browser against a mock harness (5 mocked recipes using real
  LoRA records): grid, drawer, reconnect with base-model warning, delete +
  undo, import (no-metadata error, review, download dialog, save, done),
  duplicates, batch import; Light and Dark, desktop and phone.
* One live run on the real backend (snapshot first; see the report of phase
  B2a): import of a generated 64x48 PNG with A1111 parameters, title / tags /
  favorite edits, delete from the card menu; afterwards the recipes root and
  the API list were identical to the snapshot. The backend legitimately
  rewrote its own cache files (`cache/recipe/default.sqlite` and
  `cache/fts/recipe_fts.sqlite`, same size, still zero recipe rows; the FTS
  `-wal`/`-shm` files were checkpointed away) and removed the staging
  folder after the 20 s purge. The drawer was not opened live, so no
  open-stats entry was written.

## Phase 1 scope and roadmap

Covered in phase 1:

* App shell: top-bar tabs, global search with autocomplete and a results
  page, download-queue indicator, More menu (theme/density, Classic UI),
  responsive layout, skip link, keyboard focus styles, aria labels.
* Library pages for LoRAs, checkpoints and embeddings (one generic page):
  virtualised infinite grid, folder tree (hidden by default), local search
  with autocomplete, sort, base-model and tag
  filters with active-filter chips and a base-model quick filter,
  favorites/updates toggles, card-size
  slider, selection mode, favorite toggle on cards.
* Detail drawer: preview with example thumbnails and a lightbox with
  generation data, trigger words with copy, tags editor, notes, collapsible
  specifications, Civitai link, versions with in-library badges and "queue
  download", sanitized description; "Send to ComfyUI" for LoRAs.
* Downloads: active downloads with progress and speed, waiting queue with
  move top/end/remove, history with retry / retry failed / delete / clear,
  global pause/resume, add by Civitai URL or model id. Polls every 1.5 s only
  while the page is open and the tab visible (5 s for the top-bar indicator).
* Recipes: originally a read-only grid; replaced by the full recipe library in phase B2a (see "Recipes (phase B2a)").
* Settings: theme/density, default roots, filename and folder templates,
  queue concurrency (validated 1-5), a few display toggles.

Left to the classic UI for now (linked from the new UI):

* Phase A (model management actions) and phase B1 (download dialog and
  model tools, see "Downloads and model tools") are done. Still classic-only
  from that area: bulk set base model / favorite / content rating (no bulk
  endpoint), deleting a folder that exists in several roots, WebSocket
  progress of fetch-all.
* Phase B2a (recipes) is done. Still classic-only for recipes: re-import
  from the source, global and relaxed re-match, sharing / downloading a
  recipe, directory batch import (server folder browser), creating a recipe
  from an example image or the ComfyUI widget, editing prompts/generation
  parameters, "send to workflow" with a strength override per LoRA.
* Phase B2b: local example images (download, import, delete, NSFW levels),
  statistics page, doctor/diagnostics, backups, metadata archive and the
  remaining settings (LLM, proxy, ...).
* WebSocket progress (the new UI polls instead), "send to workflow" for
  checkpoints and embeddings, translations other than English.

## Phase B1 discovery: downloads and model tools (backend semantics)

Read from `py/routes/handlers/model_handlers.py`, `py/services/*` and the
classic `static/js` flows before any B1 code was written. Paths below are
relative to `py/`.

### Downloads

* **Resolve**: `GET /api/lm/{prefix}/civitai/versions/{model_id}` returns a
  bare array of Civitai `modelVersions[]` (`id`, `name`, `baseModel`,
  `createdAt`, `availability`, `images[]`, `files[{id, name, type, sizeKB,
  primary, metadata{format,size,fp}}]`) enriched with `existsLocally`
  (version id in this type's cache), `localPath`, `hasBeenDownloaded`
  (download history), `downloadedFiles[{fileId, fileName, filePath}]`,
  `modelSizeKB`, `modelTags`. `400 "Model type mismatch"` when the model is
  of another type. A Civitai download link (`/api/download/models/{versionId}`)
  is resolved to its model id with `GET /api/lm/{prefix}/civitai/model/version/{id}`
  (`.modelId`). All of these are read-only.
* **Queue**: `GET /api/lm/downloads/queue/add` (fork queue) accepted only
  `model_id`, `model_version_id`, `model_name`, `version_name`,
  `thumbnail_url`, `source`, `file_params` (JSON); the worker always started
  rows with `use_default_paths: true` (default root of the type + download
  path template). Dedup: the same `download_id`, or the same model with an
  overlapping version and file, is `duplicate: true, reason: "already_queued"`.
* **Classic dialog** (`DownloadManager.js`) instead calls
  `POST /api/lm/download-model {model_id, model_version_id, model_root,
  relative_path, use_default_paths, use_save_dir_as_root, file_params}`, which
  blocks until the file is downloaded and **bypasses the fork's queue,
  concurrency limit and history**. With `use_default_paths` the backend
  ignores `relative_path` and computes it from `download_path_templates`
  (`{base_model}`, `{first_tag}`, `{author}`, `{model_name}`; empty = flat);
  the root is the type's default root unless `use_save_dir_as_root` keeps the
  given `model_root`. Without default paths `model_root/relative_path` is used
  as given (traversal-checked, **not** checked against the library roots).
* **B1 decision**: the queue now stores an optional **destination** (see
  "Downloads and model tools (phase B1)" above) so the new dialog's root/folder choice still goes through
  the queue worker.
* `BulkMissingLoraDownloadManager.js` is recipe-only (missing LoRAs of
  recipes, one `download-model` POST per LoRA with default paths); phase B2a
  routes those LoRAs through the download dialog instead.

### Model tools

| Action | Endpoint | Behaviour |
| --- | --- | --- |
| Excluded list | `GET /{prefix}/excluded` (`page`, `page_size` max 100, `sort_by`, `search`; other filters are ignored) | Paged like `/list`. **Not purely read-only**: drops stale paths from the excluded list and creates a default `.metadata.json` (hashing the file) for an excluded model without one. `POST /{prefix}/unexclude {file_path}` sets `exclude: false` and re-adds the cache entry. |
| Find duplicates | `GET /{prefix}/find-duplicates` (filters `base_model`, `tag_include`, `folder`, `favorites_only`) | Read-only: groups of the in-memory hash index (`{duplicates: [{hash, models[]}], count}`), "original-looking" names first. Models without a hash (pending checkpoints) never appear. |
| Verify group | `POST /{prefix}/verify-duplicates {file_paths}` | Re-hashes every file (full read). **Writes**: a file whose real hash differs from the stored one gets the new `sha256` in its sidecar and cache. Returns `verified_as_duplicates`, `mismatched_files`, `new_hash_map`. |
| Filename conflicts | `GET /{prefix}/find-filename-conflicts` | Read-only; same stem in several folders (`{conflicts: [{filename, models[]}]}`); always empty when `lora_syntax_format` is `full`. |
| Delete duplicates | `POST /{prefix}/bulk-delete` | Same staged delete + 20 s undo as phase A. The classic UI does not stop you from deleting every copy of a group. |
| Replace preview | `POST /{prefix}/replace-preview` multipart, field order `preview_file`, `model_path`, `nsfw_level` | **Deletes every existing preview** of the model (all `PREVIEW_EXTENSIONS`), then writes the new one: images re-encoded to `.webp` (card width, quality 85, metadata stripped), GIF/video kept. Sets `preview_url` and `preview_nsfw_level` (omitted = **0**) in the sidecar and cache. Errors are plain text 500. |
| Preview from URL | `POST /{prefix}/set-preview-from-url {model_path, image_url, nsfw_level}` | Downloads the image (no auth) and runs the same replace. 400/502/500 JSON. |
| NSFW level | `POST /{prefix}/save-metadata {file_path, preview_nsfw_level}` | No dedicated endpoint, no validation. Levels: 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX (0 unrated, 32 blocked is never offered). |
| Bulk base model / favorite / rating | none | There is **no bulk endpoint**: the classic BulkManager loops `save-metadata` per model. `save-metadata` stores **any key** it is sent (dicts are shallow-merged, `tags` normalised); 409 when the file is gone. |
| Refresh from Civitai | `POST /{prefix}/fetch-civitai {file_path}` | Re-fetches by hash. **Overwrites** `model_name` and `base_model`; merges the `civitai` dict (trained words unioned, a manual creator kept); fills `modelDescription`/`tags` only when empty; keeps notes, favorite, usage tips, NSFW level, user tags; downloads a preview only when none exists. Failure is `success: false` with HTTP 200. |
| Re-link | `POST /{prefix}/relink-civitai {file_path, model_id, model_version_id?, source?}` | Points the metadata at another Civitai model/version with the same merge; never touches the model file nor an existing `sha256`. |
| Fetch all | `POST /{prefix}/fetch-all-civitai {}` | Whole type, skips models that already have a Civitai id; blocks until done; progress only over the `/ws/fetch-progress` WebSocket (no polling endpoint). |
| Filename template | `GET|POST /{prefix}/apply-filename-template` (`dry_run`, `file_paths`, `folder_paths`) | **A GET without `dry_run` renames for real.** Uses the type's `download_filename_templates` (empty = revert to `original_file_name`). The real run renames model + sidecars + previews like Rename (conflict = failure, batch continues); the dry run returns `planned_moves[{model, from, to}]`. Shares the auto-organize lock (409). |
| Create folder | `POST /{prefix}/create-folder {folder_path}` (absolute, inside a root) | `makedirs(exist_ok)`; `created` false when it existed. |
| Rename folder | `POST /{prefix}/rename-folder {folder_path, new_name}` | One segment; renames on disk **with its models** and rewrites cache entries and on-disk sidecars. 409 `target_exists`/`busy`; 400 root, symlink, recipes dir, missing. |
| Delete folder | `POST /{prefix}/delete-folder {folder_path, dry_run?}` | **Refuses (409 `not_empty`) when any model file is inside** (excluded ones count); otherwise removes the folder **recursively including leftover non-model files** (`manifest`: `file_count`, `dir_count`, `total_bytes`, `restorable`). 400 for a root, symlink, the recipes dir; a missing folder is forgotten. |
| Move with default path | `move_model` / `move_models_bulk` with `use_default_paths: true` and `target_path` = a root | The server joins the download path template for each model (falls back to the root when it yields nothing). |

## Phase B2a discovery: recipes (backend semantics)

Read from `py/routes/recipe_route_registrar.py`, `py/routes/handlers/recipe_handlers.py`,
`py/services/recipes/{analysis,persistence}_service.py`, `py/services/recipe_scanner.py`,
`py/services/pending_delete_service.py` and the classic `static/js` recipe flows
(`RecipeCard.js`, `RecipeModal.js`, `ImportManager.js` + `managers/import/*`,
`BatchImportManager.js`, `BulkMissingLoraDownloadManager.js`, `DuplicatesManager.js`)
before any B2a code was written. Pinned by `tests/routes/test_recipe_ui_contract.py`.

### Storage

* **Root**: the `recipes_path` setting, else `<first LoRA root>/recipes`
  (`GET /api/lm/recipes/roots` returns it; `py/utils/recipes_paths.py`).
  Subfolders of the root are the recipe "folders" (`GET /recipes/folders`,
  `/recipes/folder-tree`, `/recipes/unified-folder-tree`; `folder` is relative
  to the root, `/`-separated).
* **One recipe = two files side by side**, both named after the recipe id (a
  UUID): `<id>.recipe.json` (the record: `id`, `file_path` of the image,
  `title`, `tags`, `favorite`, `base_model`, `loras[]`, `checkpoint`,
  `gen_params`, `fingerprint`, `source_path`, `folder`, `created_date`,
  `modified`, `import_info`, ...) and the image `<id>.webp` (re-encoded to the
  card width, quality 85; videos keep `.mp4`/`.webm`). The recipe record is
  also **embedded in the image's EXIF** (`append_recipe_metadata`), so every
  metadata edit rewrites the image file too (pixels untouched for WebP).
* **Caches outside the root** (settings/cache dir): the persistent SQLite
  recipe cache (`recipe_cache.sqlite`), the FTS index (`recipe_fts.sqlite`)
  and `stats/recipe_last_opened.json` (written by `POST /recipe/{id}/opened`).
  The UI never touches them directly; the backend updates them on every
  mutation.
* **LoRA entries** (`loras[]`): `file_name`, `hash`, `strength`,
  `modelVersionId`, `modelName`, `modelVersionName`, `isDeleted`,
  `hashInvalid`, `exclude`, optional `reconnectSnapshot`. On read (list and
  detail) the scanner adds `inLibrary`, `localPath` and `preview_url` from the
  LoRA hash index (fallback: the Civitai version id). The checkpoint entry is
  enriched the same way. A recipe's library status is "ready" when every
  non-excluded LoRA is in the library (`lora_availability=ready|missing|deleted`).

### Endpoints the new UI uses

| Action | Endpoint | Behaviour |
| --- | --- | --- |
| List | `GET /recipes` (`page`, `page_size`, `sort_by` = `date`, `name`, `loras_count`, `opened` or `random` plus `:asc`/`:desc`; `search` + `search_title/tags/lora_name/lora_model/prompt`; `folder` + `recursive`; `base_models` **comma-joined**; `tag_include` / `tag_exclude` repeated; `favorite=true`; `lora_availability`; `has_workflow=true`) | Read-only. Items carry `file_url` (static preview URL), `width`/`height`, enriched `loras[]`. `sort_by=opened` hides never-opened recipes. |
| Detail | `GET /recipe/{id}` | Mostly read-only: a prompt ending in the legacy scraped `...` is **repaired and saved** on first open. Adds `recipe_json_path`. |
| Tags / base models | `GET /recipes/top-tags`, `/recipes/search-tags?q=`, `/recipes/base-models` | Read-only; base models include a synthetic "Unknown" bucket with a `value` filter marker. |
| Analyze upload | `POST /recipes/analyze-image` multipart, **first field `image`** | Writes only a temp file. Parses the embedded generation metadata, matches LoRAs/checkpoint against the library (`existsLocally`, `localPath`, `thumbnailUrl`, Civitai `id`/`modelId` when known; Civitai lookups by hash for unknown ones). **No metadata = HTTP 200 with `{error: "No metadata found in this image", loras: []}`**: the UI must check `error`, not only the status. |
| Analyze URL | `POST /recipes/analyze-image` JSON `{url}` | Downloads the image (temp file) and, for a Civitai image page/URL, reads the image info from the Civitai API (network). Same response plus `image_base64` and `extension`. |
| Analyze local file | `POST /recipes/analyze-local-image` JSON `{path}` | A path on the server's disk; read-only. |
| Save | `POST /recipes/save` multipart: `image` (file) or `image_base64`, `name`, `tags` (JSON array), `metadata` (JSON: `base_model`, `loras`, `gen_params`, `raw_metadata`, `checkpoint`, `source_path`, `diagnostics`, `workflow`, `preview_nsfw_level`), `extension` | Writes `<id>.webp` + `<id>.recipe.json` into the **root** (no folder choice; move afterwards), embeds the record in the image, adds it to the caches. 400 without `name` or `metadata`. Returns `recipe_id`, `image_path`, `json_path`, `matching_recipes` (same LoRAs + strengths). An `image_url` field is ignored by the backend. |
| Edit | `PUT /recipe/{id}/update` JSON | Needs at least one of `title`, `tags`, `source_path`, `preview_nsfw_level`, `favorite`, `gen_params` (object), `base_model`, but **writes every key it is sent** into the JSON (so the UI only ever sends those keys). Rewrites the JSON and the image's embedded record. "Rename" = a new `title`; files keep their id names. |
| Delete | `DELETE /recipe/{id}` | **Staged, undoable**: the JSON and image are **copied** to `<settings dir>/.lm-pending-delete/<batch_id>/` with a manifest (20 s window), then the originals are removed. `POST /api/lm/undo-delete {batch_id}` restores them and re-adds the cache entry; afterwards the batch is purged permanently. `batch_id: null` = staging failed and it was a hard delete. |
| Bulk delete | `POST /recipes/bulk-delete {recipe_ids}` | Same staging, merged into one `batch_id` (fallback `batch_ids[]`); `deleted[]`, `failed[{id, reason}]`. |
| Move | `POST /recipe/move {recipe_id, target_path}`, `POST /recipes/move-bulk {recipe_ids, target_path}` | `target_path` absolute or relative to the root, must stay inside it, created when missing. Moves JSON + image, rewrites `file_path`/`folder`. Same folder = success no-op. Bulk: per-recipe `results[]`, HTTP 200. |
| Reconnect LoRA | `GET /recipe/{id}/lora/{index}/reconnect-suggestions?query=` then `POST /recipe/lora/reconnect {recipe_id, lora_index, target_name}` | Suggestions are read-only (ranked, `match_reason` same_hash / same_version / similar_filename / similar_name, `target_name` = stem or `folder/stem` when ambiguous). Reconnect resolves `target_name` against the LoRA library: 404 no match, 400 ambiguous or incompatible base model; a same-family base model succeeds with `base_model_mismatch`. The previous entry is kept in `reconnectSnapshot`; `POST /recipe/lora/restore {recipe_id, lora_index}` puts it back. Checkpoint: `/recipe/{id}/checkpoint/reconnect-suggestions`, `/recipe/checkpoint/reconnect` and `/restore`. |
| Re-match | `POST /recipe/{id}/rematch {relaxed?}` | Local re-matching of deleted / hash-invalid entries (relaxed: healthy ones too); returns `matched_entries`, `unresolved_entries`, `errors`; 409 while a global rematch runs. |
| Syntax | `GET /recipe/{id}/syntax` | `<lora:name:strength>` tokens, space-joined: LoRAs in the library use their local file name (and folder), missing ones keep the stored `file_name`; only `isDeleted` / `hashInvalid` entries are skipped. 400 "No LoRAs found in this recipe". The classic UI copies this or sends it through `update-lora-code` (append; Shift = replace). |
| Send workflow | `POST /recipe/{id}/send-workflow` | Pushes the workflow embedded in the image to the open ComfyUI tab (`lm_load_workflow`); 404 `no_workflow`, 400 in standalone mode. |
| Duplicates | `GET /recipes/find-duplicates` (`include_prompt=1`) | Read-only groups by fingerprint (same LoRAs + strengths) and by source URL; deletion goes through bulk delete. |
| Batch import | `POST /recipes/batch-import/start {items:[{source, type}], tags, skip_no_metadata}` (`type` = `url` or `local_path`), `GET /recipes/batch-import/progress?operation_id=`, `POST /recipes/batch-import/cancel {operation_id}` | Background job (409 when one runs); every successful item is a saved recipe; URL items use the network. Directory import (`batch-import/directory`, `browse-directory`) walks the server disk. |

Not used by the new UI: `import-remote` / `import-from-url` / `reimport` (browser
extension flows; re-import deletes and re-creates the recipe and fetches the
source from the network), `create-from-example`, `save-from-widget`, `share`,
global `rematch`, `scan`. There is **no endpoint to replace a recipe's
preview image**.

### Missing LoRAs

The classic `BulkMissingLoraDownloadManager` collects every LoRA that is not
in the library and not `isDeleted` / `hashInvalid`, de-duplicated by hash or
version id, and calls the blocking `POST /download-model` once per LoRA. The
new UI instead feeds the version ids into the phase B1 download dialog as
Civitai download links (`/api/download/models/<versionId>`), so they go
through the queue worker like every other download.

## Phase B2b discovery: example images, statistics, doctor, backups, settings

Read from `py/routes/{example_images_*,stats_routes,update_routes}.py`,
`py/routes/handlers/{example_images,misc}_handlers.py`,
`py/utils/example_images_*.py`, `py/services/{backup_service,metadata_archive_manager,settings_manager}.py`
and the classic `ExampleImagesManager.js`, `showcase/*`, `statistics.js`,
`DoctorManager.js`, `EnvironmentPanel.js`, `SettingsManager.js` (+ the
settings templates), `UpdateService.js`, `BannerService.js` before any B2b UI
code was written. Pinned by `tests/routes/test_b2b_ui_contract.py`.

### Example images (storage and endpoints)

* **Root**: the `example_images_path` setting (default empty = feature off).
  Layout is flat: `<root>/<sha256 lower>/`. Downloaded files are
  `image_<i><ext>`, `i` = the **0-based position in `civitai.images`**;
  imported files are `custom_<8-char id><ext>` with an entry in
  `civitai.customImages[]` (`{id, url: "", nsfwLevel: 0, width, height, type,
  meta, hasMeta, hasPositivePrompt}`). Supported: `.jpg .jpeg .png .webp .gif
  .avif .jxl .mp4 .webm`. Root-level `.download_progress.json` and
  `_deleted/` (cleanup bucket); a `.lm-examples-complete` marker per folder.
* **Serving**: `/example_images_static/<hash>/<file>` is mounted **once at
  startup and only if the path exists then**. Changing the path needs a
  restart before new files are served. Even the read-only GETs create the
  root folder (`ensure_library_root_exists`).
* **Local vs remote** (classic resolver, ported to `utils/exampleImages.ts`):
  a custom entry (string `id`) matches the file starting with `custom_<id>`;
  a regular entry matches `image_<index>.` by its index **in the source
  array** (the classic UI used the index after SFW filtering, which can point
  at the wrong file; the new UI keeps the source index). The local file wins;
  the remote `url` is the fallback; custom entries are local-only.
* Endpoints (all JSON, under `/api/lm`):

| Action | Endpoint | Behaviour |
| --- | --- | --- |
| Files of a model | `GET /example-image-files?model_hash=` | `{files:[{name, path, extension, is_video}]}`, unsorted, `[]` when the folder is missing; 400 without a configured path. |
| Has files | `GET /has-example-images?model_hash=` | `{has_images}` (no `success` key). |
| Download all | `POST /download-example-images {optimize, model_types}` | Starts a **background** job; 400 when one runs or no path is set. Skips models already complete or known-failed. Does not filter by NSFW. |
| Status | `GET /example-images-status?compact=1` | `{is_downloading, status:{status idle/running/paused/stopping/stopped/completed/error, total, completed, current_model, errors[], last_error, elapsed_seconds, failure_summary, *_count}}`. |
| Pause / resume / stop | `POST /pause-example-images`, `/resume-example-images`, `/stop-example-images` | 400 when there is nothing to pause/resume/stop. Stop lets running models finish. |
| Download one model | `POST /force-download-example-images {model_hashes, optimize, model_types}` | **Synchronous** (the request stays open until done) and ignores the "already done / failed" state; `{result:{total, processed, successful, errors[]}}`. Existing `image_<i>` files are skipped, nothing is deleted. |
| Import | `POST /import-example-images` multipart `model_hash`, `model_path`, `files` (one or more) | `shutil.copy2` into the hash folder as `custom_<id><ext>`, appends `customImages`, saves `.metadata.json`; returns `files`, `regular_images`, `custom_images`. Unsupported files are reported in `errors` (200 with `success:false` when all fail). |
| Delete | `POST /delete-example-image {model_hash, short_id}` | **Only imported (custom) images**; `os.remove` (no recycle bin, **not reversible**) and the entry leaves `customImages`. 404 for an unknown id or a model without custom images. |
| NSFW level | `POST /example-images/set-nsfw-level {model_hash, nsfw_level, source: civitai or custom, index or id}` | Sets `nsfwLevel` on that entry and saves the sidecar; no range check (the UI offers 1/2/4/8/16). |
| Open folder | `POST /open-example-images-folder {model_hash}` | Per `example_images_open_mode`: `system` opens the explorer **on the server machine**, `clipboard` returns `{mode:"clipboard", path}`, `uri_template` returns `{mode:"uri", uri}`. 404 when the model has no folder. |
| Cleanup | `POST /cleanup-example-image-folders` | Removes empty folders and **moves** orphaned hash folders to `_deleted/` (does not know "Other" models). Not ported. |

* **Path validation** (`POST /settings {example_images_path}`): only when
  non-empty and changed; the folder must exist, be a directory and contain
  only hash folders / `_deleted` / the progress file / dotfiles; otherwise
  HTTP 200 `{success:false, error}`. Nothing is created or migrated.
* Other keys: `auto_download_example_images` (auto mode: a check every 30
  min while the classic UI is open, plus a server-side download after each
  model download), `optimize_example_images` (resized renditions),
  `example_images_open_mode`, `example_images_local_root`,
  `example_images_open_uri_template`; the throttling keys are internal.

### Statistics

All `GET /api/lm/stats/*` are read-only (in-memory usage dict + scanner
caches): `collection-overview` (counts, sizes, unused per type,
`model_types_distribution`), `usage-analytics` (top 10 per type, a 30-day
`usage_timeline`), `model-usage-list?type=&sort=&limit=&offset=` (all models
of a type, paged), `base-model-distribution`, `tag-analytics` (top 50 tags),
`storage-analytics` (top 20 by size per type), `insights` (rule keys +
params, translated by the client). "Unused" = the hash never appeared in the
usage stats.

### Doctor

`GET /doctor/diagnostics?clientVersion=` returns five checks
(`civitai_api_key`, `cache_health`, `filename_conflicts`,
`sidecar_mirror_orphans`, `ui_version`) with `status ok|warning|error`,
`summary`, `details` (strings or objects) and `actions`. It changes no data,
but **with an API key set it makes one live request to Civitai**
(`/models?limit=1`) and may initialise the persistent cache schema. Fixes:

* `repair-cache` (POST, no body): full rescan of every root and rewrite of the
  persistent SQLite cache (no model or sidecar file is touched; slow,
  idempotent). Classic: no confirm. New UI: confirm.
* `resolve-filename-conflicts` (POST): **renames files on disk** - for each
  duplicate file name the first copy keeps its name, every other copy gets
  `<name>-<4 hex of its hash>` (model, `.metadata.json`, `.civitai.info`,
  previews). No undo. Workflows that refer to the old name (legacy syntax)
  must be updated. The check looks at LoRAs only, the fix at every scanner.
  No-op with `lora_syntax_format=full`. Classic and new UI: danger confirm
  with the counts.
* `export-bundle` (POST): an in-memory zip (report, sanitized settings,
  logs); nothing is written on the server.
* `open-settings`, `open-settings-syntax-format`, `reload-page`: client-only.

`GET /environment` (versions, read-only), `GET /version-info` (local) and
`GET /check-updates?nightly=` (**network: GitHub API**, read-only). **Not
ported** (destructive): `POST /perform-update` and `POST /switch-channel`
(git reset/clean/pull or ZIP overwrite of the plugin folder).

### Backups and metadata archive

* **Contents**: `settings.json`, `cache/download_history/downloaded_versions.sqlite`,
  `cache/symlink/symlink_map.json`, every `cache/model_update/*.sqlite` and
  `stats/lora_manager_stats.json`, plus a `manifest.json` with the sha256 of
  every file. No models, sidecars, previews, recipes or the metadata archive.
* **Location**: `<settings dir>/backups/lora-manager-backup-<UTC>-<auto|manual>.zip`.
  `GET /backup/status` lists them (`snapshots[{name, path, size, mtime, is_auto}]`
  newest first, plus `status{backupDir, enabled, retentionCount, ...}`).
* **Create** = `POST /backup/export`: builds the zip in a temp file in the
  backup folder, returns it as a download and deletes the temp file. Nothing
  stays on the server and nothing is pruned. Only the daily **auto**
  snapshot (`backup_auto_enabled`, every 24 h) is stored, and storing one
  prunes auto snapshots beyond `backup_retention_count` (manual files are
  never pruned).
* **Delete**: there is **no endpoint**; old auto snapshots are only pruned
  by retention. The new UI offers "Open backup folder" instead.
* **Restore** = `POST /backup/import` (multipart file): validates the zip,
  `manifest_version` 1, relative member paths and every sha256 **before**
  replacing anything; targets come from the `kind`, never from the archive
  (no path traversal). Then `os.replace` over the files above. **No safety
  backup, not transactional, no reload**: the running backend keeps its
  in-memory settings and a later save can write them back, so **ComfyUI must
  be restarted** after a restore. A bad archive is a 400.
* **Metadata archive**: `GET /metadata-archive-status`
  (`isAvailable, isEnabled, databaseSize, databasePath`),
  `POST /download-metadata-archive?download_id=` (**blocks until a
  multi-GB download from GitHub/HuggingFace is extracted** to
  `<plugin>/civitai/civitai.sqlite`, overwriting it; progress only over the
  `/ws/download-progress` WebSocket; sets `enable_metadata_archive_db`),
  `POST /remove-metadata-archive` (deletes the database folder, unsets the
  setting).

### Settings

* `GET /settings` returns every key except `hash_chunk_size_mb`,
  `download_stall_timeout_seconds`, `folder_paths` (plugin mode), `libraries`,
  `active_library` and the three API keys (`civitai_api_key`,
  `huggingface_api_key`, `llm_api_key`), which come back only as `*_set`
  booleans. **`proxy_password` and `proxy_username` are returned in clear**;
  the new UI drops the password on read and only shows "configured".
* `POST /settings` takes a partial object and handles keys **in order**,
  skipping unchanged values. Validation (HTTP 200 `{success:false}`):
  `example_images_path`, `update_channel`, `download_queue_max_concurrent`
  (int 1-5). A `ValueError` of the manager (recipes path, overlapping
  checkpoint/unet folders, unknown other sub type) is HTTP 500 text.
  **Every key is written to `settings.json` as it is processed, so keys
  before a failing one are already saved** (the new UI sends validated keys
  first and re-reads the settings after any error). `"__DELETE__"` removes
  `proxy_username` / `proxy_password`.
* Side effects: proxy keys refresh the download session; the four metadata
  provider keys re-register the providers; `download_queue_max_concurrent`
  wakes the queue; `model_name_display` re-sorts; **`recipes_path` moves
  every recipe file**; `use_portable_settings` relocates `settings.json`;
  `sidecar_storage_*` needs a migration; other-models / workflows / wildcards
  toggles and paths rebuild roots live; `extra_folder_paths` and
  `folder_paths` need a **restart**; `language` only affects the classic UI.
* The file is rewritten whole on every key (`json.dump(indent=2)`, only
  non-default values plus `civitai_api_key` and `folder_paths`, insertion
  order). Secrets are stored in plain text. The handler never logs values,
  but `downloader.py` logs the proxy URL (with credentials) at debug level.
* No libraries endpoints exist; there is no LLM "test connection" endpoint
  (`GET /llm/provider-models`, `GET /llm/models?provider=&api_base=` list models).
