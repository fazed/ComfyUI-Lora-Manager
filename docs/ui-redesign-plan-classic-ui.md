# LoRA Manager classic web UI redesign: implementation plan

Target: mock-up D (`docs/ui-mockups/src/`: `d-template.html`, `extras.js|css`, `detail.js|css`) plus every finding and idea in `docs/ui-mockups/src/ux-review.md`. Scope: the classic UI (`templates/` + `static/`), vanilla JS, no backend route changes before Phase 9. The mock-up is a visual and interaction spec, not code to copy: it re-renders with `innerHTML`, uses fake data and a font CDN.

Paths were verified against the repo on branch `claude/lora-manager-ui-redesign-042020`. Files marked NEW do not exist yet. Everything else exists.

## 0. Ground rules for every phase

1. **JS contract = element ids and `data-action` attributes.** Managers find their DOM by id (`#searchInput`, `#filterButton`, `#filterPanel`, `#searchOptionsPanel`, `#activeFiltersCount`, `#folderSidebar`, `#sidebarFolderTree`, `#sidebarBreadcrumbNav`, `#modelGrid`, `#recipeGrid`, `#modelModal`, `#bulkOperationsBtn`, `#favoriteFilterBtn`, `#updateFilterBtn`, `#findDuplicatesBtn`, `#doctorTriggerBtn`, `#helpToggleBtn`, `#updateToggleBtn`, `#supportToggleBtn`, `[data-action=...]`). Move and restyle elements freely, but keep ids and `data-action` values unless the task says otherwise.
2. **No backend changes in Phases 0-8** except adding keys to `DEFAULT_SETTINGS` (`py/services/settings_manager.py`) and the mirror `DEFAULT_SETTINGS_BASE` (`static/js/state/index.js`). `POST /api/lm/settings` accepts any key and `GET` syncs every key not in `_NO_SYNC_KEYS`, so no handler change is needed. `settings.json.example` stays untouched.
3. **i18n**: new strings go in `locales/en.json` (2-space indent, edit in place), then run `python scripts/sync_translation_keys.py`. Stop at the `[TODO: Translate]` placeholders. When an existing English value changes, set the other nine locales to `[TODO: Translate] <new English>` by line edit. Never `json.load`/`json.dumps` a locale file. Check `git diff --stat locales/` after every edit. Read `docs/i18n-translation-guidelines.md` section 3 (hot-spots) before wording anything that touches "Recipe", "Checkpoint", tag logic any/all, or the folder sidebar feature.
4. **Virtual scrolling stays.** `static/js/utils/VirtualScroller.js` and `MasonryScroller.js` own the grid. Selection, favourite, focus and inspector updates change the affected card elements in place (`bulkManager.applySelectionState()`, `state.virtualScroller.updateSingleItem()`), never rebuild the grid.
5. **Both modes**: every URL in templates uses `{{ rel_prefix }}`; static files are served from `/loras_static` in plugin mode (`py/lora_manager.py`) and standalone (`standalone.py`). CSS references assets with relative `url()`. No request leaves the machine (no CDN, no font service).
6. **New CSS is written in rem** and uses tokens only. Legacy px values are converted only in files a phase rewrites.
7. **Checks after every phase**: `npm run test:js`, `pytest tests/i18n`, `pytest tests/services tests/routes tests/standalone -q`, `git diff --stat` (changed lines must match the intent). Look and feel is judged by the user in their own browser (AGENTS.md "UI Verification"); the executor does not start servers to argue aesthetics.
8. Commit style: `feat(ui): ...`, `fix(ui): ...`, `test(ui): ...`, `docs(ui): ...` as in recent history.

## 1. Current front end in one page

- **Shell**: `templates/base.html` renders `components/header.html` (logo, page nav, search box, filter button, theme/settings/help/notifications/support toggles, hamburger, theme popover, search-options panel, filter panel), then `.page-content` (the only scroll container, see `getScrollContainer()` in `static/js/utils/infiniteScroll.js`) with `.container` holding the page block.
- **Seven list pages share one skeleton**: `loras`, `checkpoints`, `embeddings`, `other`, `workflows`, `wildcards` (grid `#modelGrid`) and `recipes` (grid `#recipeGrid`) all include `components/controls.html`, `breadcrumb.html`, `duplicates_banner.html`, `folder_sidebar.html`. `statistics.html` is a separate dashboard (Chart.js from `static/vendor/chart.js`).
- **Shared JS**: `core.js` (AppCore), `state/index.js`, `components/controls/PageControls.js` (+ thin per-page subclasses), `SidebarManager.js`, `FilterManager.js`, `FilterPresetManager.js`, `SearchManager.js`, `BulkManager.js` (selection, shift range, marquee, bulk actions), `components/shared/ModelCard.js`, `ModelModal.js` (+ `ModelMetadata`, `ModelTags`, `TriggerWords`, `ModelVersionsTab`, `RecipeTab`, `showcase/`), `ContextMenu/*`, `ModalManager.js`, `utils/uiHelpers.js` (toasts, theme, send/copy).
- **Page-specific**: `RecipeCard.js`, `RecipeModal.js`, `ImportManager`, `BatchImportManager`, masonry layout (recipes); `WildcardSection.js`, `wildcardActions.js`, `static/css/wildcards.css` (wildcards); `workflowActions.js` (workflows); disabled-state panels in `other.html`, `workflows.html`, `wildcards.html`; `statistics.js`.
- **CSS**: `static/css/style.css` imports `base.css`, `layout.css` and 45 component files. Colour usage is almost entirely through aliases declared in `base.css` on top of `tokens/colors.css`: `--lora-accent` (555 uses), `--text-color` (444), `--border-color` (235), `--lora-border` (140), `--lora-surface` (136), `--bg-color` (110), `--lora-error` (99), `--text-on-accent` (91), `--card-bg` (75); 159 uses build tints from the accent channels (`oklch(var(--lora-accent-l) var(--lora-accent-c) var(--lora-accent-h) / a)`). Hard-coded colour literals outside tokens: about 600, most in `lora-modal.css` (68), `settings-modal.css` (57), `header.css` (50), `card.css` (46), `duplicates.css` (33).
- **Appearance today**: theme mode and five colour presets live in localStorage (`lora_manager_theme`, `lora_manager_theme_preset`), applied pre-paint by the inline script in `base.html` and by `initTheme()`.
- **Guard tests**: `tests/frontend/regression/themeTokenScope.test.js` (palette tokens must be declared on `:root`), `contextMenuTokens.test.js` (every custom property used by `menu.css` resolves), `modalRegistry.test.js` (every `.modal` in templates is registered in `ModalManager`).
- A second, Vue based UI lives in `ui/` and is served at `/lm-ui/`. It is out of scope (decision D4).

**Migration strategy (lowest risk)**: change token VALUES first so all 48 CSS files turn monochrome without selector edits (Phase 1), then move structure page-shell first (Phase 2), then components one at a time (Phases 3-5). The accent stays a set of three channel variables, so the 159 channel-based tints keep working and the user's highlight colour is injected by converting hex to OKLCH in JS.

## 2. Mock-up to production mapping

