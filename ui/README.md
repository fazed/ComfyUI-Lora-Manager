# LoRA Manager modern UI (`ui/`)

A fork-local, single-page replacement for the classic LoRA Manager web UI.
It is built with Vue 3 + Vite + TypeScript (same toolchain versions as
`vue-widgets/`) and styled with Tailwind CSS v4 on top of design tokens, talks to the same `/api/lm/...` endpoints as the classic UI,
and is served by the backend at **`/lm-ui/`**. The classic UI
(`templates/` + `static/`) is untouched and keeps working at `/loras`.

Open it at `http://<comfyui-host>:<port>/lm-ui/` (for example
`http://127.0.0.1:8188/lm-ui/`). Behind a reverse proxy that mounts ComfyUI
under a prefix, use `<prefix>/lm-ui/`.

The **LoRA Manager button in the ComfyUI top bar** (and "Open LoRA Manager"
in its quick-actions dropdown) opens `/lm-ui/` as well. On page load
`web/comfyui/modern_ui_link.js` sends one `HEAD /lm-ui/`; only a 2xx answer
switches the button to the modern UI, so an unbuilt `ui/dist` (503), a backend
without the route (404), a network error or a click before the probe has
answered all open the classic `/loras` instead. The classic UI stays reachable
from the modern UI's "More options" menu.

The **deep links from the ComfyUI canvas** use the same cached probe
(`modelDeepLinkPath` / `recipeDeepLinkPath` in `modern_ui_link.js`), opened
synchronously in the named `lm-lora-manager` tab:

| Link | Modern UI (probe 2xx) | Classic fallback |
| --- | --- | --- |
| LoRA info card / quick panel "full details" (`openLoraManager`) | `/lm-ui/loras?open=<file_path>` | `/loras#model=<file_path>` |
| Recipe picker row, "Open LoRA Manager" on an empty recipe list (`openRecipeManager`) | `/lm-ui/recipes?open=<id>` (bare `/lm-ui/recipes` without an id) | `/loras/recipes#recipe=<id>` |

`?open=` is URI-encoded and read by vue-router. The library page matches it
exactly against the item's `file_path` (absolute, forward slashes, as the
cache stores it and as `/api/lm/loras/details` returns it; the link turns any
backslashes into `/` for the modern UI only), after a file-name search of the
first 50 results; the recipes page loads the id via `GET /api/lm/recipe/<id>`.
An unknown path or id just drops `?open=` and shows the list. The builder also
supports the `checkpoints` and `embeddings` routes, but no ComfyUI-side link
uses them yet. The wildcard links (`/wildcards#model=`) stay classic: the
modern UI has no wildcards page.

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
                          a backdrop click needs pointerdown + click on the backdrop),
                          useRefresh (page refresh registry, see "Refresh"),
                          useUpdates (Updates page + top-bar badge count)
    components/           TopBar, AppMenu/ThemeOptions, SearchCombobox, VirtualGrid,
                          ModelCard, ModelRow (list view), ModelDrawer, ExampleLightbox,
                          BaseModelQuickFilter, NodePickerDialog, FolderTree,
                          ModelActionMenu, ModalShell, InputDialog, MoveDialog,
                          OrganizeDialog, GenerationDetails, Recipe* (card,
                          drawer, reconnect form, import / batch import /
                          move / duplicates dialogs), ...
    pages/                LibraryPage (generic, per model type), RecipesPage,
                          SearchPage, DownloadsPage, UpdatesPage, SettingsPage (schema-driven),
                          StatsPage, DoctorPage, NotFoundPage
    components/charts/    dependency-free SVG/CSS charts (series tokens)
    components/settings/  SettingsField (one field row), SettingsTabList (ARIA tab list)
                          + Backups/MetadataArchive/ExampleImages/About panels
    config/settingsSchema.ts  settings sections and fields (keys, types, defaults, validation)
    config/settingsTabs.ts    presentation: which tab and card each field lives in
    config/libraries.ts   per-type config (loras / checkpoints / embeddings)
    config/navigation.ts  top-bar tabs, active state, search route targets
    themes/               design tokens + themes + registry.ts + contrast.ts (WCAG helper)
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
  drawer specifications, the drawer's last tab; same keys and plain-string values as before, written
  on change only, blocked storage ignored);
- `usePreferredDark` (the "System" theme follows the OS live);
- `onLongPress` (touch long press opens the item menu on cards, rows and
  recipe cards; see Context menus);
- `useDocumentVisibility` (the silent refresh after the tab was hidden; see
  Refresh).

