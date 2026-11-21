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
    main.ts, App.vue      app shell (sidebar, top bar, toasts, confirm dialog)
    router.ts             history routes below the app base (/lm-ui/...)
    api/                  typed client: http.ts (fetch wrapper, ApiError),
                          endpoints.ts (model/download/settings/recipe/theme APIs),
                          types.ts (response shapes)
    composables/          useInfiniteList, usePolling (visibility-aware),
                          useDownloadQueue (shared poller), useTheme,
                          useLibraryFilters, useAppSettings, useFeedback, useSearch
    components/           AppSidebar, TopBar, ThemeMenu/ThemeOptions, VirtualGrid,
                          ModelCard, ModelDrawer, ExampleLightbox,
                          BaseModelQuickFilter, NodePickerDialog, FolderTree, ...
    pages/                LibraryPage (generic, per model type), RecipesPage,
                          DownloadsPage, SettingsPage, NotFoundPage
    config/libraries.ts   per-type config (loras / checkpoints / embeddings)
    themes/               design tokens + themes + registry.ts
    styles/main.css       stylesheet entry: Tailwind + tokens.css + app.css
    styles/tokens.css     Tailwind theme mapped onto the design tokens
    styles/app.css        base rules + shared classes (buttons, inputs, chips)
    i18n/index.ts         all English UI strings in one table, t(key, params)
    utils/                basePath, format, civitai URL parsing, query builder,
                          HTML sanitizer, settings form helpers
  tests/                  vitest (jsdom): API client, helpers, composables,
                          theme registry, style-token lint
  dist/                   build output - COMMITTED (users have no Node/Bun)
```

Runtime dependencies: `vue`, `vue-router` only. No UI kit, no CDN, no
runtime-fetched assets; icons are inline SVG paths using `currentColor`.
Tailwind (`tailwindcss` + `@tailwindcss/vite`, pinned 4.3.5) is a build-time
dev dependency only: the compiled, purged CSS ends up in `ui/dist`.

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
  `scheme: 'light' | 'dark'`, `description`). The picker in the top bar and on
  the Settings page lists every registered theme plus **System** (follows
  `prefers-color-scheme`, mapping to `default-light` / `default-dark`).
* The choice is stored in `localStorage` (`lm-ui.theme`, `lm-ui.theme.user`,
  `lm-ui.density`; failures are ignored) and applied by a tiny inline script in
  `index.html` before the first paint, so there is no flash.

Built-in themes: **Light**, **Dark**, **Midnight** (navy + amber, also
overrides radii and card gap to show non-color tokens can change too).

To add a built-in theme: create `src/themes/<id>.css`, import it in
`src/themes/index.ts`, add an entry to `BUILTIN_THEMES`, rebuild. The theme
tests check that every built-in theme defines the same color tokens.

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
| `--lm-color-surface` | sidebar, top bar, panels, inputs |
| `--lm-color-elevated` | drawer, menus, dialogs, toasts |
| `--lm-color-sunken` | wells, hover backgrounds, image placeholders |
| `--lm-color-border` / `--lm-color-border-strong` | hairlines / emphasised borders |
| `--lm-color-text` / `--lm-color-muted` | primary / secondary text |
| `--lm-color-accent`, `-accent-hover`, `-accent-soft` | primary actions, selection, active nav |
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
| Motion | `--lm-motion-fast`, `--lm-motion-normal`, `--lm-ease` (zeroed for `prefers-reduced-motion`) |
| Layout | `--lm-sidebar-width`, `--lm-topbar-height`, `--lm-drawer-width`, `--lm-control-height`, `--lm-border-width`, `--lm-focus-ring-width` |
| Cards | `--lm-card-aspect` (e.g. `2 / 3`), `--lm-card-gap` (card width comes from the per-library size slider) |

The virtualised grid reads `--lm-card-aspect` and `--lm-card-gap` at runtime,
so a theme or density switch re-lays out the grid.

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

## Phase 1 scope and roadmap

Covered in phase 1:

* App shell: sidebar navigation, global search, download-queue indicator,
  theme/density picker, responsive layout with off-canvas navigation, skip
  link, keyboard focus styles, aria labels.
* Library pages for LoRAs, checkpoints and embeddings (one generic page):
  virtualised infinite grid, folder tree, search, sort, base-model and tag
  filters with active-filter chips and a base-model quick filter,
  favorites/updates toggles, card-size
  slider, selection mode (copy file names; bulk actions link to classic UI),
  favorite toggle on cards.
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

* Destructive or file-moving actions: delete, move, rename, bulk delete/move,
  auto-organize, exclude, duplicate finder, relink/refresh Civitai metadata,
  replace preview, folder create/rename/delete.
* Download modal with version/file/root selection (the new form always uses
  the default root and path template).
* Recipe details, import (image/URL/batch), editing and LoRA reconnect.
* Local example images (download, import, delete, NSFW levels), statistics
  page, doctor/diagnostics, backups, metadata archive, LLM settings, proxy and
  the rest of the settings.
* WebSocket progress (the new UI polls instead), "send to workflow" for
  checkpoints, embeddings and recipes, translations other than English.