| Mock-up (file: function/area) | Production module |
| --- | --- |
| `d-template.html`: `:root` tokens, `extras.css`: light theme | `static/css/tokens/colors.css`, `base.css` aliases |
| `d-template.html`: `setHi`, `setScale`; `extras.js`: `applyTheme` | NEW `static/js/utils/appearance.js`, inline script in `templates/base.html`, `uiHelpers.js` `initTheme` |
| `extras.js`: `buildRail`, `.iconrail`, `#pop` | NEW `templates/components/rail.html`, `static/js/components/Header.js`, NEW `static/css/components/rail.css` |
| `extras.js`: `tree`, folder header buttons, `folderItems` | `templates/components/folder_sidebar.html`, `SidebarManager.js`, `sidebar.css` |
| `extras.js`: `crumbs` | `templates/components/breadcrumb.html`, `SidebarManager.updateBreadcrumbs` / `getSiblingFolders` |
| `extras.js`: `alpha` | `templates/components/alphabet_bar.html`, `components/alphabet/AlphabetBar.js` |
| `d-template.html`: `.tb`, `.bar`; `extras.js`: toolbar, `scan` | `templates/components/controls.html`, `header.html` (search part), `PageControls.js`, `SortDropdown.js`, `ModelTypeDropdown.js`, `ScanScopeMenu.js` |
| `d-template.html`: `#fly`, `filters`; `extras.js`: presets, `taglogic`, licence cycle | `#filterPanel` in `header.html`, `FilterManager.js`, `FilterPresetManager.js`, `search-filter.css` |
| `extras.js`: `soBuild` (search in) | `#searchOptionsPanel` in `header.html`, `SearchManager.js` |
| `d-template.html`: `#view`, `view()` | NEW `templates/components/view_popover.html`, NEW `static/js/components/ViewOptions.js`, `VirtualScroller.calculateLayout` |
| `extras.js`: `item`, `gridHtml`, `.qa` hover actions | `components/shared/ModelCard.js`, `RecipeCard.js`, `card.css` |
| `d-template.html`: `.insp` | NEW `templates/components/inspector.html`, NEW `static/js/components/Inspector.js`, NEW `static/css/components/inspector.css` |
| `extras.js`: `setBulk`, `bulkBar`, `bulkItems` | `BulkManager.js`, `ContextMenu/BulkContextMenu.js`, NEW `templates/components/bulk_bar.html`, `bulk.css` |
| `extras.js`: `showMenu`, `cardItems`, `globalItems` | `ContextMenu/BaseContextMenu.js` and subclasses, `templates/components/context_menu.html`, `menu.css` |
| `detail.js`: `renderDetail`, `bindPane`, `stepDetail` | `components/shared/ModelModal.js` (`showModelModal`, `setupTabSwitching` in `ModelDescription.js`, `handleDirectionalNavigation`), `lora-modal/*.css` |
| `extras.js`: `modal`, `openSettings`, `openHelp`, `openDoctor`, `openNotif`, `openSupport`, `openDownload`, `openMove`, `confirmDelete`, `openRating`, `bulkTags`, `bulkBase`, `openOrganize`, `openLink`, `openImport` | `ModalManager.js`, `templates/components/modals/*.html`, `SettingsManager.js`, `HelpManager.js`, `DoctorManager.js`, `UpdateService.js`, `DownloadManager.js`, `MoveManager.js`, `utils/modalUtils.js`, `NsfwLevelSelector.js`, `BulkManager.js`, `AutoOrganizePreviewModal.js`, `ImportManager.js`, `css/components/modal/*.css` |
| `extras.js`: `toast` | `uiHelpers.js` `showToast` / `showActionToast`, `utils/undoHelpers.js`, `toast.css` |
| `extras.js`: `startProgress`, `.prog` | `templates/components/progress_panel.html`, `LoadingManager.js`, `ExampleImagesManager.js`, `progress-panel.css` |
| `extras.js`: `banners` | `BannerService.js`, `duplicates_banner.html`, `banner.css` |
| `extras.js`: `statsHtml` | `templates/statistics.html`, `statistics.js`, `statistics.css` |
| `extras.js`: keyboard block | `components/controls/ActionShortcuts.js`, `utils/EventManager.js`, `BulkManager.handleGlobalKeyboard`, `infiniteScroll.js` `setupKeyboardNavigation` |
| `.sb` status bar | NEW `templates/components/status_bar.html` fed by existing scan/WebSocket progress events |

## 3. UX review traceability (every finding has an owner phase)

| # | Finding (ux-review.md) | Phase | Acceptance |
| --- | --- | --- | --- |
| W1 | Folder selection and "include subfolders" not applied | 2 | Selecting a folder and toggling recursive each trigger one list request with `folder` / `recursive` params (existing `pageControls` tests stay green) |
| W2 | Licence include/exclude not applied, excluded missing from count and chips | 2 (count), 6a (chips) | Filter badge counts included + excluded licence options; each has a chip in the strip |
| W3 | "Creator" search option not applied | 2 | Ticking Creator sends `search_options.creator=true` (new assertion in a `SearchManager` test) |
| W4 | Detail header Delete / Send have no handlers; `Del` not implemented | 4 (buttons), 6b (`Del`) | Buttons carry the existing `data-action="delete-model"` / `send-to-workflow`; `Del` on a focused card opens the delete confirm |
| W5 | "View is filtered" indicator never built | 6a | Strip is visible whenever any scope is active |
| C1 | "Group by model" means two things | 3, 5 | View popover says "Group by"; the `group_by_model` setting label reads "Collapse versions into one card" |
| C2 | Send named four ways | 3, 4, 6c | One key `common.actions.sendToComfyUI` used by card, inspector, flyout, bulk bar, menus, toast |
| C3 | Copy icon copies different things | 3 | Copy icon always copies syntax (path for checkpoints); trigger words are copied by clicking the word chip |
| C4 | Strength hard-coded to 0.8 | 6c | Send/copy read `getLoraStrengthsFromUsageTips`; the value is shown on the button |
| C5 | Uneven delete safety (folder delete: no confirm, fake undo) | 2 | Folder delete always goes through the existing delete-folder modal; the toast shows Undo only when the restore path (`_restoreDeletedFolder`) applies |
| C6 | Two selection models | 6b | One selection set; Ctrl/Shift+click select without bulk mode; Esc clears selection only after closing overlays |
| C7 | Danger red hard-coded, low contrast on light | 0 (token), 1 (sweep) | `--danger` token, >= 4.5:1 on both themes (unit test), no red literal left in `static/css` |
| L1 | Up to five strips above the grid | 2 | At most three rows: toolbar, context row (breadcrumb + alphabet toggle), active-view strip; banners overlay the grid top |
| L2 | Action bar mixes actions, filters, a mode and a tool | 2, 6a | Toolbar groups: view state, actions, mode, tool; Favorites/Updates/Duplicates move into Filters in 6a |
| L3 | Scope spread over six places, no global Clear | 6a | "Clear all" in the strip resets folder, search, letter, type, favourites, updates, filters |
| L4 | Card settings owned twice | 3, 5 | View popover is the only owner; duplicated rows removed from Settings > Interface |
| A1 | Every card is a tab stop, no arrows, Space dead | 6b | One tab stop for the grid; arrows move; Space selects |
| A2 | Option divs without role/state; licence tri-state hidden | 2, 6e | Options are `button[role=checkbox]` with `aria-checked`; licence rows have explicit Include / Exclude buttons |
| A3 | Context menus: no focus, arrows, Shift+F10; submenu hover-only; long menu clips | 6e | Keyboard test on `BaseContextMenu`; menu gets `max-height` + scroll |
| A4 | No focus trap / initial focus / return; no `aria-modal` on details | 4, 6e | `ModalManager` traps Tab, restores focus; `#modelModal` has `role=dialog aria-modal=true` |
| A5 | Icon buttons rely on `title`; clickable non-focusable elements | 2-4, 6e | Every icon-only control is a `<button>` with `aria-label`; template scan test |
| A6 | Muted text and disabled contrast too low | 0 | Token contrast test: tertiary text >= 4.5:1 on panel and hover surfaces, disabled >= 3:1, no opacity-based disabled text |
| A7 | Custom highlight has no clamp, also drives focus ring | 0 | `appearance.js` clamps; `--focus-ring` falls back to the text colour below 3:1 |
| A8 | Reduced motion only on the flyout | 3, 6e | Global rule in `base.css` stays; preview cycling and autoplay stop under `prefers-reduced-motion` |
| A9 | Undo toast: 5 s, no pause, no keyboard route | 6e | Timer pauses on hover/focus; Undo is a focusable button; shortcut documented in Help |
| R1 | Narrow widths hide nav and leave dead toggles | 2 (no dead ends), 7e (full layout) | At 600px wide every page is reachable and each visible toggle does something |
| R2 | Whole grid re-rendered per click | 3, 6b | Test: selecting a card leaves the other rendered card elements identical (same node references) |
| R3 | Font from CDN | 0 | No external URL in templates or CSS (grep test) |
| R4 | List layout has no headers, sort or actions | 3 | List layout has a header row with click-to-sort and per-row send/copy |