Kept custom on purpose: `createPoller` (shared, scope-less download poller with
no-overlap rescheduling and visibility pause; `useIntervalFn` cannot express
"next run after the previous finished"), `copyText` (`useClipboard` cannot
report a failed copy, which the error toast needs), the per-library
sort/card-size/view store (validated on read), `useFolderPanel` (writes only on wide
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
bun run typecheck  # vue-tsc (through scripts/vue-tsc.cjs, see below)
bun run test       # vitest
bun run build      # typecheck + production build into ui/dist
```

**Type checking under Bun.** `vue-tsc` adds `.vue` support by patching
TypeScript's compiler while it is loaded through `fs.readFileSync`. Bun's
module loader does not go through `fs.readFileSync`, so under Bun (this
project has no Node) plain `vue-tsc` silently skipped every `.vue` file and
always passed. `scripts/vue-tsc.cjs` applies the same patch explicitly
(writes `node_modules/typescript/lib/_tsc.vue-bun.js`, git-ignored with
`node_modules`) and runs it; `typecheck` and `build` use it. Turning it on
surfaced six old errors (key-event target types in `utils/browse.ts` and
`utils/drawerNav.ts`, `InstanceType` of the generic `VirtualGrid` - now the
`VirtualGridExposed` interface in `utils/gridLayout.ts` - and an unused
import), all fixed.

`tsconfig.json` also sets `vueCompilerOptions.checkUnknownProps` and
`checkUnknownEvents`: a prop or `@event` handler that the component does not
declare is a type error. Legitimate fallthrough attributes (`aria-*`,
`data-*`, `title`, a native `@click`) are allowed in `src/fallthroughAttrs.d.ts`.

Note that `bun run dev` talks to a real backend: actions such as saving
notes, editing settings or queueing downloads really happen there.

### Build and commit rule

`ui/dist` is committed because end users install the node without any
JavaScript toolchain. After every change under `ui/src` (or `index.html`):

1. `bun run test && bun run build`
2. commit the source **and** the regenerated `ui/dist` together.

`ui/node_modules/` is git-ignored.

## Syncing the fork with upstream safely

**Last synced upstream:** `willmiao/ComfyUI-Lora-Manager` `main` at
`b8767835` (`git describe`: `v1.3.0-53-gb8767835`, committed 2026-11-25),
merged into the fork's `main` as `b2a8f101` on 2026-11-25. The next sync
starts from there: `git log b8767835..upstream/main` shows what is new.

Most fork work lives in new paths, but the fork also changes a number of
upstream-owned files. Those are where a merge can conflict, or merge cleanly
and still silently drop fork behaviour. The lists below were derived with
`git diff --name-status upstream/main main` (merge base = `upstream/main`
after the last sync); re-derive them the same way before the next sync:

```bash
git fetch upstream
git diff --name-status $(git merge-base main upstream/main) main | grep -v '^A'   # upstream-owned files we modified
git diff --name-status $(git merge-base main upstream/main) main | grep '^A'      # fork-only files
```

### Upstream-owned files the fork modified (high conflict risk)

32 files. On a conflict, take upstream's version and re-apply the fork change
listed here; on a clean merge, still check that the change survived.

**App wiring (2)**

| File | Change / behaviour to preserve |
| --- | --- |
| `py/lora_manager.py` | In `LoraManager.add_routes`, after `PreviewRoutes.setup_routes(app)`: a comment plus `from .routes.modern_ui_routes import ModernUiRoutes; ModernUiRoutes.setup_routes(app)` (serves `/lm-ui/`). Imports `start_download_queue_worker` / `stop_download_queue_worker` and appends them to `app.on_startup` / `app.on_shutdown` (server-side queue worker). |
| `standalone.py` | Same two changes in `StandaloneLoraManager.add_routes` (import path `py.routes.modern_ui_routes`, `py.services.download_queue_worker`). Keep both entry points in step. |

**Backend routes and handlers (3)**

| File | Change / behaviour to preserve |
| --- | --- |
| `py/routes/model_route_registrar.py` | Adds `GET /api/lm/{prefix}/updates/overview` -> `get_updates_overview` (read-only Updates page, no Civitai calls) and `GET /api/lm/downloads/queue/pause-all` / `resume-all` -> `pause_download_queue` / `resume_download_queue`. |
| `py/routes/handlers/model_handlers.py` | `ModelDownloadHandler`: `download_model(_get)` and the `start=true` retry path run through `get_download_queue_worker().run_download(...)` (a running `download_id` is joined, never started twice; 409 `already_running` via `_download_failure_status`); `queue/add` validates the optional destination (`_parse_queue_destination`: `model_root` must be a configured root, safe `relative_path`, 400 otherwise), fills an empty thumbnail from the resolved version, and calls `wake_download_queue_worker()` after add / retry / reorder; queue and stats responses carry `queue_worker: true` plus `worker` (`_queue_worker_payload`); new `pause_download_queue` / `resume_download_queue`. `ModelUpdateHandler.get_updates_overview` (uses `update_classifier`). Both handlers registered in `ModelHandlerSet`. |
| `py/routes/handlers/misc_handlers.py` | `SettingsHandler`: validates `download_queue_max_concurrent` (integer 1-5 via `normalize_max_concurrent`) and wakes the worker when it changes. `ModelLibraryHandler`: `/model-versions-status` returns `downloadedVersionIds` from the download history for models without local files (one bulk query per type); the CivitAI version list goes through `ModelVersionsStatusCache` (stale-while-revalidate, `?refresh=1`, `cached`/`stale`/`source` fields, 429 with `retryAfter` when rate-limited, 500 on error). |

**Backend services and utils (7)**

| File | Change / behaviour to preserve |
| --- | --- |
| `py/services/model_scanner.py` | **Scan guard.** One library scan per scanner (model type) at a time: `scan_library(rebuild_cache=, scope=)` coalesces identical overlapping scans (returns `(summary, joined)`) and serialises different ones; the scan runs as its own task so a cancelled request does not abort it. `get_cached_data(force_refresh=True)` delegates to `scan_library`; `initialize_in_background` holds the guard and its reconcile calls `_run_scan_locked()` directly (the guard is already held, never re-enter it). `is_scanning()` reports guard state. **Every cache-building path must go through `scan_library` or `_run_scan_locked` under the lock**: if upstream adds a new path that calls `_initialize_cache()` / `_reconcile_cache()` directly, route it through the guard. Upstream's move-aware reconcile (issue #1224) lives inside `_reconcile_cache` and therefore already runs under the guard. |
| `py/services/base_model_service.py` | `scan_models(force_refresh=...)`: without `force_refresh` only `get_cached_data()`; with it, `scanner.scan_library(...)`, and a joined scan returns the summary with `"joined": True`. |
| `py/services/download_manager.py` | Version lookups in the resolve step and at download start run inside `with civitai_lookup_cache():` (a batch of adds for one model shares one `/models` call); the resolve result carries `thumbnail_url` (`build_civitai_thumbnail_url`); new `get_running_download_ids()` (used by the worker for dedupe and its concurrency count). |
| `py/services/download_queue_service.py` | New `download_queue_state` table with `get_state` / `set_state` (persisted worker pause flag); a `destination` JSON column on `download_queue` and `download_history` (added by migration for existing databases) carried through add, history moves and retry. |
| `py/services/civitai_client.py` | `get_model_version` and the model fetch use short-TTL `TTLLookupCache`s, but only inside `civitai_lookup_cache()` (elsewhere they always fetch); the version result is also filed under its canonical ids. Uncached bodies are `_get_model_version_uncached` / `_fetch_model_data_uncached`. |
| `py/services/settings_manager.py` | `DEFAULT_SETTINGS["download_queue_max_concurrent"] = 2`. |
| `py/utils/civitai_utils.py` | New `build_civitai_video_still_url` and `build_civitai_thumbnail_url` (first image as an optimized rendition, a video as a JPEG still) for queue/history thumbnails. |

**Classic frontend: static, templates, ComfyUI web extension (6)**

| File | Change / behaviour to preserve |
| --- | --- |
| `static/js/state/index.js` | `download_queue_max_concurrent: 2` in `DEFAULT_SETTINGS_BASE`. |
| `static/js/managers/SettingsManager.js` | Loads the `downloadQueueMaxConcurrent` select from `state.global.settings.download_queue_max_concurrent ?? 2`. |
| `templates/components/modals/settings/general.html` | A "Parallel queue downloads" setting item (select 1-5, `saveSelectSetting('downloadQueueMaxConcurrent', 'download_queue_max_concurrent')`) right before `aria2PathSetting`. |
| `web/comfyui/lora_canvas_api.js` | Imports from the fork-local `modern_ui_link.js`; `openLoraManagerHome` uses `managerHomePath(modernUiAvailability())` and `openLoraManager` uses `modelDeepLinkPath(filePath, modernUiAvailability())` instead of the fixed `/loras` and `/loras#model=` (modern UI when `/lm-ui/` is served, classic otherwise). |
| `web/comfyui/recipe_canvas_api.js` | `openRecipeManager` uses `recipeDeepLinkPath(recipeId, modernUiAvailability())` instead of the fixed `/loras/recipes#recipe=`. |
| `web/comfyui/top_menu_extension.js` | `setup()` calls `probeModernUi()` first (HEAD probe of `/lm-ui/` ahead of the first click). The native top-menu button (upstream PR #1230) still opens through `openLoraManagerHome`, so it follows the modern-UI link. |

**Locales (10)**

`locales/en.json` and `locales/{de,es,fr,he,ja,ko,ru,zh-CN,zh-TW}.json` each
add one key, `settings.downloadQueueMaxConcurrent` with `label` and `help`
(placed right before `settings.aria2cPath`), used by the settings template
above. The nine non-English locales carry the **English text**, without
upstream's `[TODO: Translate]` prefix. If upstream reorganises the
`settings` block, re-add the key in all ten files.

**Config (1)**

| File | Change |
| --- | --- |
| `.gitignore` | `ui/node_modules/` (plus a comment; `ui/dist` is committed on purpose). |

**Upstream tests extended (3)**

| File | Change |
| --- | --- |
| `tests/routes/test_download_queue_handlers.py` | Thumbnail fill, worker capability flag, pause-all/resume-all, add wakes the worker, `download-model-get` joins a running download / returns 409. |
| `tests/routes/test_misc_routes.py` | `downloadedVersionIds` from history for missing models; `download_queue_max_concurrent` validation. |
| `tests/utils/test_civitai_utils_rewrite.py` | `build_civitai_thumbnail_url` / `build_civitai_video_still_url`. |

No upstream docs were changed. A "Modern UI" link inside the classic UI
pages would require more template edits, so it was left out; use `/lm-ui/`
directly (the new UI links back to the classic one).

### Fork-only files (normally conflict-free)

* `ui/` - the whole modern UI (source, committed `dist/`, this README).
* `py/routes/modern_ui_routes.py` - serves `/lm-ui/` and the user themes.
* `py/services/download_queue_worker.py` - server-side executor for the
  persistent download queue (concurrency, pause/resume, dedupe by
  `download_id`, destination handling).
* `py/services/civitai_lookup_cache.py` - short-TTL lookup cache and the
  `civitai_lookup_cache()` context.
* `py/services/model_versions_status_cache.py` - per-model cache of CivitAI
  version lists for `/model-versions-status`.
* `py/services/update_classifier.py` - classification behind
  `/updates/overview`.
* `web/comfyui/modern_ui_link.js` - `/lm-ui/` availability probe and link
  builders used by the three web files above.
* 15 test files: `tests/frontend/components/modernUiLink.test.js`,
  `tests/frontend/components/topMenuExtension.modernUi.test.js`,
  `tests/routes/test_{modern_ui_routes,updates_overview_route,download_queue_destination,b2b_ui_contract,recipe_ui_contract}.py`,
  `tests/services/test_{model_scanner_scan_guard,scan_guard_move_reconcile,download_queue_worker,civitai_lookup_cache,model_versions_status_cache,update_classifier,model_actions_contract,model_tools_contract}.py`.

### Tests that guard the seams

| Seam | Tests |
| --- | --- |
| Scan guard | `tests/services/test_model_scanner_scan_guard.py`, `tests/services/test_scan_guard_move_reconcile.py` (upstream's move-aware reconcile runs inside the guard) |
| Modern-UI link from ComfyUI | `tests/frontend/components/modernUiLink.test.js`, `tests/frontend/components/topMenuExtension.modernUi.test.js` |
| `/lm-ui/` route | `tests/routes/test_modern_ui_routes.py` |
| Queue worker and its hooks | `tests/services/test_download_queue_worker.py`, `tests/routes/test_download_queue_handlers.py`, `tests/routes/test_download_queue_destination.py`, `tests/services/test_civitai_lookup_cache.py` |
| Updates overview / versions status | `tests/routes/test_updates_overview_route.py`, `tests/services/test_update_classifier.py`, `tests/services/test_model_versions_status_cache.py`, `tests/routes/test_misc_routes.py` |
| Upstream behaviour the UI relies on | `tests/services/test_model_actions_contract.py`, `tests/services/test_model_tools_contract.py`, `tests/routes/test_recipe_ui_contract.py`, `tests/routes/test_b2b_ui_contract.py` |

### Sync procedure

1. Work in your own worktree and branch, never in the installed checkout:
   `git worktree add -b sync/upstream-<date> ../lm-wt-sync main`.
2. Python baseline **before** merging: run pytest with the ComfyUI venv
   (here `ComfyUI/.venv/Scripts/python.exe -m pytest`; `pytest.ini` sets
   the options) and save the list of failures. On this Windows install about
   40 failures are known and all come from symlink creation (needs admin or
   developer mode); they are not regressions.
3. `git fetch upstream && git merge upstream/main`. Resolve conflicts with the
   tables above; also re-check the files that merged cleanly.
4. After the merge:
   * Python: the same pytest run; the failure list must equal the baseline.
   * Root frontend tests: `bun run vitest run` (or `bun run test:js`). Do not
     use the root `bun run test`: it chains `npm`/`npx`.
   * `ui/`: `cd ui && bun run test && bun run build`; check that the
     endpoints in `src/api/endpoints.ts` still exist
     (`py/routes/model_route_registrar.py`, `misc_route_registrar.py`,
     `recipe_route_registrar.py`). Commit a regenerated `ui/dist` if the
     build changed it.
   * `vue-widgets/` (upstream's Vue widgets; not run by any of the above):
     `cd vue-widgets && bun install && bun run test` (its `test` script is
     `vitest run`).
5. Re-derive the lists in this section and update the "Last synced upstream"
   line.

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
  `lm-select`, `lm-textarea` (all on the field tokens: field background,
  >= 3:1 outline, hover step, solid focus ring, disabled, placeholder,
  `aria-invalid`), `lm-check`, `lm-switch` (on/off switch on a
  `<input type="checkbox" role="switch">`), `lm-label`, `lm-hint`,
  `lm-error-text`, `lm-chip`, `lm-badge` (+ variants), `lm-panel`, `lm-row`
  (selectable rows), `lm-thumb`, `lm-overline`, `lm-toolbar`,
  `lm-prose` (sanitized HTML). Utilities always win over
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
| `bg-field`, `bg-field-hover`, `bg-field-disabled`, `border-field-border`, `border-field-border-hover`, `text-placeholder` | `--lm-color-field`, `-field-hover`, `-field-disabled`, `-field-border`, `-field-border-hover`, `--lm-color-placeholder` (with fallbacks for user themes that do not set them) |
| `bg-overlay`, `backdrop:bg-overlay`, `bg-scrim`, `text-on-scrim`, `bg-skeleton`, `outline-focus` | `--lm-color-overlay`, `-scrim`, `-on-scrim`, `-skeleton`, `-focus` |
| `bg-scrim-fade` | gradient from `--lm-color-scrim` to transparent (text over card media) |
| `font-sans`, `font-mono` | `--lm-font-sans` / `--lm-font-mono` |
| `text-xs` ... `text-2xl` (also `text-md`) | `--lm-font-size-xs` ... `-2xl` |
| `font-regular`, `font-medium`, `font-bold` | `--lm-font-weight-*` |
| `leading-normal`, `leading-tight` | `--lm-line-height`, `--lm-line-height-tight` |
| `p-1` ... `p-6`, `p-8` (also `m-`, `gap-`, `inset-`, `w-`, `h-`, ...) | `--lm-space-1` ... `--lm-space-8` (density aware) |
| `h-control`, `min-h-control`, `w-control`, `*-control-sm`, `h-topbar` | `--lm-control-height` (`-8px` for `-sm`), `--lm-topbar-height` |
| `size-touch`, `min-h-touch`, `w-touch`, `min-w-touch` | `--lm-touch-target` (44px hit area, used with `phone:` / `touch:` in the drawer) |
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

**Rule: contrast is tested.** `tests/contrast.test.ts` reads the token values
of every built-in theme and computes WCAG 2.x contrast ratios
(`src/themes/contrast.ts`, translucent tints composited on the panel):
text and muted text on page, panel, dialog and field >= 4.5:1, placeholder
on field (and field hover) >= 4.5:1, field border (and its hover) against
panel, dialog and page >= 3:1, focus ring against page, panel, dialog and
field >= 3:1, accent >= 3:1 (checked switch) and >= 4.5:1 (links), danger
text, text on accent/danger buttons and every badge (accent, success,
warning, danger text on its soft tint) >= 4.5:1, and a field background
that differs from the page. When a pair fails, tune the theme; never lower
a threshold. Current values (Light / Dark / Midnight): muted on panel
5.98 / 6.85 / 6.32, placeholder on field 5.23 / 5.76 / 6.20, field border on
panel 3.67 / 3.75 / 4.08 (on dialogs 3.67 / 3.43 / 3.70), focus ring on field
4.47 / 7.47 / 9.39. Light success and warning were darkened (`#116b33`,
`#9a4507`) so their badges reach 4.5:1.

Fields have their own surface: page < panel < field, with an outline that
alone meets 3:1 (in Light the field is white on a white panel, so the
outline carries the separation; in the dark themes the field is one step
lighter than the panel). Default Light sets its field tokens on
`:root:not([data-theme]), [data-theme='default-light']` (not on plain
`:root`), so a user theme that predates these tokens never inherits white
fields; it gets the fallbacks from `tokens.css` instead (field = its
surface, outline = 75% muted mixed into its surface, placeholder = muted).
User themes may set the six field tokens to tune this.

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
| `--lm-color-focus` | keyboard focus ring (also the solid ring of focused fields) |
| `--lm-color-field` / `-field-hover` / `-field-disabled` | background of inputs, selects, textareas, switch tracks |
| `--lm-color-field-border` / `-field-border-hover` | field outline (>= 3:1 on panel, dialog and page) |
| `--lm-color-placeholder` | placeholder text (>= 4.5:1 on the field) |
| `--lm-color-overlay` | modal/drawer backdrop |
| `--lm-color-scrim`, `--lm-color-on-scrim` | gradient + text over card media |
| `--lm-color-skeleton` | loading placeholders |
| `--lm-color-shadow` | color part of the shadow tokens |
| `--lm-color-series-1` ... `-6` | chart series (statistics), colorblind-safe order |

Non-color tokens (defaults in `base.css`, any theme may override):

| Group | Tokens |
| --- | --- |
| Typography | `--lm-font-sans`, `--lm-font-mono`, `--lm-font-size-xs/sm/md/lg/xl/2xl`, `--lm-font-weight-regular/medium/bold`, `--lm-line-height`, `--lm-line-height-tight` |
| Radii | `--lm-radius-sm/md/lg/pill` |
| Spacing | `--lm-space-1/2/3/4/5/6/8` (compact density shrinks them) |
| Shadows | `--lm-shadow-sm/md/lg` |
| Motion | `--lm-motion-fast`, `--lm-motion-normal`, `--lm-fade-duration` (media fade-in), `--lm-ease` (durations zeroed for `prefers-reduced-motion`) |
| Layout | `--lm-topbar-height`, `--lm-drawer-width`, `--lm-control-height`, `--lm-touch-target` (44px minimum hit area on phone / touch layouts), `--lm-border-width`, `--lm-focus-ring-width` |
| Page | `--lm-page-max-width` (outer width of the centered content pages, default `1180px`, mapped to `max-w-page`) |
| Cards | `--lm-card-aspect` (e.g. `2 / 3`), `--lm-card-gap` (card width comes from the per-library size slider), `--lm-card-zoom` (hover/focus zoom of card media, default `1.05`, `1` = off; forced to `1` for `prefers-reduced-motion`) |
| List rows | `--lm-row-height` (56px, compact 46px; never below `--lm-touch-target`), `--lm-row-thumb` (thumbnail, 40px / 34px), `--lm-row-gap` (6px / 4px), `--lm-row-badge-max-width` (base-model column, 140px; longer names end in an ellipsis) |

The virtualised grid reads `--lm-card-aspect`, `--lm-card-gap`,
`--lm-row-height` and `--lm-row-gap` at runtime, so a theme or density
switch re-lays out the grid and the list. The row tokens are layout tokens:
they live in `base.css` (and the compact block) only, never in a theme file.
The grid wrapper no longer sets a permanent `will-change: transform` (it is
re-positioned only when the rendered row window changes, not animated).

## Navigation and layout

There is no sidebar: the content area uses the full width.

* **Top bar** (`components/TopBar.vue`): logo (links to LoRAs), the library
  tabs LoRAs / Checkpoints / Embeddings / Recipes (`<nav aria-label="Libraries">`
  with links; the active one is highlighted and has `aria-current="page"`;
  `isNavActive` in `config/navigation.ts` also matches sub-paths), the global
  search, and on the right the **Updates** link (badge = likely model
  updates, see "Updates (phase 1)"), the Downloads indicator (live `active/total`
  badge, links to the Downloads page), Settings, and a **More options** menu
  (`components/AppMenu.vue`) with the theme and density pickers and the
  **Statistics** / **Diagnostics** links and the **Classic UI** link.
  Theme/density are also on the Settings page.
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

## Page layout

Every routed page declares a **layout kind** in its route meta
(`meta.layout`, `LAYOUT_KINDS` in `router.ts`; `<main>` carries it as
`data-layout`):

* `content` (Downloads, Updates, Stats, Diagnostics, Settings, Search, Not found):
  renders inside `components/PageShell.vue`. The shell owns the page scroller
  (`scrollbar-gutter: stable`, so pages with and without a vertical scrollbar
  keep identical edges), one container centered with `mx-auto` and
  `max-w-page` (`--lm-page-max-width`, 1180px including the gutter), the
  gutter (`p-6`, `p-4` on `phone:`) and one header: the page's only `h1`
  (`text-2xl`), an optional `description` slot and a right-aligned `actions`
  slot (wraps under the title on phones), then `gap-5` between the header and
  every following section. There is no wide variant: Stats charts and the
  two-column Settings rows fit the single width. The `footer` slot renders
  after the container inside the scroller (Settings' sticky save bar, which
  uses the same `max-w-page`); `defineExpose({ scroller })` gives pages the
  scroll element. Pages never set their own max width, centering or page
  padding.
* `grid` (LoRAs, Checkpoints, Embeddings, Recipes): full width, own toolbar
  and virtualised grid; they do not use the shell.

`tests/pageLayout.test.ts` fails when a routed page has no layout kind, when a
`content` page does not use `PageShell` (or brings back `lm-page` /
page-level `max-w-[...]` containers), or when the grid allow-list drifts from
the routes. On a route-name change `App.vue` moves focus to `<main
id="main-content">` when it was on the top bar or nowhere (skip-link target;
tab/query changes inside a page do not move focus).

Measured (1920/1440/1024/768/375px, Light/Dark/Midnight): all content pages
share container edges (centered, 362.5/122.5/0/0/0px left at the widths above
for a 15px scrollbar), `max-width` 1180px, padding 24px (16px at 375), h1
24px/650 at the same top offset, 20px header-to-content gap and the same
scrollbar gutter. Before: Downloads and Search were full width (edges at the
24px gutter), Stats was left aligned at 1200px, Diagnostics left aligned at
980px, Settings centered at 1180px with a 20px gap (Downloads 24px, Stats and
Diagnostics 16px) and Not found had no h1.

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

## Browse pages: toolbar, filters, selection (LoRAs, Checkpoints, Embeddings, Recipes)

All four browse pages share their chrome (`components/LibraryToolbar.vue`,
`LibraryFilterPanel.vue`, `LibrarySelectionBar.vue`, `BottomSheet.vue`); the
pages only supply data, tool entries and bulk actions through props and slots.

* **Toolbar layout.** One fixed 68px row from 901px up: title and count on the
  left, then (Recipes: the primary **Import** button), search (320px, shrinks
  instead of wrapping and gives up space before the title), Sort, **Filters**
  (badge = panel filters, search and folder excluded), the **Grid / List view**
  switch (model libraries only), the card-size slider (all desktop widths;
  72px wide below 1280px; hidden in list view), Folders, Select and one
  **Tools** menu that holds *Organize...* and the page's tools. Below 1280px
  the Folders and Select labels become icon-only with a tooltip; a truncated
  count shows in full as a tooltip. At 900px and below the search takes its
  own second row (documented 2-row layout, about 112px). Title and count never
  move to their own row when the folder panel opens.
* **Grid / List view** (LoRAs, Checkpoints, Embeddings; not Recipes). A
  segmented control (`role="group"` "View", two 36px buttons with
  `aria-pressed` and the tooltips "Grid view" / "List view") sits left of the
  card-size slider and is always visible; the choice is stored per library
  with sort and card size (`view` in `lm-ui.library.<prefix>`, `VIEW_MODES`,
  validated on read, default grid). List view renders `components/ModelRow.vue`
  in the same `VirtualGrid` (`layout="list"`: one column, `--lm-row-height`
  rows `--lm-row-gap` apart; the maths, skeleton included, is
  `gridMetrics` / `rowTop` in `utils/gridLayout.ts`, tested in
  `tests/listView.test.ts`). A row has the same events and pointer behaviour
  as a card (shared `composables/useCardInteractions.ts`). Both declare one
  contract, `ModelItemViewProps` / `ModelItemViewEmits` in
  `components/modelItemView.ts`; LibraryPage renders them in two explicit
  branches (`v-if` ModelRow / `v-else` ModelCard, not `<component :is>`,
  whose handlers vue-tsc cannot check) and a compile-time `expectTypeOf` in
  `tests/listView.test.ts` asserts that both expose identical props and
  events, so a renamed prop, event or handler fails `bun run typecheck`.
  A row has a full-row button
  (`aria-label` / `aria-pressed` like the card), a `--lm-row-thumb` thumbnail
  (mature blur, `--lm-card-zoom` hover zoom, no lift), name and folder, base
  model badge, size, modified date, up to three tags and always-visible Send
  (LoRAs) / Favorite / More actions buttons; a checkbox-style indicator on
  the left in selection mode. Date and tags drop out when the row is narrow
  (container queries on the row's own content width, so an open folder panel
  never squeezes the name). **Column breakpoints** (`utils/rowColumns.ts`,
  pinned by `tests/rowColumns.test.ts`): the date shows from **820px** and
  the tags from **1060px** of row width. They are derived from the column
  widths (thumbnail `--lm-row-thumb` 40, base model `--lm-row-badge-max-width`
  140, size 72, date 150, tags 200, three 32px buttons, 12px gaps): a column
  appears only once the name keeps at least `ROW_NAME_MIN_WIDTH` (200px, about
  28 characters) in the worst case, selection indicator plus Send button
  (222px at 820, 250px at 1060), and the test also checks they are not set
  needlessly high. Below 820px only name, base model and size remain. The
  Tailwind classes (`@max-[820px]:hidden`, `@max-[1060px]:hidden`) are literal
  strings in the same module (Tailwind cannot see computed class names) and a
  test checks they match the numbers. **Truncation**: name, folder, base
  model, size, date and tags truncate with an ellipsis and carry their full
  text in `title`; the base-model badge keeps its text in an inner truncating
  span (an `inline-flex` badge cannot ellipsise its own text), and the cell
  may shrink before the name drops below 96px. Because the cells are
  `pointer-events-none` (the full-row button takes clicks and hover), their
  own titles never show on hover, so the row button's `title` lists the whole
  row in full (`rowTooltip`: name, folder, base model, size and date, tags -
  also the columns hidden at the current width); screen readers get the full
  cell text anyway (CSS truncation does not cut the DOM text). Checked at
  1440px, 1180px with the folder panel open, 910px and 375px with a synthetic
  67-character base model injected into the rendered rows: no overlap, the
  action buttons stay inside the row, no horizontal page scroll. On phones a row is the thumbnail, the name, and
  base model + size on a second line, with 44px buttons (Send stays in the
  menu). Switching views keeps the first visible item at the top; scroll
  restore, drawer prev/next (`scrollToIndex`) and Shift+click ranges work the
  same in both layouts. There is no trigger-words column (not in the list
  payload) and no sortable header.
* **Phone (<= 720px).** One row: search plus a single **Filters** button
  (accessible name "Filters and sort", badge = active count) that opens a bottom
  sheet (native modal `<dialog>`, focus trap, Escape and backdrop close, on the
  dismiss stack) with sort, the Grid / List view buttons and the card-size
  slider (grid view only), show/hide folders, Select, the tool entries as
  labelled rows, the filter groups and a **Done** button. The page title is
  screen-reader only (the tabs above name the page); while filtered the count
  shows in the chips row. Controls here are `min-h-touch` (44px).
* **Filters.** The base-model group is left out of the panel wherever the quick
  filter row exists (all pages except Embeddings); the tag group gets a text
  filter once it has 8 or more tags. The chips row has reserved height on
  desktop, so adding a filter does not move the grid (on phones it appears
  only while filtering). While filtered the count reads "85 of 1,041 models",
  using the total seen the last time nothing was filtered. The empty state has a
  **Clear filters** button.
* **Selection.** The selection bar replaces the toolbar row at the same height
  (the grid does not jump). Shift+click selects a range from the last toggled
  card (`selectRange` in `utils/modelActions.ts`), the bar shows how many
  selected items are not in view ("3 selected (2 not in view)"), Escape leaves
  selection mode when no drawer, dialog or menu is above it (dismiss stack).
  Ctrl+A, delete/undo and the other bulk flows are unchanged.
* **Shortcuts.** Bare `f` toggles Filters (the sheet on phones), `s` toggles
  selection mode and `r` refreshes the page (every page, see Refresh). They are ignored with a modifier, while typing in a field,
  inside a dialog, menu or listbox, and while a drawer is open
  (`shouldHandleShortcut` in `utils/browse.ts`). The toolbars have
  `role="toolbar"` and an `aria-label`; the buttons carry `aria-keyshortcuts`.
* **State across tabs.** Filters, search, folder, the recipes "missing only"
  toggle, the unfiltered total and the scroll position are kept per library in a
  module-level store (`utils/browse.ts`, saved on unmount) and restored when you
  come back (the list is re-fetched; pages are loaded until the old scroll
  position exists, up to 600 items). A deep link (`?q=`, `?tag=`, `?open=`)
  clears the stored state first. Selection is not kept. Sort and card size keep
  their existing localStorage keys.
* **Loading and end of list.** While the first page loads, `VirtualGrid` renders
  placeholder cells with the real columns, gap and aspect (`utils/gridLayout.ts`
  is shared with the grid maths) and `aria-busy`; when everything is loaded the
  grid footer says "You've reached the end: N models".
* **Context menus** (`components/ModelActionMenu.vue`, one shared WAI-ARIA
  menu; entries built by the pure `utils/menuItems.ts`, tests in
  `tests/menuItems.test.ts`, written first). An entry may be `disabled`
  (`aria-disabled`, still reachable with the arrow keys, ignored on click)
  and carry display-only `shortcut` text; the menu takes an optional
  `heading` caption. Three menus on the library pages:
  * **Item** (right-click a card or its "..." button): Open details, Send to
    ComfyUI and Replace in ComfyUI (only where sending works, i.e. LoRAs),
    Copy LoRA syntax (LoRAs), Add to / Remove from favorites, View on Civitai
    (new tab, only with a Civitai model id; URL from `civitaiModelUrl` in
    `utils/civitai.ts`, shared with the drawer), then the model actions above.
    No "Copy trigger words": the list payload has no trigger words.
  * **Selection**: in selection mode, right-clicking a **selected** card
    shows the bulk actions of the selection bar (Move..., Add tags...,
    Filename template..., Send to ComfyUI, Copy names, Delete...) under a
    "3 selected" heading. Right-clicking an **unselected** card in selection
    mode shows that card's own item menu and leaves the selection alone
    (changing a carefully built selection on a right-click was judged more
    surprising). Right-click works in selection mode on recipe cards too
    (their item menu; recipes have no selection menu yet).
  * **Folder** (right-click a row of the folder tree, or the context-menu
    key): New subfolder..., Rename folder..., Apply filename template...,
    Delete folder... for the **pointed** folder; the folder panel's "..."
    header menu shows the same entries for the selected folder (or New
    folder... at the root). Both run `createFolderActions` in
    `utils/folderActions.ts`, which takes the folder path as an argument:
    delete still resolves the folder, refuses one present in several roots
    and runs the dry-run probe + danger confirm in `tools.deleteFolder`;
    deleting the selected folder (or a parent of it) clears the folder filter,
    renaming it keeps the selection on the new name (`renamedFolderPath`).
  Every destructive entry runs through the existing flows (danger confirm,
  20 s staged delete with Undo); there are no Delete/F2 shortcuts and no drag
  and drop. The pointer helpers are shared by model cards, list rows and
  recipe cards (`composables/useCardInteractions.ts`): a keyboard
  context-menu key anchors the menu at the focused element. On touch, the
  "..." button is always visible, and a **long press** (touch or pen, VueUse
  `onLongPress`, `LONG_PRESS_DELAY_MS` 500 ms) opens the same item/selection
  menu at the touch point - iOS fires no `contextmenu` on a long press. The
  pure `createPressMenuGuard` (tests in `tests/cardInteractions.test.ts`,
  written first, fake timers) keeps it from colliding with the browser:
  moving more than `LONG_PRESS_DISTANCE_PX` (10px) or a `pointercancel`
  (the browser started scrolling) cancels it; the click that follows a long
  press is swallowed once (no drawer, no selection toggle; the swallow expires
  `LONG_PRESS_CLICK_SUPPRESS_MS` after the finger lifts); Android's own
  `contextmenu` for the same press opens no second menu, in either order
  (`CONTEXTMENU_DEDUPE_MS`, 700 ms). Mouse presses never trigger it
  (right-click is the mouse menu), and a long press that starts on an inner
  action button (Send, Favorite, "...") is ignored. Cards and rows set
  `select-none` and `-webkit-touch-callout: none` so iOS shows no text
  selection or callout instead.
* **Ctrl/Cmd+click** on a card toggles it in the selection (and turns
  selection mode on when it is off); Shift+click in selection mode still
  selects a range.
* **Cards.** Tags are one ellipsised line (no dangling separator), the scrim
  behind titles is taller, card titles are paragraphs (no heading flood) and the
  recipe card's send button is hidden on phones (it stays in the menu).

## Refresh

Every page can re-read its data without a browser reload (new downloads
finished, edits made in ComfyUI or the classic UI, files added or removed
outside LoRA Manager, ...).

* **Registry** (`composables/useRefresh.ts`): the routed page registers one
  handler while it is mounted (`useRefreshHandler`, `onMounted` /
  `onBeforeUnmount`; an older page that unmounts late never removes a newer
  page's handler). The shell runs the current one: `RefreshButton`
  (`components/RefreshButton.vue`) and the `r` shortcut (`useRefreshHost`,
  installed once in `App.vue`). One run at a time: a click or `r` while a
  refresh runs (scan included) is ignored. The handler gets
  `{ silent, setPhase }`; `setPhase('scanning' | 'loading')` drives the
  button's busy text.
* **Library pages and Recipes: scan, then reload.** A manual refresh (button,
  sheet row, `r`) first runs the **library rescan** the classic UI's Refresh
  menu uses, waits for it, then re-reads the page as below
  (`composables/useLibraryScan.ts`, flow in `utils/libraryScan.ts`):
  1. `GET /api/lm/init-status?page=<loras|checkpoints|embeddings|recipes>`
     (read-only). When that scanner is busy (`initializing`: a scan from
     another tab, the classic UI or the startup scan is running) the page
     does not queue a second one behind it; it only reloads and says "A
     library scan is already running; showing the current data." A library
     that is not ready (`awaiting_first_scan`, the
     first-run scan the user has not confirmed yet, or `error`) is not scanned
     either ("The library is not ready to scan yet; ...").
  2. `GET /api/lm/<prefix>/scan` with **no parameters** (quick reconcile;
     never `full_rebuild`), or `GET /api/lm/recipes/scan` on Recipes. If a
     scan started between the check and this request, the backend's scan
     guard (below) makes it join that scan: the answer is the same summary
     with `joined: true`, counted like our own. A 409 answer (not sent by
     the current backend) counts as "already running"; another failure
     shows "Library scan failed: <message>" and the page still reloads.
  3. The light re-read. When the scan answered counts and something changed,
     one toast summarises it: "Library scan: 2 new, 1 removed". No changes, or
     no counts (recipes), means no toast.
* **Other pages** (Downloads, Updates, Statistics, Search, Settings, Diagnostics) only
  re-read (no scan).
* **Where the button is.** Library pages and Recipes: an icon button directly
  before **Tools** in the toolbar (always visible from 901px up; hidden in
  selection mode with the rest of the toolbar row, `r` still works) and a
  labelled 44px **Refresh** row in the phone "Filters and sort" sheet (the
  sheet stays open so the busy state is visible). Content pages (Downloads,
  Statistics, Settings, Search): `PageShell` puts it at the end of the header
  actions (next to the title when the page has no actions; 44px on phones).
  Diagnostics keeps its own **Run again** button (`button: false`; `r` runs
  the checks, the button's tooltip says so). Not found has no refresh.
* **Look and state.** New `reload` icon (two arrows; the single-arrow
  `refresh` icon stays for "Refresh from Civitai"). Tooltip "Refresh (R)"
  (`aria-keyshortcuts="R"`); on the browse pages "Refresh (R): scan the
  library folders for added or removed files, then reload". While running:
  the icon turns (`animate-spinner`, transform only,
  `motion-reduce:animate-none`), the button is `aria-busy` and
  `aria-disabled` (not `disabled`, so keyboard focus stays), and its tooltip,
  accessible name and sheet-row label read "Scanning library..." during the
  scan, then "Refreshing...". No success toast for a plain reload; a failure
  is an error toast "Could not refresh: <message>" (the usual `ApiError`
  text, e.g. the backend-not-reachable message) and the page keeps what it
  showed.
* **Shortcut `r`**: bare key only (no Ctrl/Meta/Alt/Shift), ignored while
  typing in a field, inside a dialog, menu or listbox, while a modal
  `<dialog>` or menu is open (`shouldHandleShortcut`), and for key repeats.
  No clash with `f`, `s`, `j`, `k`, `/`. With a drawer open focus is inside
  it, so `r` does nothing there; close the drawer, or rely on the tab-return
  refresh, which also updates the open drawer.
* **Tab return.** Library pages and Recipes (`onVisible: true`) re-read
  silently (no toast, **no scan**, no scanner-state request) when the tab
  becomes visible after being hidden for at least 60 s
  (`AUTO_REFRESH_AFTER_MS`). The other pages do not (Downloads already polls,
  visibility-aware; Diagnostics would call Civitai; Statistics and Settings
  are refreshed by hand).

What each page refreshes (the page keeps its UI state):

| Page | Refresh |
| --- | --- |
| LoRAs / Checkpoints / Embeddings | the quick library scan of that type (above), then the loaded range of the list with the same filters, sort, search and folder (`useInfiniteList.refresh`: pages 1..n again, at most `RESTORE_MAX_ITEMS` = 600 items, i.e. 10 pages of 60, stopping at the server's last page; the result replaces the items at once, so the grid never empties), the folder tree, base-model chips and tag filters; selection mode and the selected keys stay; the open drawer gets the refreshed copy of its model and re-reads its metadata (examples, trigger words, description) and, once loaded, the versions, without placeholders, keeping its tab and scroll; new notes / tags from the server are shown unless the notes hold an unsaved draft |
| Recipes | the recipe scan, then the same for the recipe list (plus "missing only"), folder tree, base models and tags; the open recipe drawer re-reads `GET /api/lm/recipe/<id>` (the "opened" POST is sent only when a drawer opens, not on refresh) |
| Downloads | the queue (also polled every 1.5 s while open) and the history |
| Updates | the read-only overview of the active type (no scan, no Civitai request; Check now is separate) |
| Statistics | the six stats endpoints and the opened "most used" lists (the rows already shown, one request each); the charts stay on screen while loading |
| Search | the four library searches of the current query; the results stay until the new ones arrive |
| Settings | the stored settings (`form.reloadKeeping`: unsaved edits are kept on top) and the root lists; a failure shows the existing load-error banner |
| Diagnostics | runs the checks again (`r` only; the page's own Run again button stays) |

**Scroll and items.** The list is re-read in place, so the grid keeps its
scroll position. `utils/refreshList.ts` remembers the first item of the top
visible row (`VirtualGrid` `anchor()`, `anchorAt` in `utils/gridLayout.ts`)
and, when items were added or removed above it, scrolls so that item stays at
the same spot (`scrollToAnchor`). Items that moved between pages while the
pages were read are kept once (by `file_path` / recipe id). A `loadMore`
asked for during a refresh runs after it; a filter change (reset) during a
refresh wins. Beyond 600 loaded items only the first 600 are re-read;
scrolling further loads the rest again.

**What the scans do on the backend** (read from the handlers, not run
against a real library):

* `GET /api/lm/{prefix}/scan` (`ModelQueryHandler.scan_models` ->
  `ModelScanner._reconcile_cache`), quick mode: admits roots that became
  readable again (append-only), walks the configured roots (in parallel per
  device; unreachable roots and paths are skipped and their cached models
  kept), then
  * **new files** (on disk, not in the cache): read their `.metadata.json`;
    without one, build it from a `.civitai.info` when present, else create a
    default sidecar and compute the SHA256 locally (checkpoints and other
    large types defer the hash); the new sidecar is written to disk. No
    Civitai request. Empty files and staged deletes are skipped;
  * **missing files** (in the cache, not on disk): their cache rows are
    dropped. Nothing is deleted on disk;
  * **repairs**: cache rows whose `file_name` / `folder` drifted from the
    file are fixed; loading a sidecar may rewrite only its path fields
    (`file_name`, `file_path`, `preview_url`), atomically, keeping every
    other field (unknown fields included);
  * persists the cache (SQLite) when something changed and broadcasts
    `models_changed`; the answer is `{status, message, added, removed,
    repaired, folder_repaired, scanned_roots, skipped_roots, ...}`
    (`status: "cancelled"` when cancelled). Without a built cache it performs
    the full initialisation instead (the UI does not scan then: init-status
    reports `initializing`). A no-change reconcile of the ~1,150-LoRA library
    took about 0.1 s in the server log (0.6 s with 10 new / 5 removed files);
    new files cost their SHA256 read.
  * `full_rebuild=true` (never sent by this UI) rebuilds the whole cache.
  * **Scan guard** (`ModelScanner.scan_library`): one scan per model type
    at a time, behind a per-scanner `asyncio.Lock`. A request identical to
    a scan in flight (same kind and scope, running or queued) joins it and
    answers the same summary plus `joined: true` (HTTP 200, so the classic
    UI, which treats every non-2xx as "refresh failed", keeps working). A
    different request (a full rebuild while a quick scan runs, another
    scope, `doctor/repair-cache`) waits for the running scan, then runs.
    The startup initialization holds the same lock. The scan runs as its own
    task: a caller that goes away does not abort it for the others, and an
    error reaches every waiting caller and releases the lock. Other model
    types are never blocked, and plain list requests never wait. While a
    scan runs, `init-status` for that page reports `initializing` (the
    scanner's existing flag, set by the reconcile and the rebuild).
* `GET /api/lm/recipes/scan`: always a full recipe re-read (the
  `full_rebuild` parameter is ignored), serialised by the scanner's lock: it
  clears the recipe SQLite cache, re-reads every `*.recipe.json` in a worker
  thread, then starts the same background enrichment as startup (missing LoRA
  hashes looked up in the LoRA cache or on Civitai and written back into the
  recipe file). Recipe files are not deleted; the answer has no counts.
* `POST /api/lm/doctor/repair-cache` (Diagnostics > Rebuild cache..., only
  offered when the cache check reports a problem) is the full rebuild of
  every model cache; the Refresh button does not use it.
* `ModelVersionsStatusCache` (`GET /api/lm/model-versions-status?refresh=1`)
  is not used by the modern UI.

Tests: `tests/refresh.test.ts`: registry (register / unregister, route
changes through a real router, no double run, busy state and phase, error
toast, silent runs), the `r` shortcut (modifiers, fields, dialogs, menus, no
clash with f/s/j/k), the tab-return refresh (60 s threshold, opt-in),
`useInfiniteList.refresh` (in-place swap, page cap, early stop, duplicates,
failure keeps the items, reset wins, deferred loadMore), `refreshInPlace` /
`anchorAt`, `runLibraryScan` / `scanNotice` (busy, not ready, 409, failure,
counts, joined scan, cancelled, toast text), `RefreshButton` (visibility, aria-busy, no
`disabled`, reduced-motion class, "Scanning library..."), its places in the
toolbar and `PageShell`, and the pages against a mocked backend: LoRAs
(init-status, then exactly `GET /api/lm/loras/scan` without parameters, then
the re-fetch with the same filters; selection mode kept; the "2 new, 1
removed" toast), Checkpoints and Embeddings (their own scan URL, no toast
without changes), Recipes (`GET /api/lm/recipes/scan` before the re-read),
tab return (no scan, no init-status), a second trigger during the scan
(ignored, one scan), a busy server (no scan, reload, note), the open drawer
(kept and re-read, an unsaved notes draft kept), all requests GET.

Browser check of the first version (light reload only, against the live
backend, read-only): LoRAs filtered by a base model, scrolled and in
selection mode with one card selected, then `r` and the button: same scroll
offset, same first visible card, selection kept, only GET requests; `r` on
Checkpoints, Recipes, Search, Settings, Statistics, Downloads and Diagnostics;
the toolbar button at 1100px in Dark, Midnight and Light; the sheet row and
the header buttons (44px) at 375px. The scan step was **not** run against the
real library: it is verified by the mocked tests and by reading the backend
code only.

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
* **Detail drawer** (`ModelDrawer.vue`). Header: title (two lines on a phone,
  full name in the tooltip and under Specifications > File name), base-model /
  Update / version badges (the Update badge is a button that opens the Versions
  tab; on a phone only the base model is shown), **Favorite**, **More actions**
  (`aria-haspopup="menu"`, the same `ModelActionMenu` as the card with the same
  nine actions in the same order, preceded by **View on Civitai** and **Open in
  classic UI**, both new-tab links with `rel="noopener noreferrer"`) and
  **Close**. The menu renders next to the drawer panel (z-70 over the drawer's
  z-60); the actions still emit `action` with the same `ModelAction` values and
  run through `LibraryPage.runAction`. Tabs: Overview, Description, Versions
  (the Examples tab is gone), a WAI-ARIA tablist with a label, roving tabindex
  and ArrowLeft/Right/Home/End (`nextTab` in `utils/drawer.ts`); all three panels
  stay in the DOM (`v-show`) so `aria-controls` is always valid, the Versions
  data still loads the first time its tab is shown, and a tab switch scrolls the
  body back to the top.
  **Overview order** (LoRAs): Send block (strength, Send to ComfyUI, Replace in
  ComfyUI, Copy LoRA syntax as an icon button; below it the model's
  `usage_tips` as read-only chips such as "strength 0.8" / "clip 1", a click on
  the strength chip fills the field; `usageTipEntries` in `utils/workflow.ts`),
  Trigger words (empty text only for LoRAs, the section is hidden for empty
  checkpoints/embeddings), Examples (cover plus thumbnails, with **Manage
  example images...** in the heading row), Tags, Notes, Specifications.
  Checkpoints and embeddings start at Trigger words / Examples. There is no
  other Send button (the header Send icon is gone).
  The cover shows beside the example thumbnails when the drawer is wide
  (container query at 460px) and the thumbnails form a horizontal strip under it when narrow. Thumbnails open `ExampleLightbox.vue` (modal `<dialog>`,
  arrow keys, Escape, focus returns to the thumbnail) with the generation data
  of Civitai `images[].meta` normalised by `utils/generation.ts`: prompt and
  negative prompt with copy buttons, parameter chips (model, sampler,
  scheduler, steps, CFG, seed, size, clip skip, denoise, VAE) and resources;
  "No generation data" when the image has none. Thumbnails with a prompt get a
  small text badge and the prompt as tooltip.
* **Mature content** follows the library card: with the `blur_mature_content`
  setting on (default), a preview or example with NSFW level >= 4 is blurred
  (`isBlurred` in `utils/mature.ts`, used by the card, the drawer cover by
  `preview_nsfw_level`, the thumbnails by `image.nsfwLevel`). In the lightbox
  the image stays blurred behind a **Show** button that reveals that image
  only (not persisted).
* **Unsaved notes**: notes are never auto-saved. While they differ from the
  saved text the Save button is enabled and "Unsaved changes" shows next to it;
  leaving through Escape, the backdrop, Close or a tag click opens the confirm
  dialog "Discard unsaved notes?" (Discard / Keep editing, focus returns to the
  notes field; `shouldConfirmClose` in `utils/drawer.ts`). A clean drawer closes
  immediately. Opening another model through the `item` prop resets the draft.
* **Versions tab**: the row of the file you own (`currentVersionId`: the item's
  Civitai version, else the loaded metadata) has a **Current** badge and an
  accent border. Each row has one **Queue download** button and a ghost icon
  button **Download...** (opens the download dialog for the version) in a
  fixed-width column, so rows line up; a version that is already in the library
  only shows the "In library" badge.
* **Touch and phone layout**: inside the drawer every control reaches
  `--lm-touch-target` (44px) with the `phone:` and `touch:` variants (tabs,
  header icons, chips, send buttons, versions actions, menu rows; tag chips keep
  their 24px look and get the 44px hit area through the button box plus a
  negative margin). `lm-btn` itself is unchanged. On a phone the pinned header
  plus tabs take about 130px.
* **Prev/next and the remembered tab** (`utils/drawerNav.ts`, tests in
  `tests/drawerNav.test.ts`, written first). The header has a **Previous model** and
  **Next model** icon button around a position label ("3 of 120"; just the ordinal
  when the total is unknown). They step through the list as it is currently displayed
  (filters, sort and search applied); `LibraryPage` owns the list and the open item,
  passes `nav` (`computeNav`) plus the neighbours' preview URLs to the drawer and
  handles its `navigate` event. Buttons are disabled at both ends (no wrapping);
  at the last loaded item Next stays enabled while more pages exist: the page loads
  the next page and continues. Each step replaces `?open=` (Back leaves the
  drawer instead of walking through models), keeps the tab, scrolls the drawer body
  and the grid (`VirtualGrid.scrollToIndex`) so the card is in view, and announces
  "Showing <name>, <position>" in a polite live region. When the notes are dirty the
  same "Discard unsaved notes?" confirm appears first. Rapid presses are queued by
  the page; metadata/versions are fetched only after a 150 ms pause (a held key
  requests nothing per step), stale responses are dropped and in-flight requests are
  aborted (`createRequestGuard`); only the neighbours' preview images are warmed.
  When the focused button becomes disabled at an end, focus moves to the other one.
  **Shortcuts** (`shouldHandleNavKey`): Alt+ArrowLeft / Alt+ArrowRight, and plain
  `k` (previous) / `j` (next); only while the drawer is the topmost layer (`useDismiss`
  stack) with no dialog (lightbox, confirm, example images) or its More actions menu
  open, never while typing in an input, textarea, select or contenteditable (Alt+Arrow
  is word movement on macOS), and no Ctrl/Meta/Shift. The tab list ignores Alt+Arrow.
  On a phone the navigation sits on a second header row (left of the base-model
  badge); its 44px hit areas overlap the row's padding so header + tabs stay at about
  129px at 375px wide. The recipe drawer does not have prev/next yet.
  **Last tab**: the selected tab is stored in `localStorage` (`lm-ui.detail.tab`,
  validated against Overview / Description / Versions, default Overview) and applied
  to every model you open; a model that lacks the tab (Versions needs a Civitai model
  id) shows Overview without overwriting the preference.
* Drawer tests: `tests/drawer.test.ts` (mature-blur rule, usage-tip chips,
  `nextTab`, `shouldConfirmClose`, `currentVersionId`), written before the UI.
* **Tags** are uniform pills (click = filter the library by that tag and close
  the drawer, x = remove), collapsed after 12 with "+N more"
  (`utils/tags.ts`). **Specifications** (file name, path, folder, base model,
  type, file type, size, dates, hash; copy path/hash) are a collapsible
  section, closed by default, remembered in `localStorage`
  (`lm-ui.detail.specsOpen`, `composables/usePersistentToggle.ts`).
* **Send to ComfyUI** (LoRAs, `config.sendToComfy`): a button on every card
  (shown on hover/focus, always on touch devices; Shift+click replaces), and
  Send / Replace / Copy LoRA syntax with a strength field at the top of the
  drawer overview. Same flow as the classic UI
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

* **Card menu** ("..." button on every card, or right-click): the shared
  context menu (see "Context menus" under Browse pages) with the quick
  actions plus Move..., Rename file..., Filename template, Preview, Content
  rating, Refresh, Re-link, Exclude from library..., Delete... (WAI-ARIA
  menu: arrow keys, Home/End, Escape returns focus to the button). The
  **drawer** has the same model actions in its More actions menu.
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

## Statistics, diagnostics, settings, backups and example images (phase B2b)

Ported from the classic UI (`statistics.js` + `statistics.html`,
`DoctorManager.js`, `EnvironmentPanel.js`, `SettingsManager.js` + the
settings templates, `ExampleImagesManager.js`, `components/shared/showcase/*`,
the update check of `UpdateService.js`). API client `api/maintenance.ts`,
pure helpers `utils/{settingsModel,exampleImages,stats,maintenance}.ts`,
flows `composables/{useSettingsForm,useExampleImages,useMaintenance}.ts`,
strings `i18n/b2bMessages.ts`. Backend semantics: "Phase B2b discovery" at
the end of this file.

* **Statistics** (`/stats`, top-bar More menu): seven metric tiles and five
  tabs (Overview: collection donut, base models as stacked bars, 30-day usage
  line chart; Usage: top 10 across libraries plus paged "most used" lists
  per library; Collection: tag cloud (click = LoRAs with that tag), model
  types donut, analysis; Storage: storage donut, largest models, size vs.
  usage scatter on a log axis; Insights). Charts are dependency-free SVG/CSS
  in `components/charts/` with the data transforms in `utils/stats.ts`. Every
  chart has a `role="img"` summary and a **Show as table** toggle. Series
  colors are the new `--lm-color-series-1..6` tokens (Okabe-Ito based,
  colorblind-safe order, tuned per theme; Tailwind `fill-series-N`,
  `stroke-series-N`, `bg-series-N` through `components/charts/chartClasses.ts`).
  All stats endpoints are read-only.
* **Diagnostics** (`/doctor`, More menu): runs the checks on open (and on
  "Run again"), overall status plus one card per check with severity,
  details and actions. **Rebuild cache...** (confirm: rescan + rewrite of the
  persistent cache, no file touched) and **Rename duplicates...** (danger
  confirm with the file and group counts, the rename pattern, no undo, and
  the hint that the full LoRA syntax avoids renaming) call the backend;
  "Open settings" / "Switch to full LoRA syntax" jump to the setting,
  "Reload page" reloads. **Export support bundle** downloads the server's
  sanitized zip (nothing is stored on the server). The page sends the
  server's own version (`/version-info`) as `clientVersion`, so the classic
  stale-bundle check stays green for the new UI. The environment panel
  (versions + "Copy environment" as Markdown) is shared with Settings > About.
* **Settings** (`/settings/<tab>`): every section of the classic modal
  (General, Downloads, AI provider, Proxy, Interface, Library, Organization,
  Example images, Metadata, Backups, About) from one schema
  (`config/settingsSchema.ts`, `utils/settingsModel.ts`), presented in tabs
  and cards (see "Settings page UX" below), with per-field validation (ranges,
  steps, folder and file-name templates with their placeholders, proxy port,
  URLs, priority-tag parentheses, checkpoint/UNet folder overlap) shown
  inline under the control while typing and after a save attempt, **Reset**
  per field (the backend defaults; the classic modal has none),
  "Classic UI" / "Restart" / "Moves files" / "Moves settings" / "Rescans
  library" chips next to the label. One **Save changes** sends only the changed keys,
  **server-validated keys first** (a rejected value then saves nothing), asks
  first for side effects (moving recipes, portable mode, restart-only
  folders), re-reads the settings afterwards, and after an error shows the
  backend message, re-reads what the server actually stored and keeps the
  unsaved edits. **Unsaved-changes guard**: leaving the route asks, closing
  the tab triggers the browser prompt. Dotted fields (`download_path_templates.lora`,
  `send_to_workflow_exclusions.node_classes`, `default_other_roots.vae`, ...)
  are merged into the whole object, so keys the form does not show survive.
  Path and file name templates now save an explicit empty value (classic
  semantics: flat folder / original file name).
* **Secrets** (Civitai key, Hugging Face token, LLM key, proxy password) are
  never shown or pre-filled: the field says Configured / Not configured and
  offers Change... (a `type=password` input with a show toggle) or Remove;
  `proxy_password`, which GET returns in clear, is dropped from the settings
  on read (`sanitizeSettings`). Secrets only travel in the POST body (never
  a URL), the UI never logs them, and `redactPatch` masks them for any
  display. Removing the proxy password sends `__DELETE__`.
* **Backups** (Settings > Backups & maintenance): automatic backup toggle and retention,
  the list of stored snapshots (auto/manual, size, date, folder), **Download
  a backup now** (the export endpoint; the zip goes to the browser, nothing
  stays on the server), **Open backup folder**, and **Restore from a
  backup...**: a dialog that lists every file that is overwritten, warns that
  there is no safety copy (with a "Download current state first" button),
  says ComfyUI must be restarted, and only enables "Overwrite and restore"
  with a `.zip` file chosen and `RESTORE` typed (checked again in
  `useBackups`). There is no delete (no endpoint).
* **Metadata archive** (Settings > Civitai & metadata): status (downloaded / size,
  enabled), **Download database...** (confirm stating the multi-GB download
  and the overwrite; the request stays open, the panel shows a busy state;
  progress over WebSocket is not ported) and **Remove database...** (danger
  confirm).
* **About**: version, **Check for updates** (GitHub, read-only; installing
  stays classic), environment, the still-classic note.
* **Local example images**: the drawer shows the local copy of every example
  image when it exists (`/example_images_static/...`, matched like the
  classic resolver but by the **source** index) and the remote URL
  otherwise, plus imported images; a "N local" badge and **Manage example
  images...** open `ExampleImagesDialog.vue`: Download from Civitai (this
  model, synchronous), Import images... (file picker or drop, unsupported
  types skipped and reported), Open folder (system / clipboard / URI mode
  answered by the backend), a rating select per image (PG ... XXX) and Delete
  for **imported** images only (danger confirm: permanent). Without a
  configured folder the dialog says so and links to the setting. Settings >
  Example images holds the folder (validated by the backend) and options plus
  the library-wide **Download all...** (confirm) with progress (polled every
  2 s while running), pause / resume / stop; it uses the **saved** folder.

### Settings page UX

Presentation only: `config/settingsTabs.ts` groups the schema fields into
tabs and cards, `utils/settingsTabs.ts` holds the pure logic (tested in
`tests/settingsTabs.test.ts`); the model, validation and save flow are
unchanged.

* **Tabs** (nine): General (language, content filtering, settings file),
  Interface (theme/density of this UI, prompts and Send to ComfyUI, classic
  UI display), Library & folders (roots, other model types, workflows and
  wildcards, extra folder paths, recipe storage), Downloads (queue, folder
  and file name templates, sorting rules), Example images, Civitai &
  metadata (keys, metadata sources, archive database, model updates),
  Integrations (AI provider, proxy), Backups & maintenance (backups,
  diagnostics and statistics links), About (version, updates, environment).
  Every field is in exactly one card and every panel once (tested).
* **Tab list**: WAI-ARIA `tablist` / `tab` / `tabpanel`, roving tabindex,
  arrows (both axes), Home/End with automatic activation, `aria-selected`
  and `aria-controls`. Vertical and sticky on wide screens; below the
  `tablet:` breakpoint a sticky, horizontally scrolling strip (the active tab
  is scrolled into view). Each tab shows its number of unsaved changes.
* **URL**: the active tab is the route param (`/settings/<tab>`, deep
  linkable, reload safe, `router.replace` so tab switches do not pile up in
  the history) and is remembered in `localStorage` (`lm-ui.settings.tab`;
  `/settings` opens the last tab). Legacy links keep working:
  `#field-<key>` and `#card-<id>` open the right tab, scroll to the field or
  card, focus it and highlight it briefly; `#set-<section>` maps the old
  section ids to their card. Scroll position is remembered per tab (a tab
  not seen yet opens at the top).
* **Layout**: cards with a heading and short description; field rows in two
  columns on wide screens (label, chips and help text left, control right)
  and one column below `tablet:`; toggles are switches; danger cards
  (settings file, recipe storage) have a danger edge and icon; a changed row
  gets a thin accent bar on its left edge (plus "(Changed)" for screen
  readers). Inline errors sit under the control with an icon.
* **Reset**: a small "Reset" text button at the right edge of the row,
  rendered only when the value differs from its default (normalised like
  the save patch; never for secrets or fields without a default), in a
  fixed-width slot so controls line up (below `tablet:` the slot only takes
  space when shown). The tab footer has **Reset tab to defaults…** with a
  confirm listing every change (`label: current → default`); nothing is
  saved until **Save changes**.
* **Search**: one box searches every tab (label, help text, key, card
  title; panels through their title, description and keywords; hidden
  fields are skipped). Results are grouped by tab with a count, tabs show
  their match count (tabs without matches are dimmed); Enter opens the first
  result, Down moves into the list, Escape clears; picking a result opens
  its tab, scrolls to the field, focuses it and highlights it. No matches
  shows an empty state with suggestions.
* **Save bar**: sticky at the bottom of the scroll area, in the flow (so it
  never hides the last field), only with unsaved changes or a save error:
  "N unsaved changes", the save error, Discard changes, Save changes. A
  failed validation opens the tab of the first invalid field.
* **Loading / errors**: a skeleton while the settings load; a load error is
  a banner with Retry (also when the re-read after a save fails).
* **Secrets**: never shown; Configured / Not configured, Change… opens a
  password input with a show/hide toggle (eye / eye-off), Remove.
* Motion uses the motion tokens (zero for `prefers-reduced-motion`; the
  search jump scrolls instantly then).

### Safety

* Nothing destructive happens without a confirm that says what changes on
  disk: renaming duplicates, rebuilding caches, restoring a backup (typed
  confirm), downloading/removing the archive, deleting an imported example
  image, starting the library-wide download, saving settings with side
  effects.
* Not ported on purpose (destructive or a migration flow): installing
  updates and switching channels (`perform-update` / `switch-channel` rewrite
  the plugin folder), the sidecar storage mode/path change with its migration,
  the example-images folder cleanup (moves folders to `_deleted/`).

### Tests and verification

* Backend contract tests `tests/routes/test_b2b_ui_contract.py` (written
  before the UI; real handlers, processor, file manager and BackupService on
  temp directories): multipart import writes `custom_<id>` and the sidecar,
  NSFW level for regular and custom images plus its validation codes (and
  that a rejected call leaves the sidecar untouched), delete of an imported
  image (file + entry gone, regular images kept, 404 for unknown ids and
  regular images), listing and "no folder = []", missing path = 400; the
  example-images path validation (missing, file, non-dedicated folder,
  dedicated folder, clear; nothing created); **partial settings writes**
  (keys before an invalid one are saved, validated-first saves nothing),
  concurrency normalised to int, proxy refresh once per request and
  `__DELETE__`, no side effects for unchanged values, API keys hidden in GET
  (proxy password documented as returned), secrets not in the logs; backup
  export leaves no file and never prunes, status ordering, restore overwrites
  exactly the targets and refuses not-a-zip / no manifest / wrong version /
  path traversal / checksum mismatch / empty upload without touching
  anything; doctor rename of duplicates (model, sidecar, preview; first copy
  kept), no-op with full syntax, cache repair only rebuilds, diagnostics
  shape without a key makes no network call; the routes exist.
* Frontend `tests/b2b.test.ts` (written before the UI): schema coverage,
  sanitizing, dirty tracking, dotted merges, number/list normalisation, all
  validators, secret modes, ordering, side-effect confirms, resets, the save
  flow (ordered POST, secrets never in a URL, error -> re-read + edits kept,
  invalid drafts never sent, cancel sends nothing); example-image matching,
  request bodies, status normalisation and the import / delete / NSFW /
  download / download-all flows; chart transforms; doctor, backup (typed
  restore gating, export download, JSON error) and archive flows.
  `tests/composables.test.ts` now checks the curated keys through the new
  model.
* Checked in a browser against a mock harness (stats and environment from
  the real backend through read-only GETs, everything else mocked):
  statistics (Light/Dark, desktop/phone), diagnostics with the rename
  confirm, settings sections, validation, secret entry and save, backups
  with the restore dialog, example images in the drawer and the dialog
  (delete with confirm), download-all progress (Dark, phone).
* Live on the real backend (see the phase B2b report): one harmless setting
  (`sticky_controls`, classic-only) toggled and reset through the UI with
  the settings file backed up first: afterwards byte-identical; one backup
  export (download only): the backup folder kept the same files; the
  diagnostics ran (all checks healthy). Nothing else was changed live.

* Settings UX pass: `tests/settingsTabs.test.ts` (tab model from the schema,
  URL and legacy hash resolution, search across tabs and counts, per-tab
  change counts, reset visibility, reset plan and apply, value formatting,
  roving keyboard) and `tests/contrast.test.ts` (helper + every built-in
  theme) were written first. Checked in a browser against the mock harness
  (settings GET read-only from the real backend, saves mocked, a mock
  "Sunset" user theme without field tokens): every tab in Light, Dark and
  Midnight at desktop width, phone width (tab strip, single-column rows,
  save bar, secret entry with show/hide, search and its empty state), search
  results and the jump with highlight, the changed state with the save bar
  and the side-effect confirm, Reset buttons, the reset-tab confirm, the
  load-error banner with Retry, Sunset, and the shared inputs on the
  library toolbar, Downloads page and download dialog.

## Updates (phase 1)

`/updates` (`pages/UpdatesPage.vue`, rows in `components/UpdateRow.vue`,
state in `composables/useUpdates.ts`, pure helpers in `utils/updates.ts`,
strings in `i18n/updatesMessages.ts`) lists the model lines that have a
**real** newer version on Civitai, one row per (Civitai model, base model) of
the files you own - not one flag per card as in the classic UI.

### Endpoint (fork-only, read-only)

`GET /api/lm/{loras,checkpoints,embeddings}/updates/overview`, registered next
to the other `updates/*` routes in `py/routes/model_route_registrar.py`
(handler `ModelUpdateHandler.get_updates_overview`, logic in the pure module
`py/services/update_classifier.py`). It reads the persisted update records in
bulk (`get_records_bulk`, SQLite SELECTs only), the scanner cache and the
download history (`get_downloaded_version_ids_bulk`). It never calls Civitai,
never writes and never changes the behaviour of the existing endpoints; stale
or missing records are reported, not refreshed. Answer:

```
{ success, modelType,
  settings: { hideEarlyAccessUpdates, hidePaidUpdates },
  totals: { likely, possible, hidden, groups, upToDate },     // lines
  models: { local, tracked, checked, untracked, neverChecked },
  unchecked,                       // untracked + neverChecked: never "up to date"
  oldestCheckedAt, newestCheckedAt, // ISO
  groups: [{ key, modelId, modelName, baseModel, tier: likely|possible|hidden,
             isIgnored, lastCheckedAt, ownedVersionIds, newestOwned{versionId,name,releasedAt,sizeBytes},
             previewNsfwLevel,
             localCards: [{ filePath, fileName, folder, baseModel, versionId, versionName,
                            releasedAt, sizeBytes, previewUrl, previewNsfwLevel }],
             candidates: [{ versionId, name, baseModel, releasedAt, sizeBytes, fileCount,
                            usageControl, isEarlyAccess, earlyAccessEndsAt, isPaid, previewUrl,
                            hasBeenDownloaded, isIgnored,
                            confidence: likely|possible|variant, reason, hiddenBecause: [] }] }] }
```

### Classification

Ownership is read **at request time** from the scanner (every local file
with a Civitai model + version id), not from the persisted `is_in_library`
flag, which is only refreshed on refresh / download / delete and was stale
for 19 items in the audited library (a checkpoint whose v2.0 is on disk was
still offered v2.0). A candidate is a remote version of the same model that
you do not own, on the **same base model** as the line (case-insensitive),
and released **after** the newest owned version of that line by release date
(the version id only breaks ties; ten versions in the audited database had a
lower id but a newer date). Each candidate then gets:

| Confidence | Reason code | When |
| --- | --- | --- |
| likely | `next_version_same_base` | nothing below applies |
| variant | `looks_like_format_variant` | same name and number as an owned version except for format / precision / flavour words (remap(ped), int8, nvfp4, fp8, fp16, bf16, gguf / q4_k_m, convrot, lora / extracted, plus / bonus, high / low (noise), alt / special / default / cute / matte, ...), or released within 24 h of an owned version with such a word added; also a format sibling (fp8 / gguf) of another candidate of the same release |
| variant | `same_release_variant` | released within 24 h of an owned version at a size within 3 %, without a higher version number |
| possible | `sibling_variant` | another flavour of a newer release (e.g. low noise when you own high noise) |
| possible | `same_day_as_owned` | released within 24 h of your version, other size |
| possible | `parallel_line` | the name's words neither contain nor are contained in your version's (style A vs style B) |
| possible | `lower_version_number` / `same_version_number` | released later but numbered lower / the same |
| possible | `variant_tokens` | newer, but the name carries format words your file does not have |
| possible | `unknown_release_date` | no dates: newer only by id |
| possible | `unknown_base` | your file has no base model |
| possible | `other_base` | newer, on a base model you do not own for this model (shown once per model, always hidden) |

Version names are parsed by `name_signature` (version number, variant words,
the remaining words; base-model words and parameter counts like "2.9B" are
ignored). Independent of the confidence, `hiddenBecause` lists the gates:
`ignored` (version or model), `not_downloadable` (`usage_control` other than
Download), `no_files` (`file_count == 0`), `early_access` / `paid` (only when
the existing settings `hide_early_access_updates` / `hide_paid_updates` are
on; the badge shows either way), `already_downloaded` (in the download history
but not on disk) and `other_base`. A line's `tier` is the best visible
candidate (likely > possible), else `hidden`.

**Why variants are hidden**: in the audited library most "updates" of the
classic flag were other files of a release the user already had (fp8 / gguf /
remapped uploads of the same checkpoint, the low-noise half of a Wan pair,
extracted LoRAs). They are still listed under **All** with the reason.

Dry run against a read-only copy of the real databases (no endpoint called):
LoRAs 3 likely / 11 possible / 56 hidden lines (915 up to date, 304 models
not checked yet); checkpoints 1 / 3 / 4 (84 up to date, 33 not checked);
embeddings: all 47 never checked.

### Page

* **Header**: "Checked 12 days ago" (the oldest check of the type; "Never
  checked" when nothing was), the note that results are not refreshed
  automatically, **Check now** and the shell Refresh button.
* **Type switch** LoRAs / Checkpoints / Embeddings (every type with
  `supportsUpdates`), remembered in `localStorage` (`lm-ui.updates.type`).
  **Filter** Likely (default) / Possible / All with counts; Likely and Possible
  are disjoint, All shows every line with its hiding reason. A footer "N
  hidden - Show all" switches to All.
* **Notices**: "N models not checked yet" whenever `unchecked > 0` (they are
  never shown as up to date); offline (`useOnline`); rate limit after Check
  now. An empty type that was never checked says "Not checked yet", not "No
  updates found".
* **Row**: the new version's thumbnail (Civitai preview, else the local one;
  blurred like the library when the local preview is mature and
  `blur_mature_content` is on), model name, base-model badge, a text
  confidence badge, Early access / Paid / Ignored badges, "Your version" and
  "New version" with release dates and `formatBytes` sizes, the reason
  sentence (`reasonText`: "Newer version on the same base model
  (Illustrious), released 3 days after yours."), the hiding reason in All,
  where the update is saved, and "+N more newer versions under All".
* **Update** queues the shown version with `GET downloads/queue/add` into the
  **same root and folder as the current file**: `deriveDestination` picks the
  longest root from `GET /{prefix}/roots` that contains the file (Windows
  paths case-insensitively, backslashes normalised, a sibling folder sharing a
  prefix never matches) and sends `model_root`, `relative_path`,
  `use_default_paths=false`. When no root matches it sends no destination
  (default root + path template) and the row says so. `duplicate` /
  `already_queued` is a toast, errors are an error toast. The row follows the
  shared download queue (polled every 2 s while the page is open): Queued /
  Downloading N% / Paused disable Update; when a version queued from this page
  leaves the queue its state is read from the history (`In library`, or
  `Download failed` with the error, which allows a retry) and a completed one
  reloads the overview. **Open on Civitai** (new tab, `civitaiModelUrl` with
  the version) and **Open in library** (`/<type>?open=<file_path>`) are icon
  links whose names include the model name.
* **Check now** = `POST /api/lm/{prefix}/updates/refresh {force: false}` for
  the active type, only after a confirm that says it contacts Civitai, may take
  minutes and downloads nothing. While it runs the button is disabled with a
  turning icon (`motion-reduce:animate-none`); a 429 shows the rate-limit
  notice and rests the button for 60 s; 503 / network errors show the
  connection notice; other errors are an error toast. Afterwards the overview
  is re-read. Without `force` the backend only re-checks records older than
  its 24 h TTL.
* **Refresh** (`r` / the header button) re-reads the overview only: no scan
  and no Civitai request.
* **Top bar**: an Updates link left of Downloads with a badge of likely
  updates over all types. The counts are fetched once, 1.5 s after the shell
  mounted, from the same read-only endpoint (one GET per type, sequentially,
  failures silent so an older backend without the endpoint shows no badge);
  the page updates its type's count after each load. No polling.
* **States and a11y**: skeleton rows while loading, `StateBlock` error with
  Retry (a 404 says the backend needs a restart), empty state with Check now;
  `h1` + an `h2` per list + `h3` per row, a native `ul`, text labels on
  badges, `aria-pressed` segmented buttons, a polite live region for queue and
  check results, 44px controls and a stacked row on phones.

Tests: `tests/services/test_update_classifier.py` (52 fixture cases: name
parsing, every reason, read-time ownership vs a stale flag, cards of one
line, base lines, other base, unchecked counts, gates, payload shape),
`tests/routes/test_updates_overview_route.py` (route table, per-prefix
routing, bulk reads only - the fakes fail on any other call, no metadata
provider, history failure tolerated) and `ui/tests/updates.test.ts` (API
client, helpers including destinations, every backend code has a message,
the row, the page against a mocked backend: tiers, type switch, Update with
the right params and fallback, duplicates and errors, queue states and
completion, Check now confirm / cancel / 429 / 503 / error, refresh
registry, empty / never-checked / error states, the top-bar badge).
Checked in a browser against a local mock backend (never the live one) at
1440, 1100 and 375 px in Dark, Midnight and Light.

### Phase 2 (not built yet)

Bulk select and "update all", ignore version / model from the page, changelog
and file-format choice per row, the same counts on the library toolbar's
update filter, the drawer Versions tab using the classification, and an
optional background re-check.

## Roadmap: still in the classic UI

Everything of the classic settings modal, statistics page, doctor and
example-image showcase is now in the new UI, except:

* **Settings**: sidecar storage mode / path and the sidecar migration,
  download root rules (ordered per-type rules), the standalone-mode model
  paths editor (`folder_paths`), the base-model checkbox picker (the new UI
  takes the skip list as text), the "Apply to library now" button next to
  the filename templates (use the library's Tools > Filename template), the
  directory browser next to path fields (type the path).
* **App updates and banners**: installing LoRA Manager updates, switching
  release/nightly, update notifications, the promo / bulk-fetch / cache-health
  banners. (Model updates have their own page, see "Updates (phase 1)"; its
  phase 2 items are listed there.)
* **Example images**: the folder cleanup (`cleanup-example-image-folders`),
  the automatic periodic check of the classic page (the server-side download
  after each model download still works), live WebSocket progress (the new UI
  polls), the card hover cycler and "open example folder" from cards.
* **Metadata archive**: download progress (WebSocket only).
* **Model management** (from earlier phases): bulk set base model / favorite
  / content rating (no bulk endpoint), deleting a folder that exists in
  several roots, WebSocket progress of fetch-all.
* **Recipes**: re-import from the source, global and relaxed re-match,
  sharing / downloading a recipe, directory batch import (server folder
  browser), creating a recipe from an example image or the ComfyUI widget,
  editing prompts/generation parameters, "send to workflow" with a strength
  override per LoRA.
* **Everything else**: WebSocket progress in general (the new UI polls),
  "send to workflow" for checkpoints and embeddings, wildcards / workflows /
  "other models" library pages, translations other than English.

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
