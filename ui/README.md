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
                          OrganizeDialog, ...
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
* Recipes: simple read-only grid linking to the classic UI.
* Settings: theme/density, default roots, filename and folder templates,
  queue concurrency (validated 1-5), a few display toggles.

Left to the classic UI for now (linked from the new UI):

* Phase A (done, see "Model management actions") moved delete with undo,
  rename, move, bulk delete/move, exclude, bulk add-tags, bulk send and
  auto-organize to the new UI. Still classic-only from that area: the
  excluded-models list (unexclude outside the Undo toast), duplicate finder,
  relink/refresh Civitai metadata, replace preview, set NSFW level, bulk set
  base model / favorite / content rating, apply filename template, move with
  "use default path", folder create/rename/delete in the sidebar.
* Download modal with version/file/root selection (the new form always uses
  the default root and path template).
* Recipe details, import (image/URL/batch), editing and LoRA reconnect.
* Local example images (download, import, delete, NSFW levels), statistics
  page, doctor/diagnostics, backups, metadata archive, LLM settings, proxy and
  the rest of the settings.
* WebSocket progress (the new UI polls instead), "send to workflow" for
  checkpoints, embeddings and recipes, translations other than English.

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
  "Phase B1" below) so the new dialog's root/folder choice still goes through
  the queue worker.
* `BulkMissingLoraDownloadManager.js` is recipe-only (missing LoRAs of
  recipes, one `download-model` POST per LoRA with default paths) and is left
  to phase B2 with the recipes.

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