Ideas: #1 -> 6a, #2 -> 6b, #3 -> 6c, #4 -> 6d, accessibility pass -> 6e, #5 -> 6f, #6 -> 7a, #8 -> 7b,
#10 -> 7c (+9c), #12 -> 7d, #13 -> 7e, #14 -> 7f (+9d), #7 -> 8a, #9 -> 8b (+9e), #11 -> 9a, #15 -> 9b.

---

## Phase 0: foundations (tokens, font, appearance settings)

**Goal**: add the plumbing with no layout change. After this phase the app looks the same except for the Geist font, the text-size control and the new highlight control (which has no visible effect until Phase 1).

**Mock-up source**: `d-template.html` `:root`, `setHi`, `setScale`, `SCALES`, `PRESETS`; `extras.js` `applyTheme`; `extras.css` light theme block.

**Files**
- `static/css/tokens/colors.css`: add new neutral tokens `--surface-rail`, `--text-tertiary`, `--text-disabled`, `--danger`, `--danger-bg`, `--danger-border`, `--focus-ring`, and the highlight inputs `--lm-hi-l`, `--lm-hi-c`, `--lm-hi-h`, `--lm-on-hi` (defaults: white on dark, near-black on light). All on `:root` / `:root[data-theme="dark"]` (the scope test requires it).
- `static/css/tokens/typography.css`: `--font-body`, `--font-display` start with `Geist`, `--font-mono` with `Geist Mono`, each followed by the current system stack. Add `--ui-scale: 1.15`.
- `static/css/base.css`: `@font-face` for Geist and Geist Mono (variable woff2, `font-display: swap`, relative `url(../vendor/geist/...)`); `html { font-size: calc(13px * var(--ui-scale)); }`.
- NEW `static/vendor/geist/` with `Geist[wght].woff2`, `GeistMono[wght].woff2`, `OFL.txt` (see D1; until the files are present the stack falls back to system fonts, so the phase is not blocked).
- NEW `static/js/utils/appearance.js`: pure functions `hexToOklch(hex)`, `contrastRatio(a, b)`, `clampHighlight(hex, theme)` (returns a colour with >= 3:1 against `--bg-base` and picks `--lm-on-hi` as black or white by luminance; white maps to near-black on the light theme as in `setHi`), `applyHighlight`, `applyTextScale`, `applyAppearance(settings)`. Writes the channel variables on `<html>` and mirrors the computed values to localStorage (`appearance_cache` via `storageHelpers.js`) for the pre-paint script.
- `templates/base.html`: extend the existing inline theme script to also apply `appearance_cache` (scale + highlight variables) before first paint. Add a `<link rel="preload" as="font">` for Geist with `rel_prefix`. Remove the `preconnect` to civitai.com only if nothing depends on it (leave it otherwise).
- `py/services/settings_manager.py` `DEFAULT_SETTINGS` and `static/js/state/index.js` `DEFAULT_SETTINGS_BASE`: `ui_theme: "auto"`, `ui_highlight_color: "#ffffff"`, `ui_text_scale: "m"`.
- `static/js/utils/uiHelpers.js` (`initTheme`, `toggleTheme`), `static/js/components/Header.js` (theme popover handlers), `static/js/managers/SettingsManager.js` (`applyFrontendSettings` calls `applyAppearance`).
- `templates/components/header.html` (`#themePopover`): add a "Text size" segmented control (S/M/L/XL = 1, 1.15, 1.3, 1.5) and a "Highlight colour" section (eight swatches from `PRESETS`, custom `<input type="color">`, Reset). Preset theme buttons stay until Phase 1.
- `locales/en.json`: `header.theme.textSize`, `textSizeHint`, `highlight`, `highlightHint`, `highlightCustom`, `reset`, swatch names. Run the sync script.
- Tests: NEW `tests/frontend/utils/appearance.test.js` (conversion, clamp, on-colour choice, white on light), NEW `tests/frontend/regression/tokenContrast.test.js` (parses `colors.css`, asserts A6 and C7 ratios), NEW `tests/frontend/regression/noExternalAssets.test.js` (no `http(s)://` font or script URL in `templates/` and `static/css/`; allow the existing civitai preconnect if kept). Update `tests/frontend/state/index.test.js` and `tests/frontend/utils/uiHelpers.dom.test.js` if they assert the default settings shape or theme behaviour.

**Steps**
1. Add tokens and font faces. 2. Write `appearance.js` with tests first. 3. Add settings defaults (Python and JS). 4. Theme mode: on init, if `ui_theme` in backend settings equals the default and localStorage `theme` holds a value, save that value to `ui_theme` once; afterwards backend is the source of truth and localStorage `theme` is only the pre-paint cache. 5. Add the popover controls and save through `settingsManager.saveSetting`. 6. i18n keys + sync.

**Must not change**: accent colour, any layout, `web/comfyui/` widget theming (`lm_theme.css` and its `loramanager.comfy_theme_accent` setting are a separate system).

**Risks**: (a) changing the root font size from 16px to about 15px (M) shrinks rem/em text slightly and leaves px-sized boxes unchanged; accepted, call it out to the user. (b) First paint in a new browser uses defaults until settings load; acceptable. (c) `themeTokenScope` test fails if a token is declared outside `:root`.

**Acceptance**: checks in rule 7; user confirms text size S to XL scales text on LoRAs, Recipes, Settings modal; choice survives reload and a second browser (backend persisted); standalone (`python standalone.py`) shows the same.

**Commits**: `feat(ui): add appearance settings, text scale and bundled Geist font`, `test(ui): cover highlight contrast clamp and token contrast`.

## Phase 1: monochrome re-skin through token values

**Goal**: the whole existing UI becomes black/grey/white with one highlight colour, with no layout or selector restructuring.

**Mock-up source**: `d-template.html` `:root`; `extras.css` `:root[data-theme=light]`.

**Files**: `static/css/tokens/colors.css`, `tokens/effects.css`, `base.css`, component CSS files only for literal replacement, `templates/components/header.html` (remove preset buttons), `Header.js`, `uiHelpers.js` (delete `cyclePreset`, `setPreset`, preset handling in `initTheme`), `templates/base.html` (drop `theme_preset` from the inline script), `static/js/statistics.js` (chart palette), `locales/en.json` (remove `header.theme.presets|default|nord|midnight|monokai|dracula|solarized` in all ten locale files by line edit).

**Steps**
1. Re-map values in `colors.css` (dark / light): `--bg-base` #0b0b0b / #f5f5f5; `--surface-base` #141414 / #ffffff; `--surface-rail` #101010 / #ffffff; `--bg-elevated`, `--surface-elevated` #1b1b1b / #ffffff (opaque now); `--bg-hover`, `--surface-hover`
   #222222 / #ececec; `--border-subtle` #262626 / #e3e3e3; `--border-base` #363636 / #cdcdcd; `--text-primary` #ededed / #111111; `--text-secondary` #a1a1a1 / #555555; `--text-tertiary` chosen to pass the contrast test (about #8c8c8c / #6b6b6b). All chroma 0.
2. Accent: `--color-accent-l|c|h: var(--lm-hi-l|c|h)`; `--color-accent-contrast: var(--lm-on-hi)`; `--color-accent-hover` derived with `color-mix` toward the text colour (the fixed `58%` lightness no longer fits a white accent). `--focus-ring` replaces `--color-accent` in the `:focus-visible` rule.
3. Semantic colours keep their hue but only for meaning: error/danger, warning, success. Update badge, workflow badge and favourite star use the highlight (`--color-info-*`, `--color-workflow-*`, `--favorite-color` map to highlight / on-highlight). `--status-*` blues become neutral.
4. Delete the five `[data-theme-preset=...]` blocks and the preset UI/JS/storage key (D2). Users with a stored preset simply get the default look.
5. Literal sweep, file by file in descending count (list in section 1): replace chromatic literals with tokens; neutral `rgba(0,0,0,a)` scrims and shadows may stay. Replace hard-coded reds with `--danger`.
6. Radius: set `--radius-sm` to 6px as the default control/card radius by re-pointing `--border-radius-base` and `--border-radius-sm` to 6px; larger radii (`md`, `lg`) to 8px / 10px.
7. `statistics.js`: replace the `oklch(68% 0.28 ...)` chart colours with a grey ramp plus the highlight read from computed style.
8. NEW `tests/frontend/regression/monochromeTokens.test.js`, modelled on `comfyWidgetThemeTokens.test.js`: fails on chromatic colour literals in `static/css/**` outside `tokens/colors.css` (allowlist file for justified cases such as flag icons or media overlays).

**Must not change**: selectors, DOM, JS behaviour other than preset removal; `web/comfyui/` CSS.

**Risks**: translucent elevated surfaces became opaque (check sticky modal footers that use `--lora-surface-solid`); white accent on components that assumed a mid-tone accent (text on accent must use `--text-on-accent`; grep for `color: white` / `#fff` next to `--lora-accent` backgrounds during the sweep); `contextMenuTokens` test if a token is renamed (do not rename, only re-value).

**Acceptance**: rule 7 checks plus the new regression test; user walks through all eight pages, Settings, Help, Doctor, Download, model modal, recipe modal, context menus, toasts in dark and light and reports any remaining coloured element; picking a swatch recolours selection, primary buttons and counters only.

**Commits**: `feat(ui): re-map colour tokens to the monochrome palette`, `refactor(ui): replace hard-coded colours with tokens`, `feat(ui): remove theme presets`.

## Phase 2: shell layout (rail, folder panel, toolbar, flyouts)

**Goal**: the page frame of mock-up D on all eight pages; cards, modals and inner components unchanged.

**Mock-up source**: `d-template.html` body grid, `.iconrail`, `.folders`, `.tb`, `.bar`, `#fly`, `.sb`; `extras.js` `buildRail`, search block, toolbar block, filters block, `tree`, `crumbs`, `alpha`.

**Files**
- `templates/base.html`: body becomes a grid `rail | folders | main | inspector` with a status bar row. Add `{% block sidebar %}` (grid column 2) and `{% block toolbar %}` (inside main, above `.page-content`). `.page-content` stays the scroll container.
- NEW `templates/components/rail.html`: page links (same visibility rules and ids `lorasNavItem` ... `statisticsNavItem`, `nav-item--hidden` for other/workflows/wildcards), spacer, bottom buttons keeping the classes/ids `.theme-toggle`, `.settings-toggle`, `#helpToggleBtn`, `#updateToggleBtn` (with `.update-badge`), `#supportToggleBtn`. `#themePopover` moves next to the rail.
- `templates/components/header.html`: reduced to the toolbar top row (search box, search options, filter button, panels). The hamburger and its dropdown stay as the narrow-width fallback (R1).
- `templates/components/controls.html`: regrouped (L2): [folders toggle] [search] [Filters] ... [View] [sort] [quick-view toggle] [Download primary]; second row: type dropdown, Refresh split button, Fetch, Import / Batch import (recipes), Bulk, Duplicates, Favorites, Updates split, Doctor.
- The seven list templates: move `folder_sidebar.html` into `{% block sidebar %}` and controls + breadcrumb + alphabet bar into `{% block toolbar %}`.
- `templates/components/folder_sidebar.html`, `breadcrumb.html`, `alphabet_bar.html` (titles to i18n keys, `div.letter-chip` to `button`), NEW `templates/components/status_bar.html`.
- CSS: `layout.css` (rewrite), `header.css` (shrink), NEW `components/rail.css`, `sidebar.css`, `search-filter.css`, `alphabet-bar.css`, `filter-indicator.css`, NEW `components/status-bar.css`.
- JS: `Header.js` (popover positioning relative to the rail, active nav), `SidebarManager.js`, `uiHelpers.js` `updatePanelPositions` (flyouts anchor to their button), `FilterManager.js`, `SearchManager.js`, `PageControls.js` (only where it queries moved wrappers), `SettingsManager.js` + `templates/components/modals/settings/interface.html` (remove `sticky_controls`).

**Steps**
1. Frame: grid body, rail, status bar. Keep header content working inside the new toolbar row.
2. Folder panel becomes a real grid column with its own scroll. In `SidebarManager.js` delete the fixed-position logic that the grid replaces: `updateContainerMargin`, the pinned / hover-reveal state and `showSidebarHiddenIndicator`. The toolbar "Folders" toggle and the panel's hide button both call `toggleHideOnThisPage()` (storage key `${page}_sidebarDisabled` is kept). Header buttons: create folder, collapse all, view options (existing `#sidebarViewOptionsMenu`), plus a "Find a folder" input that filters the rendered tree client-side.
3. Breadcrumb keeps `updateBreadcrumbs()` and the sibling dropdowns (`getSiblingFolders`); show the result count at the right end. Alphabet bar sits in the same context row, collapsed by default (`${page}_alphabetBarCollapsed`).
4. Filters flyout: restyle `#filterPanel` (presets, base model, tags with Any/All, model type, licence, availability, has-workflow). Build options as `button[role=checkbox]` (A2). Licence rows get explicit Include and Exclude buttons that write the existing `filters.license` map; the badge `#activeFiltersCount` counts excluded entries too (W2).
5. Search: one input with clear button, `Ctrl F` cue, "Search in" flyout (`#searchOptionsPanel`) including "Include subfolders". Add assertions that Creator and recursive reach the request (W1, W3).
6. `sticky_controls` is obsolete (toolbar is always outside the scroll area): remove the checkbox, the `body.sticky-controls` rules and the JS that toggles them; leave the stored key alone.
7. Folder delete (C5): confirm that every delete path opens the existing delete-folder modal and that the success toast offers Undo only when the backend returned a restorable result.
8. Narrow widths (R1, minimum): below 820px the folder panel becomes an overlay drawer opened by the same toggle; below 640px the rail collapses and the existing hamburger dropdown (which already lists all pages) is shown. No toggle may be visible without an effect.
9. Status bar: scan state, shown/total count, selected count. Use data already in page state and the existing progress events; no new requests.

**Must not change**: ids/`data-action` (rule 1), `.page-content` as scroll container, drag-and-drop onto folders, folder context menu, onboarding targets (`OnboardingManager.js` queries header and control elements: update its selectors in the same commit and run through the tour once), statistics page content.

**Risks**: `VirtualScroller` measures `.container` width; it already has a `ResizeObserver`, so panel toggles re-layout, but verify no refetch happens. Marquee selection and back-to-top assume `.page-content`; unchanged. Tests to update: `sidebarManager.visibility.test.js`, `sidebarManager.restoreFolder.test.js`, `components/pageControls.*.test.js`, `core/appCore.test.js`, `pages/*.test.js` and `utils/pageFixtures.js` (they render templates), `utils/uiHelpers.dom.test.js`, `regression/sidebarFolderContextMenu.test.js`.

**Acceptance**: rule 7; user checks all eight pages: navigation, search, filters (incl. licence exclude and presets), folder select / create / rename / delete / drag-drop, breadcrumb sibling menu, alphabet filter, sort, refresh menu with scan scopes, Doctor, notifications badge, both themes, window at 1400 / 1000 / 600px.

**Commits**: `feat(ui): add icon rail and grid shell`, `feat(ui): dock the folder panel and simplify its visibility`, `feat(ui): restyle toolbar, search and filters flyout`, `feat(ui): remove sticky controls setting`.

## Phase 3: cards, View popover, inspector, bulk bar

**Goal**: card look and hover actions of the mock-up, per-page view options, quick-view inspector, bottom bulk bar.

**Mock-up source**: `d-template.html` `.card`, `.card.row`, `#view`, `view()`, `.insp`; `extras.css` card extras, `.bulkbar`; `extras.js` `item`, `gridHtml`, `setBulk`, `bulkBar`, `cardItems`.

**Files**: `components/shared/ModelCard.js`, `RecipeCard.js`, `card.css`, `bulk.css`, `wildcards.css`, `utils/VirtualScroller.js`, `BulkManager.js`, `ContextMenu/BulkContextMenu.js`, `CardPreviewCycler.js`, NEW `components/ViewOptions.js`, NEW `templates/components/view_popover.html`, NEW `components/Inspector.js`, NEW `templates/components/inspector.html`, NEW `css/components/inspector.css`, NEW `templates/components/bulk_bar.html`, `templates/base.html`, `SettingsManager.js`, `templates/components/modals/settings/interface.html`, `locales/en.json`.

**Steps**
1. Card restyle in `card.css` and the markup built by `createModelCard`: image with base-model tag, update badge, hover action row (send, copy, favourite, more), name, meta, version row. Every action is a `<button>` with `aria-label` (A5). Copy means syntax everywhere (C3). Send label uses the single key (C2). Keep every `dataset` field and action class that `handleModelCardEvent_internal` dispatches on; keep wildcard toggle, quantisation / sub-type badges, source globe, preview drop, video handling (all have tests under `tests/frontend/components/modelCard.*`).
2. View options, stored per page in localStorage key `${page}_view` (JSON, through `storageHelpers.js`): `layout` grid|list, `size` 0.7-1.7, `shape` portrait|square, `fit` cover|contain, `show` {name, baseModel, meta, favourite, versionRow}. `VirtualScroller.calculateLayout` reads them: `minCardWidth = 11.5rem * size` in px, `itemAspectRatio` from `shape`, list = one column with a fixed row height. Seed defaults from the existing global settings (`display_density` -> size, `card_info_display`, `show_version_on_card`); then remove those rows from Settings > Interface (L4, D5). `fit` and `show.*` are CSS classes on the grid element. Recipes: the existing grid/masonry choice (`recipes_layout`) is offered as shape "Original" on that page only; the toggle in `controls.html` moves into the popover. "Group by" is not shipped here (needs sort keys and header rows the scroller does not have; see 9f).
3. List layout (R4): same card DOM, row grid in CSS under `[data-layout=list]`; a header row above the scroll area with Name, Base model, Size, Date, Usage that set the existing sort values; rows keep send and copy buttons.
4. Inspector (grid column 4, toggle button in the toolbar, state in `${page}_inspectorOpen`): preview, name, file name, primary "Send to ComfyUI" + copy, key facts, trigger words (click copies), tags, notes preview, "Open details". Data comes from the same card dataset object that `showModelModalFromCard` builds: extract that into an exported helper in `ModelCard.js` and reuse it. Recipes get a recipe variant from the recipe card data.
5. Click model: single click focuses the card and fills the inspector; double-click or Enter opens details (`showModelModal`). If the inspector is closed, single click opens details as today. In bulk mode click toggles selection (unchanged).
6. Bulk bar: fixed at the bottom of main while bulk mode is on; buttons call existing `bulkManager` methods (`sendAllModelsToWorkflow`, `copyAllModelsSyntax`, `showBulkAddTagsModal`, `showBulkBaseModelModal`, `setBulkFavorites`, `showBulkContentRatingSelector`, `refreshAllMetadata`, move via `moveManager`, `autoOrganizeSelectedModels`, `showBulkDeleteModal`, `selectAllVisibleModels`, `clearSelection`); "More" opens the existing `#bulkContextMenu` with page-specific items (wildcard activation, recipe reimport/rematch, filename template).
7. In-place updates (R2): selection and focus changes only toggle classes/attributes on affected cards. Add a test that node references of other rendered cards are unchanged after a selection.
8. Reduced motion (A8): `CardPreviewCycler.js` already checks `prefers-reduced-motion`; apply the same check to hover video autoplay in `configureModelCardVideo`.
9. Rename the `group_by_model` label to "Collapse versions into one card" (C1): change the English value and re-queue the other locales.

**Must not change**: marquee selection, shift-range selection, drag to folder, duplicates mode rendering, blur/NSFW reveal, footer action setting, data windowing.

**Risks**: card height now depends on shape and shown rows; `itemHeight` must be computed from the same numbers the CSS uses (keep the math in one function and unit-test it). Tests to update: `pages/lorasPage.test.js`, `modelCard.*`, `BulkManager.*` (they build card fixtures and query `.model-card`; keep that class), `utils/masonryScroller.test.js`, `settingsManager.rangeControls.test.js`.

**Acceptance**: rule 7 + new tests (`viewOptions.test.js`, `inspector.test.js`, layout math, in-place selection); user checks view options persist per page and across reload, list layout sorting, inspector on all card pages, bulk bar actions on LoRAs/recipes/wildcards, scrolling a large library stays smooth.

**Commits**: `feat(ui): restyle cards and hover actions`, `feat(ui): add per-page View options`, `feat(ui): add list layout`, `feat(ui): add quick-view inspector`, `feat(ui): add bulk action bar`.

## Phase 4: full-details flyout (replaces the model modal presentation)

**Goal**: `#modelModal` renders as the right-hand flyout of `detail.js` with all current behaviours.

**Mock-up source**: `detail.js` `renderDetail`, `bindPane`, `stepDetail`; `detail.css`.

**Files**: `components/shared/ModelModal.js` (markup template inside `showModelModal`, about lines 915-1010), `ModelDescription.js` (`setupTabSwitching`), `ModalManager.js` (registration of `modelModal`), `lora-modal/lora-modal.css`, `description.css`, `tag.css`, `preset-tags.css`, `showcase.css`, `triggerwords.css`, `versions.css`, `shared/edit-metadata.css`, `locales/en.json`.

**Steps**
1. Keep `showModelModal(model, modelType, options)` and the modal id. Rearrange the template into header (name + edit, prev/next with position, close; second row: Send to ComfyUI, source link, creator, licence icons, Delete; third row: tags), left column (info fields, hashes and ids, usage tips, trigger words, notes, about this version, wildcard section) and right column (tab bar + panes `#showcase-tab`, `#description-tab`, `#versions-tab`, `#recipes-tab`). Keep every inner id and class the modules query (`#file-name`, `#preset-selector`, `#preset-value`, `.tab-btn[data-tab]`, `.modal-nav-btn`, `data-action="send-to-workflow|delete-model|nav-prev|nav-next"`, ...): the tests `tests/frontend/components/modelModal.*.test.js`, `modelVersionsTab.*`, `triggerWords.*`, `modelTags.reorder`, `showcase.*`, `WildcardSection` are the contract.
2. Presentation: `#modelModal` gets a flyout modifier class; CSS makes it a right-anchored panel (`min(76rem, 100vw)`), scrim on the left, columns scroll independently, single column under 980px.
3. Tabs only swap the right pane: verify `setupTabSwitching` toggles `.active` without re-rendering and resets only the right pane scroll; fix if it touches the left column.
4. W4: Send and Delete in the header are the existing wired buttons; add a test that both dispatch.
5. A4: `role="dialog" aria-modal="true" aria-labelledby` on the flyout; initial focus on the close button; focus returns to the originating card (ModalManager already stores `restoreFocusTo`).
6. Prev/next (`handleDirectionalNavigation`, arrow keys via `setupNavigationShortcuts`) unchanged; show "n / total" using `state.virtualScroller.getNavigationState`.
7. Deep link `#model=<path>` (`openLinkedLoraModel` in `loras.js` and the equivalents) keeps working.

**Must not change**: inline edit flows (name, file name, version, base model, creator), usage-tip presets, trigger word editing/reorder, notes save on Enter, hash calculation, versions tab downloads, recipes tab, sidecar/file location buttons, media viewer, `RecipeModal.js` (restyle through tokens only).

**Risks**: `lora-modal.css` is 1,900 lines with many state selectors; rewrite section by section and delete rules that no longer match anything. Run the modal tests after each section.

**Acceptance**: rule 7; user opens details on each model page, edits every editable field, switches tabs, steps with arrows, deletes with undo, opens from a ComfyUI deep link.

**Commits**: `feat(ui): present model details as a flyout`, `fix(ui): keep the info column when switching detail tabs`.

## Phase 5: modals, menus, toasts, progress, Appearance, settings clean-up

**Goal**: every remaining surface matches the design; nothing still looks like the old UI.

**Mock-up source**: `extras.css` modal, `.setwrap`, `.cmenu`, `.toast`, `.prog`, `.stats`; `extras.js` `modal`, `openSettings`, `openHelp`, `openDoctor`, `openNotif`, `openSupport`, `openDownload`, `openMove`, `confirmDelete`, `openRating`, `startProgress`, `statsHtml`.

**Files**: `css/components/modal/*.css` (start with `_base.css`), `menu.css`, `toast.css`, `tooltip.css`, `progress-panel.css`, `banner.css`, `duplicates.css`, `statistics.css`, `recipe-modal.css`, `import-modal.css`, `batch-import-modal.css`, `first_run.css`, `initialization.css`, `loading.css`, `media-viewer.css`, `onboarding.css`, `auto-organize-preview.css`, `metadata-refresh-result.css`, `download-batch-summary.css`, `sidecar-migration-summary.css`, `shared.css`; templates under `templates/components/modals/` only where structure must change; `HelpManager.js` + `templates/components/modals/help_modal.html` (shortcut list).

**Steps**
1. `_base.css`: modal box, header, body, footer, backdrop, sizes; buttons and form controls as shared classes in `shared.css`. Most modals then need only small per-file edits.
2. Settings modal: keep the existing nav + search structure; restyle rows and switches. Interface section: remove rows now owned by the View popover (L4) and add a link "Card options are in View".
3. Appearance popover (rail): final styling, hint text, Reset all.
4. Context menus and dropdowns: one visual style in `menu.css` (also sort, type, refresh, updates menus).
5. Toasts (bottom centre, action button), progress panel (bottom left, moves up when the bulk bar is visible), banners, duplicates view, statistics tiles.
6. Token-only restyle (no structural work) for: recipe modal, import / batch import, relink Civitai, link Hugging Face, directory picker, example access, update modal, onboarding tour, first-run and initialization screens, media viewer, wildcard section. Convert px to rem in files that are rewritten.
7. Help modal: update the shortcut table to what exists today (R, D, B, Ctrl F, arrows in details, Esc).

**Must not change**: modal ids (`modalRegistry.test.js`), form field ids used by `SettingsManager.js` (`tests/frontend/managers/settingsManager.*.test.js`), Doctor actions, download flow steps.

**Risks**: `settings-modal.css` (2,100 lines) and `download-modal.css` (1,150): restyle through shared classes first, then delete dead rules. Opaque surfaces under sticky footers.

**Acceptance**: rule 7; user opens every modal listed in section 2 in both themes and at text size XL.

**Commits**: `feat(ui): restyle modal base and shared controls`, `feat(ui): restyle settings and help`, `feat(ui): restyle menus, toasts and progress panel`, `refactor(ui): move card options out of settings`.

---

## Phase 6: ship-first UX (ideas 1-5 and the accessibility pass)

Each sub-phase is its own commit series and can ship alone, in this order.

### 6a. Active-view strip (idea 1; W2, W5, L2, L3)
- Files: NEW `templates/components/active_view_strip.html`, NEW `static/js/components/ActiveViewStrip.js`, `filter-indicator.css`, `controls.html`, `header.html` (`#filterPanel`), `FilterManager.js`, `PageControls.js`, `SearchManager.js`, `SidebarManager.js`, `AlphabetBar.js`.
- One row under the context row, hidden when nothing is active. Chips: folder (+ "no subfolders"), search text, letter, model type, favourites, updates only, duplicates mode, each filter value, excluded licences (struck through), custom filter (replaces `#customFilterIndicator`). Each chip removes its own scope by calling the owning manager; "Clear all" calls them all. Result count at the right.
- Favorites, Updates and Duplicates move from the toolbar into the Filters flyout as a "Show" group. Keep the ids `#favoriteFilterBtn`, `#updateFilterBtn`, `#findDuplicatesBtn` on the new controls so `PageControls` handlers still bind; "Check for updates" stays in the Refresh menu.
- The strip listens to state changes through one custom event dispatched by the managers after they change scope (add the dispatch where each manager already reloads the list).
- Acceptance: NEW `activeViewStrip.test.js` (chip per scope, removal calls the right manager, Clear all); `pageControls.filtering.test.js` updated; user: every way of narrowing the view shows a chip.
- Commit: `feat(ui): add active-view chip strip and move view toggles into Filters`.

### 6b. Keyboard grid and one selection model (idea 2; W4, C6, A1, R2)
- Files: NEW `static/js/utils/gridKeyboard.js`, `BulkManager.js`, `ModelCard.js`, `RecipeCard.js`, `VirtualScroller.js`, `MasonryScroller.js`, `ActionShortcuts.js`, `infiniteScroll.js`, `Inspector.js`, `help_modal.html`.
- Roving tabindex: the grid is one tab stop; the focused index lives in page state and is re-applied when the scroller renders the item (`createItemElement`). Arrows move by column count (`virtualScroller.columnsCount`), scrolling the target into view first. Home/End/PageUp/PageDown reuse the existing handlers.
- Keys on a focused card: Space select, Enter details, S send, C copy syntax, F favourite, Del delete confirm, `/` focus search. Registered through `EventManager` with `skipWhenModalOpen`, ignoring typing contexts (`isTypingContext`).
- Selection merge: `bulkManager`'s selection set becomes the only selection. Ctrl+click and Shift+click select without entering bulk mode (reuse `toggleCardSelection`, `selectRangeFromAnchor`); the bulk bar appears whenever the set has more than one item or bulk mode is on; the B key and button still toggle the explicit mode (checkboxes visible, plain click toggles). Esc closes the top overlay first, then clears selection.
- Acceptance: NEW `gridKeyboard.test.js`; `BulkManager.shiftRange`, `BulkManager.marquee`, `shortcuts` tests updated; user: operate a page without the mouse.
- Commit: `feat(ui): add keyboard grid navigation`, `refactor(ui): merge focus and bulk selection`.

### 6c. Strength-aware send, one verb (idea 3; C2, C4)
- Files: `uiHelpers.js` (`sendLoraToWorkflow`, `copyLoraSyntax`, `getLoraStrengthsFromUsageTips`), `ModelCard.js`, `Inspector.js`, `ModelModal.js`, `bulk_bar.html`, `context_menu.html`, `locales/en.json`.
- Production already reads usage-tip strength (default 1). Add: the strength shown on the send button in the inspector and flyout ("Send to ComfyUI · 0.8"), a small stepper in the inspector that overrides the value for the next send/copy only (not persisted; saving a preset stays in the usage-tips editor).
- Audit all send strings (card title, context menu, bulk, toast `uiHelpers.*`) and point them at one key; changed English values re-queue the other locales.
- Acceptance: test that a card with `usage_tips.strength = 0.6` sends and copies 0.6 and that the stepper override is used once; user confirms wording.
- Commit: `feat(ui): show and adjust strength when sending to ComfyUI`.

### 6d. Real states (idea 4)
- Files: `VirtualScroller.js` (`showNoItemsPlaceholder`, `showGridLoading`), `MasonryScroller.js`, `ModelCard.js`, `card.css`, `loading.css`, `BannerService.js`, `templates/components/first_run.html`, `initialization.html`, NEW `static/css/components/empty-state.css`.
- Skeleton cards while the first batch loads (sized from the current layout math). Broken preview (`error` event on the image/video) and missing-file states on the card. Distinct empty states: empty library, empty folder, no favourites, no search/filter results (with "Clear all" from 6a), no updates. Civitai offline / rate-limit banner with Retry through `BannerService` using the errors the fetch and download flows already receive (no new polling, no new request). First-run and initialization screens restyled to the shell.
- Acceptance: tests for placeholder selection per state and for the broken-preview class; user disconnects the network and triggers Fetch to see the banner.
- Commit: `feat(ui): add loading, empty and error states`.

### 6e. Accessibility pass (A2-A5, A8, A9; verification of A6, A7)
- Files: `ModalManager.js`, `BaseContextMenu.js` + subclasses, `contextMenuCoordinator.js`, `menuPosition.js`, `uiHelpers.js` (`showActionToast`), `toast.css`, `menu.css`, all templates touched in Phases 2-5.
- Focus trap in `ModalManager.showModal` (Tab cycles inside the top modal; `aria-modal`; label from the modal title). Menus: focus first item on open, Up/Down/Home/End, Enter/Space, Esc returns focus, Right/Left open/close submenus, Shift+F10 and the context-menu key open the card menu for the focused card; `role=menu` / `menuitem`; `max-height: calc(100vh - 1rem)` with scroll. Checkbox semantics audit on flyouts. Template scan test: every `<button>` without text has `aria-label`; no clickable `div`/`span` without role and tabindex. Toasts: `role=status`, timer paused on hover/focus, action button focusable, minimum 8 s when an action is present. Reduced motion: grep for JS-driven animation and guard it.
- Acceptance: NEW `modalManager.focusTrap.test.js`, `contextMenu.keyboard.test.js`, `regression/templateA11y.test.js`; existing `ModalManager.focus.test.js`, `contextMenu.*.test.js` green; user: keyboard-only pass over one page with a screen reader if available.
- Commit: `fix(ui): trap focus in modals`, `fix(ui): make menus keyboard operable`, `fix(ui): accessible toasts and controls`.

### 6f. Command palette, Ctrl K (idea 5)
- Files: NEW `static/js/components/CommandPalette.js`, NEW `templates/components/command_palette.html`, NEW `static/css/components/command-palette.css`, `core.js`, `help_modal.html`, `locales/en.json`.
- Sources: pages (rail entries), actions (the `data-action` buttons of the current page, Settings sections via the existing settings search/navigation, Help, Doctor, theme), folders (the loaded folder tree), models (existing list endpoint through `getModelApiClient(page).` search with a debounce, top 8). Enter runs; models open details. Registered in `ModalManager` (id added to `modals.html` for the registry test). No new endpoint.
- Acceptance: NEW `commandPalette.test.js`; user: Ctrl K from every page.
- Commit: `feat(ui): add command palette`.

## Phase 7: second-wave UX (front end only, review order)

- **7a. Saved views (idea 6)**: extend `FilterPresetManager.js` presets to also store folder, search text and options, sort, favourites/updates flags and the `${page}_view` object; pinned views listed above the folder tree with a count (count fetched lazily with `page_size=1`, only for pinned views, on panel open). Old presets load unchanged (missing fields mean "do not touch"). Test: round trip + backward read. Commit: `feat(ui): extend filter presets into saved views`.
- **7b. Compare (idea 8)**: with 2-4 selected, bulk bar offers Compare; NEW `CompareModal.js` shows previews, base model, size, trigger words, usage tips, tags side by side from data already loaded. Commit: `feat(ui): compare selected models`.
- **7c. Library-health smart filters, front-end part (idea 10)**: only the filters the current list API already supports (verify each against `baseModelApi.js` search params before adding; expected: update available, no usage via sort). Statistics tiles link to the matching filtered page. The rest needs 9c. Commit: `feat(ui): add library-health quick filters`.
- **7d. Activity centre (idea 12)**: one panel from the rail bell merging the progress panel, scan status, update notifications (`UpdateService.js`) and a session toast history kept in memory by `showToast`. Commit: `feat(ui): add activity centre`.
- **7e. Narrow-window layout (idea 13, completes R1)**: rail becomes a bottom/top bar, folders and inspector become overlay drawers with focus trap, toolbar actions collapse into an overflow menu, details flyout full width. Test at 600 / 820 / 1180px by the user. Commit: `feat(ui): add narrow-window layout`.
- **7f. Recent entries and search history, front-end part (idea 14)**: last 10 searches per page and last 20 opened items in localStorage, shown in the search dropdown and command palette, with Clear. "Recently sent" needs 9d. Commit: `feat(ui): add search history and recent items`.

## Phase 8: later features (after the core and Phases 6-7)

- **8a. Send tray (idea 7)**. Spec: a docked tray (toggle in the toolbar, state per session) that stages LoRAs via "Add to tray" on card, inspector and bulk bar. Each row: name, strength stepper (initial value from usage tips), clip strength when present, trigger-word chips to include, remove. Footer: live syntax preview, Append / Replace, "Send to ComfyUI" once (reuses `sendLoraToWorkflow` with the combined syntax), "Copy", "Save as recipe" only if the recipe API accepts it without changes (otherwise omit). Persist the tray in sessionStorage. Front end only.
- **8b. Search tokens (idea 9)**. Spec: the search box parses `key:value` and `-key:value` tokens and free text. Front-end mapping onto existing state: `base:` -> base model filter, `tag:` / `-tag:` -> tag include/exclude, `type:` -> model type, `fav:true`, `update:true`, `folder:`. Tokens render as chips in the active-view strip (6a), with autocomplete from the filter option lists already loaded. Tokens that need new server fields (`used:`, `size:`, `creator:` as a filter, `hash:`) wait for 9e and are rejected with an inline hint until then.

## Phase 9: backend-dependent work (separate track, each item needs a go from the user)

| Item | Needs (API / settings) | Decision |
| --- | --- | --- |
| 9a. Recently deleted (idea 11) | Today deletes are staged by `py/services/pending_delete_service.py` and purged after a 30 s undo window (`POST /api/lm/undo-delete`). Needs: configurable retention (new setting in `DEFAULT_SETTINGS`), `GET` list of staged batches from the manifests, restore by batch (exists), purge-now endpoint; all also reachable with `GET` + query params if the browser extension should use them. UI: "Recently deleted" view in the rail/activity centre | D6 (retention and disk use) |
| 9b. Dry-run + operation log for bulk writes (idea 15) | `dry_run` flag on bulk move / auto-organize / rename-by-template / bulk delete / bulk tag endpoints returning the planned changes (auto-organize already has a preview: reuse its shape); an append-only operation log file in the settings directory with a list endpoint | D6 |
| 9c. Health filters: facet counts and missing-data filters (idea 10) | List endpoints accept `no_preview`, `no_trigger_words`, `no_metadata`, `no_hash`, `never_used`; a counts endpoint (or counts added to the existing filter-options response) | none, low risk |
| 9d. Last-sent timestamp (idea 14) | Record `last_used_at` beside the existing usage count, expose it in list items, add sort key `last_used` | none |
| 9e. Search fields for tokens (idea 9) | Server-side numeric/range filters (`size`, `usage_count`), `creator` and `hash` as filters in `search_options` | none |
| 9f. Group by (mock-up View popover) | Sort keys `base_model` and `folder` on list endpoints plus group boundaries in the response; front end adds header rows to `VirtualScroller` | none |

Sidecar path rules apply to anything in 9a/9b that touches files: derive paths through `py/utils/sidecar_paths.py`, never touch `.civitai.info`, use business paths (not `realpath`) for file operations and containment checks. New defaults go in `DEFAULT_SETTINGS` only.

---

## Cross-cutting notes

- **Persistence map**: appearance (`ui_theme`, `ui_highlight_color`, `ui_text_scale`) in backend settings with a localStorage pre-paint cache; per-page view options, inspector/folder panel state, search history and saved-view pins in localStorage via `storageHelpers.js` (prefix `lora_manager_`, required because plugin mode shares the origin with ComfyUI); filter presets stay where `FilterPresetManager` stores them.
- **Standalone vs plugin**: settings nav item `data-comfyui-only` and send-to-ComfyUI availability keep their current checks; in standalone the send controls follow the existing behaviour (do not hide or add logic). Test both modes after Phases 0, 2 and 5.
- **Translation hot-spots for new strings**: keep "Recipe", "Checkpoint", "LoRA", "ComfyUI", "Civitai", base-model and model-type names as-is in English keys; tag logic Any/All wording must stay unambiguous; folder panel terms follow the "Folder sidebar feature" section of the guidelines; the renamed `group_by_model` label and the unified send verb are translation events.
- **Tests that move with the DOM** (search before each phase): `grep -rlE "app-header|header-search|folder-sidebar|sidebar-|control-group|card-grid|theme-toggle|filter-panel" tests/frontend`. Heaviest: `managers/BulkManager.*.test.js`, `components/pageControls.*.test.js`, `components/sidebarManager.*.test.js`, `core/appCore.test.js`, `pages/*.test.js`, `utils/pageFixtures.js`.
- **Dead code**: each phase deletes what it replaces (preset themes, sidebar pin/hover logic, sticky controls, old header nav CSS, `#customFilterIndicator`, layout toggle in controls). No parallel old/new paths, no feature flag.
- **Not in scope**: `ui/` (Vue app at `/lm-ui/`), `web/comfyui/` widgets and their accent setting, `vue-widgets/`, backend routes (before Phase 9).

## Decisions needed from the user (recommended default in bold)

- **D1. Geist font files.** They are not in the repo and the executor may not download them unasked.
  **Recommended: you approve adding the official Geist and Geist Mono variable woff2 files plus `OFL.txt` to `static/vendor/geist/` (about 150 KB); until then the system font stack is used.**
- **D2. Theme presets (Nord, Midnight, Monokai, Dracula, Solarized).** They contradict the monochrome rule. **Recommended: remove them in Phase 1; preset users get the default look and can pick a highlight.**
- **D3. Icons.** The mock-up uses thin stroke SVG icons; the app ships Font Awesome locally.
  **Recommended: keep Font Awesome through Phase 5 (no new asset, far less churn) and decide on a stroke set afterwards**; the alternative is a local SVG sprite introduced in Phase 2.
- **D4. Which UI the ComfyUI top-bar button opens.** `web/comfyui/modern_ui_link.js` prefers the Vue UI at `/lm-ui/` when it is built, so the redesigned classic UI may not be what opens.
  **Recommended: leave `ui/` and the link untouched in this plan and decide after Phase 5.**
- **D5. Card options become per page.** `display_density`, `card_info_display` and `show_version_on_card` are global settings today; the View popover stores them per page in the browser.
  **Recommended: per page in localStorage, seeded once from the global values, rows removed from Settings.**
- **D6. Phase 9a/9b go-ahead.** A real trash keeps deleted model files on disk for the retention period and an operation log adds a file to the settings directory. **Recommended: 9a with 7 days retention and a size shown in the UI, 9b dry-run first and the log second; neither starts before Phases 0-7 are done.**
