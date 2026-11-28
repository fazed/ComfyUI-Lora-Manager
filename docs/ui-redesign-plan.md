# LoRA Manager modern UI (`ui/`) redesign: implementation plan

Target: mock-up D (`docs/ui-mockups/src/`: `d-template.html`, `extras.js|css`, `detail.js|css`) plus every finding and idea in `docs/ui-mockups/src/ux-review.md`. Scope: the Vue 3 + Vite + TypeScript + Tailwind v4 app in `ui/`, served at `/lm-ui/`. Out of scope: the classic UI (`templates/`, `static/`), `web/comfyui/`, `vue-widgets/`, and `docs/ui-redesign-plan-classic-ui.md` (older plan for the classic UI; its paths do not apply). The mock-up is a visual and interaction spec, not code: it uses fake data, `innerHTML` re-renders and a font CDN.

All paths and symbols below were read on branch `claude/lora-manager-ui-redesign-042020`. Files marked NEW do not exist yet. Items marked VERIFY were not fully confirmed and must be checked by the executor before building on them.

## 0. Ground rules for every phase

1. **Tokens only.** `ui/tests/styleTokens.test.ts` fails on raw colours, radii, font families, shadows, default-palette utilities and `dark:` anywhere in `ui/src` outside `src/themes/` and `src/styles/tokens.css`. New colours go in theme files; new utilities go in `src/styles/tokens.css`. Never weaken a rule or a contrast threshold to get green.
2. **No backend change before Phase 9.** Everything in Phases 0-8 uses existing `/api/lm/...` endpoints (`ui/src/api/endpoints.ts`, `recipes.ts`, `maintenance.ts`). No new settings keys, no `settings.json.example` edits.
3. **No network at runtime.** No CDN, no font service, no runtime-fetched assets (`ui/README.md` "Architecture"). Fonts are bundled files.
4. **i18n.** `ui/` has its own English-only table: `ui/src/i18n/index.ts` merges `b2bMessages`, `browseMessages`, `drawerMessages`, `settingsUxMessages`, `updatesMessages`, `versionMessages`; `MessageKey = keyof typeof messages`, so a missing key fails `bun run typecheck`. New strings go in NEW `ui/src/i18n/redesignMessages.ts`, merged in `index.ts`. `locales/*.json` belong to the classic UI: do not touch them, do not run `scripts/sync_translation_keys.py`, do not translate. When an existing English string changes meaning, change it in place in the `ui/src/i18n` file that owns it. No literal UI text in templates.
5. **Virtual list stays.** `components/VirtualGrid.vue` + `utils/gridLayout.ts` own the grid. Selection, favourite, focus and inspector updates must patch state (`selected` Set, `list.updateItem`) and never reset the list or re-key rows. `list.reset()` is only for a changed result set (`filters.signature`).
6. **Contracts that tests pin**: `ModelItemViewProps` / `ModelItemViewEmits` (`components/modelItemView.ts`, compile-time check in `tests/listView.test.ts`), `meta.layout` per route (`tests/pageLayout.test.ts`), storage keys in the `index.html` bootstrap (`tests/themes.test.ts`), the mark path (`tests/branding.test.ts`), menu entries (`tests/menuItems.test.ts`). Change a pinned test only in the task that says so, in the same commit as the behaviour.
7. **Checks after every phase** (run in `ui/`, Bun only): `bun run typecheck`, `bun run test`, `bun run build`. Then `git status` must show only intended `ui/src`, `ui/tests`, `ui/index.html`, `ui/public`, `ui/README.md` and regenerated `ui/dist` files. `bun run dev` talks to the real backend (writes are real): do not use it to click through destructive flows.
8. **`ui/dist` is committed** (`ui/README.md` "Build and commit rule"). Each phase ends with `bun run test && bun run build` and a `build(ui): rebuild dist ...` commit directly after the source commits (same pattern as `5e863db2`). Never leave the branch tip with source newer than `dist`. Do not hand-edit `dist`.
9. **Look and feel is the user's call** (repo `AGENTS.md`, "UI Verification"). The executor does not start servers or browser automation to judge aesthetics; each phase lists manual checks for the user.
10. **Docs.** `ui/README.md` documents theming, layout, toolbar and drawer in detail. Each phase updates the sections it invalidates (`docs(ui): ...` commit), concisely.
11. Commit style follows recent history: `feat(ui): ...`, `fix(ui): ...`, `test(ui): ...`, `docs(ui): ...`, `build(ui): rebuild dist ...`.

## 1. Audit of `ui/` (what exists)

- **Shell**: `App.vue` = skip link + `TopBar.vue` + `<main data-layout>` + `ToastHost`, `ConfirmDialog`, `ReplaceChoiceDialog`, `NodePickerDialog`. `TopBar.vue`: brand tile (`BrandMark.vue`), library tabs from `NAV_TABS` (`config/navigation.ts`), global search (`SearchCombobox.vue`, `/` and Ctrl/Cmd+K), Updates link with badge (`useUpdatesSummary`), Downloads indicator (`useDownloadQueue`), Settings link, `AppMenu.vue` (theme + density via `ThemeOptions.vue`, Statistics, Diagnostics, Classic UI link). No sidebar.
- **Routes** (`router.ts`): `/loras`, `/checkpoints`, `/embeddings` (`LibraryPage.vue`, `meta.layout: 'grid'`), `/recipes` (`RecipesPage.vue`, grid), and `content` pages inside `PageShell.vue`: `/search`, `/downloads`, `/updates`, `/settings/:tab?`, `/stats`, `/doctor`, not-found. There are no Other / Workflows / Wildcards pages.
- **Library page**: `LibraryPage.vue` holds the folder `<aside>` (240px, `FolderTree.vue`, `useFolderPanel`, overlay at `narrow:`), `LibraryToolbar.vue` (title + count, search, sort `<select>`, Filters button with inline panel, grid/list switch, card-size slider, Folders, Select, `RefreshButton`, Tools `MenuButton`; phone = `BottomSheet`), `BaseModelQuickFilter.vue` row, `LibraryFilterPanel.vue` (base model + tag chips, favourites / updates checkboxes), chips row from `useLibraryFilters().chips` with Clear, `LibrarySelectionBar.vue` (replaces the toolbar row), `VirtualGrid.vue` with `ModelCard.vue` / `ModelRow.vue`, `ModelDrawer.vue` (560px, tabs Overview / Description / Versions), one shared `ModelActionMenu.vue` (WAI-ARIA menu, entries from `utils/menuItems.ts`), and dialogs (`MoveDialog`, `OrganizeDialog`, `DownloadDialog`, `DuplicatesDialog`, `ExcludedDialog`, `PreviewDialog`, `TemplateDialog`, `FolderDialog`, `InputDialog`). `RecipesPage.vue` reuses the toolbar, folder tree, selection bar and grid with `RecipeCard`, `RecipeDrawer` and the recipe dialogs.
- **Theming**: `src/themes/base.css` (non-colour tokens, px spacing, `data-density='compact'`), `default-light.css`, `default-dark.css`, `midnight.css`, `registry.ts` (`BUILTIN_THEMES`, storage keys), `contrast.ts` (WCAG helper), `composables/useTheme.ts` (choice `system` | theme id, density, user themes from `GET /api/lm/ui/themes`), pre-paint script in `ui/index.html`. `src/styles/tokens.css` maps Tailwind utilities to `--lm-*` with `@theme inline`; `src/styles/app.css` holds `lm-btn`, `lm-input`, `lm-chip`, `lm-badge`, `lm-row`, `lm-switch` etc. Usage counted in `src/`: 108 accent utilities, 38 warning utilities, 191 arbitrary `[Npx]` values in 52 files.
- **Persistence today**: appearance is localStorage only (`lm-ui.theme`, `lm-ui.theme.user`, `lm-ui.density`); per-library `lm-ui.library.<prefix>` = `{sort, cardSize, view}`; `lm-ui.library.<prefix>.folders`; `lm-ui.detail.tab`, `lm-ui.detail.specsOpen`. `useAppSettings.ts` caches backend settings (`GET /api/lm/settings`) for behaviour settings such as `blur_mature_content`, `lora_syntax_format`, `include_trigger_words`. Filters, folder and scroll survive tab switches in memory (`utils/browse.ts`).
- **Icons**: inline SVG paths in `components/icons.ts` rendered by `AppIcon.vue` (`currentColor`). No Font Awesome in `ui/`. This stays; missing glyphs are added to `icons.ts`.
- **Tests**: 32 vitest files in `ui/tests`. Guards that this redesign will touch are listed in section 6.

### Migration strategy (lowest risk)

1. Foundations with no layout change: bundled font, rem-based scale, highlight resolver, appearance state (Phase 0).
2. Re-value tokens and themes so every screen turns monochrome through the existing utilities (Phase 1). The 108 accent usages keep working because the accent becomes the highlight.
3. Restructure the shell and the library chrome (Phase 2), then cards / inspector / bulk bar (Phase 3), then the drawer (Phase 4), then the remaining pages and dialogs (Phase 5).
4. UX-review items and new features on top (Phases 6-8); backend-dependent parts last (Phase 9).

## 2. Mock-up vs existing `ui/`

| Area (mock-up source) | Status in `ui/` | Action |
| --- | --- | --- |
| Tokens, dark + light (`d-template.html` `:root`, `extras.css` light block) | Present, indigo / amber | Re-value (P1) |
| Highlight swatches + custom (`setHi`) | Missing | P0 |
| Text size S/M/L/XL (`setScale`) | Missing; spacing tokens are px, font sizes rem | P0 |
| Theme dark / light / auto (`applyTheme`) | Present (`system` + theme ids, user themes) | Keep ids; "Auto" = `system` |
| Geist via CDN | System font stack | Bundle locally (P0) |
| Icon rail + appearance popover (`buildRail`, `#pop`) | Top bar + `AppMenu` | P2 |
| Rail entries Other / Workflows / Wildcards | No such pages in `ui/` | Decision D3 (a) |
| Folder panel: find, collapse all, tree/list, show empty, new folder (`tree`, `f-new`, `f-col`, `f-opt`) | Tree, context menu, header "..." menu; no find / collapse all / list view | P2 |
| Folder counts | `unified-folder-tree` returns names only | P9 |
| Breadcrumb with sibling menus (`crumbs`) | Missing (folder chip only) | P2 |
| Alphabet bar (`alpha`) | Missing; backend has `name_pattern_include` for LoRAs only (`py/services/lora_service.py`) | P2 for LoRAs (VERIFY), counts and other types P9 |
| Search-in options (`soBuild`) | Not exposed; backend takes `search_filename`, `search_modelname`, `search_tags`, `search_creator`, `search_trigger_words`, `recursive` | P2 |
| Filters flyout (`#fly`) | Inline panel + phone sheet | P2 (flyout on desktop, sheet stays on phone) |
| Filter presets | Missing | P2 basic, P7 saved views |
| Tags any/all | Missing; backend `tag_logic` | P2 |
| Model type filter | Missing; backend `model_type` | P2 |
| Licence include / exclude | Missing; backend `credit_required`, `allow_selling_generated_content` (true / false / absent) | P2 |
| Favourites / Updates toggles in the action bar | Present as filter checkboxes | Keep in Filters |
| View popover: layout, size, shape, fit, group by, show on cards (`view()`) | Layout switch + size slider in the toolbar | P2 (group by: P9, see D5) |
| Sort menu incl. published, usage asc, random | `COMMON_SORTS` lacks `published:*`, `usage:asc`, `random` (backend `model_cache.py` supports them) | P2 |
| Card: name below image, hover action bar, version row, NSFW "Show" overlay (`item`) | Name on scrim gradient, top-right hover buttons, blur without reveal | P3 |
| Hover preview cycling, drag card to folder | Missing ("no drag and drop" in README) | P7 |
| List rows | Present and richer (container-query columns, tooltips) | Add header + sort (P3) |
| Inspector / quick view (`.insp`) | Missing | P3 |
| Bulk bar at the bottom (`bulkBar`) | Bar replaces the toolbar row; has all / none / invert / hidden count | P3 (keep extras) |
| Bulk favourite / base model / rating / refresh metadata | Missing (README: no bulk endpoint) | P7 client loop, P9 endpoints |
| Context menus (`cardItems`, `bulkItems`, `folderItems`, `globalItems`) | Item, selection, folder menus exist with keyboard support; no submenus, no grid-background menu | Restyle P5; add entries where an endpoint exists |
| Details flyout, 2 columns, tabs Examples / Description / Versions / Recipes (`detail.js`) | Drawer 560px, tabs Overview / Description / Versions; panels stay mounted (`v-show`) | P4 |
| Inline edit of name / version / base model, usage-tips editor, add trigger word | Rename via dialog; usage tips read-only chips; notes editable | P4 where `saveMetadata` already supports the field (VERIFY), else P9 |
| Toasts bottom centre with Undo | Bottom right, action button, 5 kept | Restyle P5, pause + keyboard P6 |
| Progress panel (`startProgress`) | Polling state inside pages / dialogs | P7 activity centre |
| Settings modal | Full page, schema-driven, tabs, sticky save bar | Keep page (D3), restyle P5 |
| Doctor modal, Statistics view | Full pages | Keep pages, restyle P5 |
| Help, Notifications, Support modals | Missing | P5 |
| Status bar (`.sb`) | Count sits in the toolbar title | P2 |
| Shortcuts R, D, B, ?, Ctrl F, Alt+letter | `r`, `f`, `s`, `/`, Ctrl/Cmd+K | P6 (keep existing keys, add the rest) |

`ui/` has and the mock-up omits (all kept, restyled through tokens): global search with grouped suggestions and `/search` page, Updates page with bulk update / ignore / old versions, Downloads page with server queue, replace-choice flow, density switch, user themes, `?open=` / `?q=` / `?tag=` deep links, browse-state restore, refresh registry, long-press menus, phone bottom sheet, example lightbox with generation data, example image manager, recipe import / batch import / duplicates / reconnect, base-model quick filter row (D2), "N not in view" selection count.

## 3. Mock-up to production mapping

| Mock-up | Production |
| --- | --- |
| `:root` / light tokens | `ui/src/themes/default-dark.css`, `default-light.css`, `base.css` |
| `setHi`, `PRESETS`, `lum` | NEW `ui/src/themes/highlight.ts`, NEW `ui/src/composables/useAppearance.ts`, `ui/index.html` bootstrap |
| `setScale`, `SCALES` | `base.css` (`data-scale` blocks), `useAppearance.ts`, `index.html` |
| `applyTheme` | `composables/useTheme.ts` (unchanged API) |
| `buildRail`, `.iconrail`, `.tip` | NEW `components/AppRail.vue`, `config/navigation.ts`, `App.vue` |
| `#pop` | NEW `components/AppearancePopover.vue` wrapping `ThemeOptions.vue` |
| `tree`, `f-new`, `f-col`, `f-opt`, `#fq` | NEW `components/FolderPanel.vue`, `FolderTree.vue`, `useFolderPanel.ts`, `utils/folderActions.ts` |
| `crumbs` | NEW `components/FolderBreadcrumb.vue` |
| `alpha`, `letterOf` | NEW `components/AlphabetBar.vue`, NEW `utils/alphabet.ts` |
| `.tb`, `.bar`, `b-sort`, `scan` | `components/LibraryToolbar.vue`, `RefreshButton.vue`, `MenuButton.vue` |
| `#fly`, `filters`, `taglogic`, licence cycle, `FP` presets | NEW `components/FilterFlyout.vue`, `LibraryFilterPanel.vue`, `useLibraryFilters.ts`, `api/endpoints.ts` (`ModelListQuery`, `modelListParams`) |
| `soBuild` | NEW `components/SearchOptions.vue`, `useLibraryFilters.ts` |
| `#view`, `view()`, `V0` | NEW `components/ViewPopover.vue`, `useLibraryFilters.ts`, `VirtualGrid.vue`, `utils/gridLayout.ts` |
| `item`, `.qa`, `.tagrow`, `.verrow`, `.nsfw-ov` | `components/ModelCard.vue`, `ModelRow.vue`, `RecipeCard.vue`, `modelItemView.ts`, `useCardInteractions.ts` |
| `.insp` in `render()` | NEW `components/ModelInspector.vue` |
| `setBulk`, `bulkBar`, `bulkItems` | `components/LibrarySelectionBar.vue`, `utils/menuItems.ts` (`selectionMenu`) |
| `showMenu`, `cardItems`, `folderItems` | `components/ModelActionMenu.vue`, `utils/menuItems.ts` |
| `renderDetail`, `bindPane`, `stepDetail` | `components/ModelDrawer.vue`, `utils/drawer.ts`, `utils/drawerNav.ts` |
| `modal`, `confirmDelete`, `openMove`, `openRating`, `bulkTags`, `openOrganize`, `openLink`, `openDownload`, `openImport` | `ModalShell.vue`, `ConfirmDialog.vue`, `MoveDialog.vue`, `PreviewDialog.vue`, `InputDialog.vue`, `OrganizeDialog.vue`, `DownloadDialog.vue`, `RecipeImportDialog.vue` |
| `openSettings`, `openDoctor`, `statsHtml` | `pages/SettingsPage.vue`, `DoctorPage.vue`, `StatsPage.vue`, `components/charts/*` |
| `openHelp`, `openNotif`, `openSupport` | NEW `components/HelpDialog.vue`, NEW `components/NotificationsDialog.vue`, NEW `components/SupportDialog.vue` |
| `toast` | `components/ToastHost.vue`, `composables/useFeedback.ts` |
| `startProgress`, `.prog` | NEW `components/ActivityPanel.vue`, NEW `composables/useActivity.ts` (P7) |
| `.sb` | NEW `components/StatusBar.vue` |
| keyboard block | `utils/browse.ts` (`shouldHandleShortcut`), NEW `composables/useGridKeyboard.ts`, NEW `config/shortcuts.ts` |

## 3b. Primitive layer: shadcn-vue on Reka UI (decision D4)

**Verdict: adopt, as an adapted primitive layer, incrementally.** shadcn-vue is copied source built on Reka UI (headless: focus trap and return, roving focus, typeahead, ARIA roles, portals, collision-aware positioning). That removes most hand-built overlay work in the UX review. It is not a drop-in for `ui/`: the copied files must be adapted to this project's token system, which is acceptable because they become our source.

**Compatibility (checked against `ui/`)**
- Fits: Vue 3.5.26, Tailwind 4.3.5 with `@tailwindcss/vite`, Vite 6, `@/*` alias in `tsconfig.json`, `vite.config.mts` and `vitest.config.ts`, `@vueuse/core` already present (VERIFY in `bun.lock` that Reka UI does not pull a second copy).
- Does not fit as shipped: `src/styles/tokens.css` resets Tailwind's colours, radii, shadows, breakpoints and the spacing multiplier, so stock class lists (`bg-background`, `h-9`, `size-4`, `gap-1.5`, `shadow-xs`, `sm:max-w-lg`, `dark:...`, `animate-in`) do not compile, and `tests/styleTokens.test.ts` forbids `dark:`. shadcn's `accent` means "subtle hover background" while `ui/`'s `accent` is the highlight (108 usages): the names collide, so an alias layer is not possible for that token.
- Theming therefore stays single-source: do NOT run `shadcn-vue init` (it rewrites the stylesheet with its own `:root` / `.dark` variables and `@custom-variant dark`) and do not add `tw-animate-css`. Each copied component's classes are rewritten once to the existing utilities: `background` -> `bg-page`, `card` -> `bg-surface`, `popover` -> `bg-elevated`, `foreground` -> `text-fg`, `muted-foreground` -> `text-muted`, `muted` / shadcn `accent` (hover) -> `bg-sunken`, `primary` -> `bg-accent` / `text-on-accent`, `destructive` -> `danger`, `border` -> `border-border`, `input` -> `border-field-border` / `bg-field`, `ring` -> `focus-ring`, `--radius` -> `rounded-sm|md|lg`, numeric sizes -> `h-control`, `p-1..8` or rem arbitrary values, `sm:` -> the `phone:` / `tablet:` variants, enter / exit animation -> `data-[state=open]:animate-fade-in` on the motion tokens. Result: monochrome themes, user highlight, light / dark / auto, user themes, density and text scale apply to the new components with no extra mapping, and the style lint covers them.

**Integration**
- Dependencies (runtime, bundled, nothing fetched at run time): `reka-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`; optional `vue-sonner`. Pin exact versions like the existing ones. Licences are permissive (shadcn-vue and Reka UI are MIT; VERIFY each package's licence field on install and note them in `ui/README.md`). No icon package: copied files import Lucide icons; replace those few imports with `AppIcon.vue` names.
- NEW `ui/components.json` (hand-written: `aliases.ui = "@/components/ui"`, `aliases.utils = "@/lib/utils"`, `tailwind.css = "src/styles/main.css"`, `cssVariables: true`, `typescript: true`). Components live in NEW `ui/src/components/ui/<name>/`. Adding one = `bunx shadcn-vue@latest add <name>` (developer-time network, like `bun install`) or copying the source from the docs, then the class rewrite above, then `bun run test` (the lint fails until the rewrite is complete). Never let the CLI edit `main.css`; revert it if it does.
- NEW `ui/src/lib/utils.ts`: `cn()` = `clsx` + `extendTailwindMerge` configured with this project's custom groups (colour names `fg`, `muted`, `page`, `surface`, `elevated`, `sunken`, `accent`, `on-accent`, ...; font sizes `xs..2xl`, `md`), otherwise `text-fg` and `text-md` are treated as conflicting. NEW `tests/cn.test.ts` pins that.
- Tests: Reka teleports to `document.body` and needs APIs jsdom lacks. NEW `ui/tests/setup.ts` (wired through `test.setupFiles` in `vitest.config.ts`) polyfills `ResizeObserver`, `PointerEvent`, `hasPointerCapture` / `releasePointerCapture`, `scrollIntoView`; overlay tests mount with `attachTo: document.body` and query `document.body`. `tests/dialogStub.ts` is deleted once no native `<dialog>` remains.
- Bundle: record the gzip size of `ui/dist/assets/index-*.js` and the total before the first adoption commit and after each phase in the `build(ui)` commit body. Import Reka parts by name only. If the entry chunk grows by more than about 60 kB gzip, stop and review (`chunkSizeWarningLimit` is 300 kB raw).

**Adopted (and what it replaces)**

| shadcn-vue component | Used for | Replaces / closes |
| --- | --- | --- |
| Dialog, AlertDialog | `ModalShell.vue`, `ConfirmDialog.vue`, `ReplaceChoiceDialog`, `NodePickerDialog`, lightbox shell, new Help / Support / Notifications | native `<dialog>` + `useDismissLayer` backdrop code; review A4 |
| Sheet | details flyout (`ModelDrawer`, `RecipeDrawer`), phone `BottomSheet.vue`, narrow-window folder / inspector overlays (#13) | hand-built trap and focus return; A4, R1 |
| Popover | Appearance, View, Filters flyout, Search-in, base-model "More" | `AppMenu.vue` pattern; A4 |
| DropdownMenu (with Sub, CheckboxItem, RadioGroup, Shortcut, Label) | `MenuButton.vue` (Tools, Sort with a check mark, folder options), `ModelActionMenu.vue` internals | hand-written arrow-key code; adds typeahead, submenus, collision handling; A3 |
| Command | command palette (#5), fed by `utils/suggest.ts` | hand-built listbox in 6e |
| Tooltip | rail and icon-only buttons (hover and focus) | `title`-only hints; A5 (the `aria-label` stays mandatory) |
| Tabs | new surfaces only (Help dialog, flyout right pane if it simplifies the code) | - |
| Sonner (`vue-sonner`, optional) | toast host behind the unchanged `useToasts()` API | timer pause on hover / focus, keyboard access, swipe; A9 |

**Not replaced, and why**: `VirtualGrid.vue` (2-D windowing with scroll anchoring, no equivalent); `ModelCard`, `ModelRow`, `RecipeCard`, `LazyMedia`, charts, `GenerationDetails`, the settings schema renderer (domain widgets); `FolderTree.vue` (lifted expansion, flat mode, per-row menu; Reka's `TreeRoot` may be used inside it for keyboard semantics, VERIFY in Phase 2 task 6); `SearchCombobox.vue` (async grouped suggester with 400 lines of tests; the palette reuses its data layer, not its markup); native form controls `lm-input`, `lm-select`, `lm-check`, `lm-switch` (already a native checkbox with `role="switch"`), the range slider (native controls are accessible and lighter; review A2 is closed with native inputs); Badge, Skeleton, Breadcrumb, ScrollArea (existing `lm-badge` / `lm-skeleton` and plain markup do the same; the virtual grid needs the native scroller).

**Migration hazards (rules)**
1. Never nest a Reka overlay inside a native modal `<dialog>`: the top layer hides and inerts body-level portals. Convert the shells (`ModalShell`, `ConfirmDialog`, `BottomSheet`) before anything inside a dialog uses Popover / DropdownMenu, and convert the drawer together with the overlays it opens (confirm, lightbox, action menu).
2. Two dismissal systems: a surface on Reka leaves `useDismissLayer`. `useDismiss.ts` remains only for non-overlay modes (selection Escape, folder overlay until it becomes a Sheet) and must ignore Escape while a Reka layer is open (check `[data-state="open"][role="dialog"], [role="menu"]`); add that case to `tests/dismiss.test.ts`. `shouldHandleShortcut` (`utils/browse.ts`) already blocks on `[role="dialog"]`, `[role="menu"]`, `[role="listbox"]`.
3. One surface per commit. `ModelActionMenu.vue` keeps its props / events and stays one page-level instance opened at a point (cards, "..." buttons, long press, keyboard); internally it becomes a controlled DropdownMenu anchored to a zero-size fixed element at that point (VERIFY Reka's virtual-anchor support; if absent keep the current positioning code and adopt only the roving-focus parts). `utils/menuItems.ts` and its tests do not change.

## 4. Phases

### Phase 0: foundations (font, rem scale, highlight, appearance state)

**Goal**: everything needed for the re-skin exists and is tested; the only visible changes are the Geist font and two new controls in the existing appearance UI.

**Files**: NEW `ui/src/assets/fonts/` (`Geist-Variable.woff2`, `GeistMono-Variable.woff2`, `OFL.txt`), NEW `ui/src/themes/fonts.css`, `themes/index.ts`, `themes/base.css`, `themes/registry.ts`, NEW `themes/highlight.ts`, NEW `composables/useAppearance.ts`, `components/ThemeOptions.vue`, `ui/index.html`, `utils/gridLayout.ts`, `components/VirtualGrid.vue`, NEW `i18n/redesignMessages.ts`, `i18n/index.ts`, tests: NEW `tests/highlight.test.ts`, NEW `tests/fonts.test.ts`, `tests/themes.test.ts`, `tests/listView.test.ts`.

**Maps to**: `d-template.html` lines 8-20 and 275-300.

**Tasks**
1. Fonts (after D1). Put the two variable `.woff2` files and the licence text in `src/assets/fonts/`. Write `@font-face` rules in `src/themes/fonts.css` (the `themes/` folder is exempt from the raw `font-family` rule) with relative `url()`, `font-display: swap`, weight range 400-650. Import it first in `themes/index.ts`. In `base.css` set `--lm-font-sans: 'Geist', <current stack>` and `--lm-font-mono: 'Geist Mono', <current stack>`.
2. `tests/fonts.test.ts`: every `url()` in `fonts.css` points at an existing file; no `http://` or `https://` URL in any `src/**/*.css` or in `index.html`; `OFL.txt` exists.
3. rem scale. In `base.css` convert the px spacing, control, drawer, page, card, row and radius tokens to rem at a 16px root (4px = 0.25rem). Keep `--lm-border-width`, `--lm-focus-ring-width` in px. Add `html { font-size: calc(16px * var(--lm-text-scale)); }` with `--lm-text-scale: 1` and blocks `:root[data-scale='s'|'l'|'xl']` = 0.875 / 1.125 / 1.25. Raise `--lm-font-size-md` to `0.9375rem` (15px at M), `sm` to `0.875rem`, `xs` to `0.8125rem`, `lg` to `1.0625rem`. `tests/themes.test.ts` still requires the listed tokens to exist in `base.css`.
4. Grid maths. Custom properties now read back as `rem` text, so `parseLength` (`utils/gridLayout.ts`) must accept a root size: `parseLength(value, fallback, remPx = 16)` returns px for `rem` and `px` input. `VirtualGrid.readTokens` passes `parseFloat(getComputedStyle(document.documentElement).fontSize)`, multiplies `minItemWidth` by `remPx / 16`, and adds `data-scale` to the `useMutationObserver` `attributeFilter`. Extend the "reads px token values" case in `tests/listView.test.ts` with rem input.
5. `themes/highlight.ts` (pure, uses `themes/contrast.ts`): `HIGHLIGHT_PRESETS` (Mono, Ice `#7cc7f0`, Mint `#6fd6a6`, Rose `#f58ba3`, Sand `#d8c9a8`, Steel `#9fb0c3`, Coral `#ff8a6b`, Lime `#b7e36a`), `DEFAULT_HIGHLIGHT = 'mono'`, and

   ```ts
   resolveHighlight(choice: string, scheme: ColorScheme, surfaces: { surface: string; elevated: string; text: string }):
     { accent: string; accentHover: string; accentSoft: string; onAccent: string }
   ```
   Mono resolves to `#ffffff` on dark and `#111111` on light. A custom hex is clamped: while `contrastRatio(accent, surface) < 4.5`, mix 8% toward `text`; `onAccent` is whichever of `#0b0b0b` / `#ffffff` has the higher ratio (must reach 4.5). Invalid input returns the Mono result. The focus ring is NOT derived from the highlight (stays `--lm-color-focus`).
6. `tests/highlight.test.ts`: every preset and five hostile customs (`#000000`, `#101010`, `#ffffff`, `#f5f5f5`, `#808080`) on both schemes satisfy accent on surface >= 4.5, accent on elevated >= 3, onAccent on accent >= 4.5, onAccent on accentHover >= 4.5.
7. `registry.ts`: add `HIGHLIGHT_STORAGE_KEY = 'lm-ui.highlight'`, `HIGHLIGHT_VARS_STORAGE_KEY = 'lm-ui.highlight.vars'`, `SCALE_STORAGE_KEY = 'lm-ui.scale'`. `useAppearance.ts`: `highlight` and `scale` refs through `useLocalStorage` (same options as `useTheme.ts`), `apply()` sets `data-scale` on `<html>` and, only while the active theme is built-in, sets `--lm-color-accent`, `-accent-hover`, `-accent-soft`, `--lm-color-on-accent` inline on `<html>`; with a user theme active it removes them. It stores the resolved values for both schemes under `lm-ui.highlight.vars` so the pre-paint script needs no colour maths. Re-apply when `useTheme().activeTheme` changes. Call it from `App.vue` next to `useTheme()`.
8. `index.html` bootstrap: read `lm-ui.scale` (validate against `s|m|l|xl`) and `lm-ui.highlight.vars` (apply only when `theme` is `default-light` / `default-dark` and each value matches `/^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i`). Extend the bootstrap test in `tests/themes.test.ts` with the three new keys.
9. Primitive layer (after D4): add the dependencies, `components.json`, `src/lib/utils.ts`, `tests/setup.ts` + `setupFiles`, `tests/cn.test.ts` exactly as in section 3b; add the first two components (`dialog`, `popover`) with rewritten classes and one smoke test each (opens, traps focus, Escape closes, focus returns). No existing surface is switched in this phase. Update the "Runtime dependencies ... No UI kit" paragraph of `ui/README.md`.
10. `ThemeOptions.vue`: add a "Text size" radio group (S / M / L / XL, same segmented markup as density) and a "Highlight colour" group (swatch radios, a labelled `<input type="color">`, "Reset"). A note says the highlight applies to the built-in themes. Strings in `redesignMessages.ts`.

**Must not change**: theme ids, existing storage keys, user-theme loading, density.

**Risks**: (a) rem conversion shifts geometry by sub-pixels: `tests/rowColumns.test.ts` and `tests/listView.test.ts` pin numbers, so keep M identical to today's px values (16px root). (b) A `.woff2` served with a generic MIME type: `py/routes/modern_ui_routes.py` uses `web.FileResponse`; if the browser refuses the font, report it, do not change the backend in this phase. (c) Flash of unscaled text: covered by task 8.

**Acceptance**: `bun run typecheck && bun run test && bun run build`; `ui/dist/assets` contains two `.woff2` files; `grep -r "googleapis\|gstatic" ui/src ui/index.html ui/dist` prints nothing. User: text is Geist; More options > Text size XL scales text, buttons, cards and the folder panel together with no overlap at 1280px; a custom dark highlight on the dark theme stays visible; reload shows no flash.

**Commits**: `feat(ui): bundle Geist and scale the layout in rem`, `feat(ui): highlight colour and text size settings`, `build(ui): add reka-ui primitives adapted to the design tokens`, `build(ui): rebuild dist with Geist and appearance settings`.

### Phase 1: monochrome re-skin through tokens

**Goal**: every page is black / grey / white with one highlight, 6px corners, no gradients, no layout change.

**Files**: `themes/default-dark.css`, `default-light.css`, `midnight.css` + `registry.ts` (D6), `base.css` (radii), `styles/tokens.css`, `styles/app.css`, `public/favicon.svg`, `components/ModelCard.vue`, `ModelRow.vue`, `RecipeCard.vue`, `ToastHost.vue`, `components/charts/chartClasses.ts`, tests: `contrast.test.ts`, `themes.test.ts`, `branding.test.ts`, `styleTokens.test.ts`.

**Maps to**: `d-template.html` lines 10-18, `extras.css` lines 2-10.

**Tasks**
1. Re-value the two default themes. Starting values (the contrast test decides the final ones):

   | Token | Dark | Light |
   | --- | --- | --- |
   | `bg` / `surface` / `elevated` / `sunken` | `#0b0b0b` / `#141414` / `#1b1b1b` / `#222222` | `#f5f5f5` / `#ffffff` / `#ffffff` / `#ececec` |
   | `border` / `border-strong` | `#262626` / `#363636` | `#e3e3e3` / `#cdcdcd` |
   | `text` / `muted` | `#ededed` / `#a1a1a1` | `#111111` / `#555555` |
   | `accent` / `accent-hover` / `accent-soft` / `on-accent` | `#ffffff` / `#d9d9d9` / `rgba(255,255,255,0.10)` / `#0b0b0b` | `#111111` / `#333333` / `rgba(17,17,17,0.08)` / `#ffffff` |
   | `focus` | `#ededed` | `#111111` |
   | field tokens, `placeholder`, `skeleton`, `overlay`, `scrim`, `shadow` | neutral greys, same roles | neutral greys, same roles |

   There is no third, dimmer text level: the mock-up's `--text-3` fails 4.5:1, so everything secondary uses `muted`.
2. Semantic colours: keep `danger`, `success`, `warning`, add `--lm-color-info` and `--lm-color-info-soft` to all built-in themes, map them in `tokens.css`, add the pairs to `PAIRS` in `tests/contrast.test.ts` (info on surface, info on info-soft over surface). There is exactly one danger token family; grep must find no other red.
3. Decorative colour audit. Review all 38 `*-warning` usages: keep those that mean "warning / paused / rate limited"; change the favourite star (`ModelCard.vue`, `ModelRow.vue`, drawer) to the accent. `ToastHost.vue` info toasts use `border-l-info`.
4. Radii in `base.css`: `--lm-radius-sm: 0.25rem`, `-md: 0.375rem` (6px), `-lg: 0.5rem`; pill unchanged.
5. Gradients. Replace `bg-scrim-fade` (cards) with a flat `bg-scrim` strip until Phase 3 moves the name below the image, then delete the `@utility bg-scrim-fade`. Replace the `linear-gradient` shimmer of `.lm-media-placeholder.is-loading` (`app.css`) with the existing `animate-skeleton` pulse. The two `radial-gradient` rules that draw the `lm-switch` knob are a shape, not a gradient: keep them and allow-list them. Add a rule to `tests/styleTokens.test.ts`: no `linear-gradient` / `radial-gradient` / `conic-gradient` in `src` except that allow-list.
6. Charts (`--lm-color-series-1..6`): series 1 = accent, 2-6 = a grey ramp with at least 3:1 against `surface` and visibly distinct steps; multi-series charts keep their direct labels / legends (see D5 note in section 9 if the ramp is not readable).
7. Favicon: tile `#111111`, mark `#ffffff`, same geometry. Update `tests/branding.test.ts` ("indigo rounded square", "matches the default-light accent") to the new values in the same commit.
8. `midnight`: apply D6.
9. Update `ui/README.md` "Theming" (built-in themes, contrast numbers, favicon colour).

**Must not change**: any class list other than the ones named; token names; user-theme contract; `contrast.test.ts` thresholds.

**Risks**: white-on-white selected states (`lm-row.is-selected`, `lm-chip--active`, active tab) may read too weak with a 10% tint: raise `accent-soft` opacity before touching components. Links (`a { text-accent underline }`) are now text-coloured; the underline carries the affordance, keep it.

**Acceptance**: all three commands green; `grep -rn "4f46e5\|8b93ff\|6366f1\|a7adff" ui/src ui/public` prints nothing. User: walk every route in dark and light; nothing indigo or amber except warnings; selected folder, active filter chip, primary button and focus ring are all clearly visible.

**Commits**: `feat(ui): monochrome themes with a single highlight colour`, `test(ui): pin the monochrome favicon and forbid gradients`, `build(ui): rebuild dist with the monochrome themes`.

### Phase 2: shell layout (rail, folder panel, toolbar, flyouts, breadcrumb, alphabet bar, status bar)

**Goal**: the mock-up's frame around an unchanged card grid and drawer.

**Files**: NEW `AppRail.vue`, `AppearancePopover.vue`, `GlobalSearchDialog.vue`, `FolderPanel.vue`, `FolderBreadcrumb.vue`, `AlphabetBar.vue`, `FilterFlyout.vue`, `SearchOptions.vue`, `ViewPopover.vue`, `StatusBar.vue`, `utils/alphabet.ts`; edited `App.vue`, `config/navigation.ts`, `config/libraries.ts`, `components/LibraryToolbar.vue`, `LibraryFilterPanel.vue`, `FolderTree.vue`, `BaseModelQuickFilter.vue` (D2), `composables/useLibraryFilters.ts`, `utils/browse.ts`, `api/endpoints.ts`, `pages/LibraryPage.vue`, `pages/RecipesPage.vue`, `themes/base.css`, `styles/tokens.css`, `components/icons.ts`; removed `TopBar.vue`, `AppMenu.vue`. Tests: `libraryToolbar.test.ts`, `listView.test.ts` (view switch cases), `branding.test.ts` (brand tile case), `api.test.ts`, NEW `tests/rail.test.ts`, NEW `tests/folderPanel.test.ts`, NEW `tests/filters.test.ts`.

**Maps to**: `d-template.html` lines 29-116 and 185-262; `extras.js` "rail", "search", "toolbar", "filters", "folders", "alphabet bar".

**Tasks**
0. Shells first (section 3b, hazard 1): rebuild `ModalShell.vue`, `ConfirmDialog.vue` and `BottomSheet.vue` on Dialog / AlertDialog / Sheet with unchanged props, slots and events (`busy` still blocks closing), one commit each; every dialog built on them inherits the change. Add `tooltip`, `sheet`, `alert-dialog`, `dropdown-menu` to `components/ui/`. `MenuButton.vue` moves to DropdownMenu (same `items` / `select` API).
1. `AppRail.vue` (`<nav aria-label>`): brand mark (link to `/loras`, `BrandMark` in `currentColor`, no accent tile), the four `NAV_TABS`, Updates (badge from `useUpdatesSummary`), Downloads (badge / paused state from `useDownloadQueue`), Statistics; spacer; Search, Appearance, Settings, Diagnostics, Classic UI link (`withMountPrefix('/loras')`). Every entry is an icon button with `aria-label`, a Tooltip (hover and focus), and `aria-current="page"` via `isNavActive`. Help / Notifications / Support buttons are added in Phase 5 with their dialogs (no dead buttons). Move the `useLikelyCountsTriggers()` call here. At `phone:` the rail renders as a bottom bar with the four libraries plus a "More" button that opens the remaining entries in the existing `BottomSheet`.
2. `GlobalSearchDialog.vue`: the existing `SearchCombobox` (`scope="all"`, `mode="global"`) inside a Dialog, opened by the rail Search button, `/` and Ctrl/Cmd+K (move `onShortcut`, `onCommit`, `onChoose` from `TopBar.vue` unchanged). This is the seed of the command palette (Phase 6).
3. `AppearancePopover.vue`: `ThemeOptions` in a Popover (focus in on open, back to the rail button on close come from the primitive).
4. `App.vue`: grid `rail | main` plus `StatusBar` at the bottom; the route-change focus rule checks `active.closest('nav')` instead of `header`. Delete `TopBar.vue`, `AppMenu.vue`, `--lm-topbar-height` and `--spacing-topbar` if no usage remains (grep first). Add `--lm-rail-width: 4rem` and `--lm-folders-width: 18.5rem` to `base.css`.
5. `FolderPanel.vue`: extract the `<aside>` that `LibraryPage.vue` and `RecipesPage.vue` duplicate. Header: title, New folder (existing `folderActions.run('create', path)`), Collapse all, View options (`MenuButton`: Tree / List, Include subfolders, and the existing folder actions). "Find a folder" input filters to matching paths. Own scroll container. Persist tree/list under `lm-ui.folders.view`. No counts and no "show empty" (the tree endpoint returns neither; Phase 9).
6. `FolderTree.vue`: lift `expanded` to a prop so Collapse all works; add a `flat` mode (full paths, no chevrons); switch to one tab stop with roving `tabindex`, Up / Down / Left / Right / Home / End, Enter selects, Shift+F10 / context-menu key keeps emitting `menu`. Keep `data-folder-path`, `data-folder-select` and the `menu` event signature.
7. `useLibraryFilters.ts`: add to `state` `recursive` (default true), `searchIn` (`filename`, `modelname` default on; `tags`, `creator`, `triggerWords` off), `tagLogic` (`any` | `all`), `modelTypes: string[]`, `creditRequired` and `allowSelling` (`null | true | false`), `letter` (`'' | string`). Extend `clear()`, `chips` (one removable chip each, including the excluded licence states), `panelCount`, `signature`, and `BrowseViewState` + `saveBrowseView` callers. Persist `searchIn`, `recursive` in `lm-ui.library.<prefix>` (validated on read like `view`).
8. `api/endpoints.ts`: extend `ModelListQuery` / `modelListParams` with `search_filename`, `search_modelname`, `search_tags`, `search_creator`, `search_trigger_words`, `tag_logic`, `model_type` (repeated), `credit_required`, `allow_selling_generated_content`, and for the letter `name_pattern_include` + `name_pattern_use_regex` (VERIFY the semantics in `py/services/lora_service.py` lines 100-140 first; offer the alphabet bar only where the service honours it). Send a parameter only when it differs from the backend default. Add cases to `tests/api.test.ts`.
9. `LibraryToolbar.vue`, one row: Folders toggle, search with a "Search in" button (`SearchOptions.vue`), Filters (count badge), spacer, View, Sort (a `MenuButton` with a check on the current entry, replacing the `<select>`), Quick view toggle (rendered from Phase 3), Select, `RefreshButton`, Tools, and the page's primary action through the existing `leading` slot (Download on model libraries, Import on recipes). The `h1` stays in the DOM as `sr-only`; the visible page name is the breadcrumb root. Phone layout (search + one button + `BottomSheet`) stays as it is and gains the new filter groups.
10. `FilterFlyout.vue`: a non-modal Popover with an `aria-label`, hosting the `filters` slot (`SearchOptions.vue` and `ViewPopover.vue` use Popover too). `LibraryFilterPanel.vue` groups: Presets, Base model, Tags with an Any / All radio pair, Model type, Licence (two rows, each a three-way radio: Any / Yes / No), Favourites only, Updates only (existing markup). Every option is a native checkbox or radio (`lm-check`), never a clickable div. Presets: name + save current + delete, stored in `lm-ui.fpresets.<prefix>` as `{ name, filters }[]`, validated on read.
11. `ViewPopover.vue`: Layout (grid / list, moved from the toolbar), Card size, Shape (Portrait / Square, see D5), Image (Fill / Whole image), Show on cards (name, base model, size and usage, favourite, version row, tags), Reset view. Stored in `lm-ui.library.<prefix>` next to `sort`. Shape, fit and "show" take effect in Phase 3; until then render only Layout and Card size.
12. `config/libraries.ts`: add `published:desc`, `published:asc`, `usage:asc`, `random` to `COMMON_SORTS` (VERIFY each against `py/services/model_cache.py` sort keys).
13. `FolderBreadcrumb.vue`: root "All <library>", one button per segment, a sibling menu per segment built from the loaded tree (reuse `ModelActionMenu`), result count on the right. `AlphabetBar.vue`: collapsed to one "A-Z" button by default (`lm-ui.alpha.open`), letters are toggle buttons (`aria-pressed`), no disabled letters (counts are Phase 9). Breadcrumb and alphabet share one row.
14. Rows above the grid, at most three: toolbar; context row (breadcrumb + alphabet); active-view row (existing chips row, reserved height). Apply D2 to the quick-filter row.
15. `StatusBar.vue`: result count (`aria-live="polite"`, moved from the toolbar), selection count, scan state from `useRefresh`, download queue summary. No "last sync" (no data source).

**Must not change**: routes, `meta.layout`, deep links, browse-state restore, refresh behaviour, phone bottom sheet, the `filters` / `quick` / `leading` / `selection` slots, folder context-menu flows (`createFolderActions` keeps the dry-run probe and danger confirm).

**Risks**: `LibraryPage.vue` is 1,016 lines with interleaved state: extract components without moving the `useModelActions` / `useModelTools` wiring. Tests mount `TopBar` (`branding.test.ts`) and assert toolbar structure (`libraryToolbar.test.ts`, `listView.test.ts`): rewrite those cases against `AppRail` / the new toolbar in the same commit, keeping the intent (labelled toolbar, `f` / `s` shortcuts, badge, view switch state).

**Acceptance**: three commands green. New tests: rail entries have names and `aria-current`; toggling a folder, "Include subfolders", Creator, Any/All, a model type, each licence state and a letter each change `filters.signature` and the query produced by `modelListParams`; an excluded licence appears in `chips` and `panelCount`; Collapse all closes every branch. User: at 1440, 1100, 900 and 375px nothing overlaps and page navigation is always reachable; folder tree scrolls on its own; at most three rows above the grid.

**Commits**: `feat(ui): icon rail and status bar replace the top bar`, `feat(ui): folder panel with find, collapse-all and breadcrumb`, `feat(ui): filter flyout, search options and view popover`, `test(ui): cover the new shell and filter state`, `docs(ui): describe the rail layout`, `build(ui): rebuild dist with the shell layout`.

### Phase 3: cards, rows, inspector, bulk bar

**Goal**: mock-up card and row design, quick-view panel, bottom bulk bar.

**Files**: `components/ModelCard.vue`, `ModelRow.vue`, `RecipeCard.vue`, `modelItemView.ts`, `composables/useCardInteractions.ts`, `utils/gridLayout.ts`, `VirtualGrid.vue`, `utils/rowColumns.ts`, `LibrarySelectionBar.vue`, `LibraryToolbar.vue`, `LibraryPage.vue`, `RecipesPage.vue`, NEW `components/ModelInspector.vue`, NEW `components/ListHeader.vue`; tests `listView.test.ts`, `rowColumns.test.ts`, `cardInteractions.test.ts`, `libraryToolbar.test.ts`, NEW `tests/inspector.test.ts`.

**Maps to**: `d-template.html` lines 118-176; `extras.css` "card extras", "bulk bar"; `extras.js` `item`, `bulkBar`, inspector part of `render`.

**Tasks**
1. Card: image box (border, `--lm-radius-md`, `object-fit` from the view option) with the base-model badge, update flag, state icons (favourite, excluded) on top and a hover / focus-within action bar at the bottom (Favourite, View on Civitai, Send, Copy syntax, More) on a flat `bg-scrim`; name and a meta line (size, usage count) below the image; optional version row. Always visible on `touch:`. Every icon button keeps `aria-label` plus `title`.
2. Grid maths: `gridMetrics` gets an `extraHeight` (px) for the text block below the image; `VirtualGrid` takes `aspect` and `extraHeight` props (computed by the page from the view options and the root font size) and re-measures when they change. Update `tests/listView.test.ts` ("keeps the card grid maths").
3. View options reach the items through one new prop `display` on `ModelItemViewProps` (`{ name, baseModel, meta, favorite, versionRow, tags, fit }`); both views declare it (the compile-time equality check enforces this).
4. Mature content: keep `isBlurred`; add a "Show" button on the blurred card that reveals that card only (in-memory Set in the page, like the lightbox).
5. Copy is one thing everywhere (review C3): the copy icon copies LoRA syntax (`workflow.copyLora`); trigger words are copied only by clicking a trigger-word chip.
6. `ModelRow.vue`: add Copy syntax for LoRAs; re-derive the column breakpoints in `utils/rowColumns.ts` (the test recomputes them from the widths) and express the container-query classes in rem so they follow the text scale. `ListHeader.vue`: a header row above the list with sortable Name / Size / Date buttons mapped to the existing sort values (`aria-sort`).
7. `ModelInspector.vue` (right panel, `--lm-inspector-width: 26rem`, toggle in the toolbar, state in `lm-ui.inspector`, hidden below 1280px): preview, name, file name, Send / Copy syntax / Open details, key facts (base model, folder, size, usage, update state), trigger words, tags (click filters). Trigger words: use `item.civitai?.trainedWords` when the list payload carries it (VERIFY: `ui/README.md` says the list payload has none), otherwise load `api.metadata(file_path)` lazily with `createRequestGuard` (`utils/drawerNav.ts`) and an abort on change.
8. Click model. A new `focused` key in the page. While the inspector is visible: click focuses the item (inspector follows), double-click / Enter opens the drawer. While it is hidden (default below 1280px and on touch): click opens the drawer as today. Implement in `useCardInteractions.activate`; extend `tests/cardInteractions.test.ts`. The focused card gets the selection outline (`ring-selected`); the update is in place.
9. `LibrarySelectionBar.vue` becomes a floating bar at the bottom of the grid section; the toolbar stays visible in selection mode. Keep count, "N not in view", All / None / Invert, Done; primary actions inline (Move, Add tags, Send, Delete), the rest behind "More" (`selectionMenu`). Add grid bottom padding while it shows. Update the "shows the selection bar instead of the toolbar row" test.
10. Remove `bg-scrim-fade` from `tokens.css` (Phase 1 task 5).

**Must not change**: card / row event names, long-press and context-menu behaviour, Ctrl/Cmd+click and Shift+click selection, video hover play, `LazyMedia` states.

**Risks**: row height changes break scroll restore and `scrollToIndex`: both go through `rowTop(metrics)`, so only `gridMetrics` may know about `extraHeight`. Inspector metadata requests while arrowing fast: guard + abort, never one request per hover.

**Acceptance**: three commands green; inspector test (follows focus, stale answers dropped, hidden state keeps click-to-open). User: selecting 200 cards with Shift+click stays instant and the scroll position does not move; XL text size keeps card text unclipped; list header sorts.

**Commits**: `feat(ui): card and row redesign with hover actions`, `feat(ui): quick-view inspector`, `feat(ui): bottom bulk bar`, `build(ui): rebuild dist with cards and inspector`.

### Phase 4: full-details flyout (from `ModelDrawer.vue`)

**Goal**: wide two-column flyout; a tab click swaps only the right pane.

**Files**: `components/ModelDrawer.vue`, `utils/drawer.ts`, `utils/drawerNav.ts`, `i18n/drawerMessages.ts`, `themes/base.css` (`--lm-drawer-width: min(76rem, 100vw)`), `RecipeDrawer.vue` (same shell classes only); tests `drawer.test.ts`, `drawerNav.test.ts`.

**Maps to**: `detail.js`, `detail.css`.

**Tasks**
1. Layout: header (title, position label + prev / next, close; second line Send to ComfyUI, View on Civitai, creator, licence flags, Favourite, More actions, Delete); body grid `26rem | 1fr`, stacking to one column below 980px.
2. Left column (always mounted, own scroll): Send block with strength, Info (version, file name, location, base model, size), Hashes and IDs, Usage tips, Trigger words, Tags, Notes, About this version. Reuse the existing blocks from the Overview panel; do not rewrite their logic.
3. Right column: tablist Examples (cover + thumbnails + generation data, moved out of Overview), Description, Versions, Recipes. Keep the current mechanism: all panels stay in the DOM with `v-show`, so a tab change re-renders nothing on the left and keeps `aria-controls` valid. Recipes tab: `GET /api/lm/recipes/for-lora` exists in `py/routes/recipe_route_registrar.py` (VERIFY parameters and add a typed call in `api/recipes.ts`); LoRAs only; a recipe opens `/recipes?open=<id>`.
4. Tabs: update `availableTabs`, `parseStoredTab`, `resolveTab` in `utils/drawerNav.ts` so a stored `overview` resolves to `examples`; update `tests/drawerNav.test.ts`.
5. Header Delete calls the existing `emit('action', 'delete')` path (confirm + 20 s Undo); header Send calls the existing send with the strength field. No handler-less buttons (review W4).
6. Inline edits only where `api.saveMetadata` already accepts the field (the drawer's existing save at `ModelDrawer.vue` line 382 shows the pattern); VERIFY `model_name`, `base_model`, `usage_tips` against `save_metadata` in `py/routes/handlers/model_handlers.py`. Anything else stays read-only and is listed for Phase 9.
7. Dialog semantics come from Sheet (side `right`): modal, labelled by the title (`SheetTitle`), focus in on open, return to the opening card, Tab trapped. Convert in the same phase everything the flyout opens above itself (section 3b, hazard 1): `ExampleLightbox.vue` and `ExampleImagesDialog.vue` shells to Dialog, and `ModelActionMenu.vue` internals to DropdownMenu (hazard 3). The close guard for unsaved notes hooks the Sheet's `update:open` / escape and outside-interaction events and keeps `shouldConfirmClose`. `RecipeDrawer.vue` gets the same Sheet shell.

**Must not change**: `?open=` sync, prev / next queueing and prefetch (`LibraryPage.navigateDrawer`), unsaved-notes confirm (`shouldConfirmClose`), version delete / replace / queue flows, `ExampleLightbox`, `ExampleImagesDialog`, touch targets, `defineExpose({ refresh, reloadVersions })`, emitted events.

**Risks**: 1,202-line component: move template blocks first with zero logic edits and run the tests, then restyle. `updateFlag.test.ts`, `updates.test.ts`, `versionManagement.test.ts` mount or reference the drawer: keep `data-testid`s.

**Acceptance**: three commands green. User: double-click or Enter opens the flyout; switching tabs does not flicker or reset the left column's scroll; arrow keys step models; Escape with dirty notes asks first; focus returns to the card.

**Commits**: `feat(ui): two-column details flyout`, `feat(ui): recipes tab in the details flyout`, `build(ui): rebuild dist with the details flyout`.

### Phase 5: dialogs, menus, toasts, pages

**Goal**: everything else matches the system; the rail gets Help, Notifications, Support.

**Files**: `ModalShell.vue`, `ConfirmDialog.vue`, `InputDialog.vue`, `BottomSheet.vue`, `ModelActionMenu.vue`, `MenuButton.vue`, `ToastHost.vue`, `StateBlock.vue`, `PageShell.vue`, all dialog components, `pages/SettingsPage.vue` + `components/settings/*`, `config/settingsTabs.ts`, `pages/StatsPage.vue` + `components/charts/*`, `DownloadsPage.vue`, `UpdatesPage.vue` + `Update*.vue`, `DoctorPage.vue`, `SearchPage.vue`, `RecipesPage.vue`, `RecipeCard.vue`, `RecipeDrawer.vue`, NEW `HelpDialog.vue`, `NotificationsDialog.vue`, `SupportDialog.vue`, NEW `config/shortcuts.ts`, `AppRail.vue`.

**Maps to**: `extras.css` "context + dropdown menus", "modal", "toasts"; `extras.js` "modals", `openSettings`, `openHelp`, `openNotif`, `openSupport`, `statsHtml`.

**Tasks**
1. Shared shells (on Reka since Phase 2): header / scrolling body / footer with a top border; menus get `max-height` + internal scroll so long menus never clip, and the long item menu is grouped with labels and submenus (Send: Append / Replace). Remaining native `<dialog>` users (`ReplaceChoiceDialog`, `NodePickerDialog`, any dialog not built on `ModalShell`) move to Dialog, then `tests/dialogStub.ts` and the backdrop half of `useDismiss.ts` are deleted if unused. Toasts: bottom centre; if D4 includes `vue-sonner`, `ToastHost.vue` becomes its `<Toaster>` (unstyled mode, token classes) behind the unchanged `useToasts()` API, keeping the "5 kept" cap and `UNDO_TOAST_MS`.
2. Delete safety is uniform (review C5): every destructive entry goes through `useConfirm({ danger: true })`; a toast offers Undo only when `useModelActions` returns batch ids. Folder delete already probes and confirms (`tools.deleteFolder`): do not add an Undo there.
3. Settings stays a page (D3). Restyle to the mock-up's left-nav + rows; `SettingsTabList.vue` keeps its ARIA tab behaviour. The Appearance card hosts the same `ThemeOptions`. Card settings have one owner (review L4): fields that the View popover now controls for the modern UI are not duplicated; the existing `classic-display` card stays labelled as classic-only. Rename the `group_by_model` label to "Collapse versions into one card" (review C1).
4. Statistics: metric tiles, tabs and bars per the mock-up using the Phase 1 series tokens. Downloads, Updates, Doctor, Search: token and spacing pass only.
5. `config/shortcuts.ts`: single list (keys, message key, scope) used by `HelpDialog.vue` and by `aria-keyshortcuts`, so Help never lists a shortcut that does not exist. Help: Shortcuts tab + links to the Wiki guides (plain external links, `rel="noopener noreferrer"`). Support: link list. Notifications: LoRA Manager version info from the data `AboutPanel.vue` already loads plus the session's toast history (see Phase 7 activity centre). Add the three rail buttons.
6. Recipes page and drawer: apply the card, toolbar, inspector-less layout of Phases 2-4.

**Must not change**: dialog submit logic, `busy` guards, the dismiss stack order, settings save semantics, any endpoint.

**Acceptance**: three commands green; `tests/dismiss.test.ts`, `settingsTabs.test.ts`, `downloadDialog.test.ts`, `recipes.test.ts`, `updates*.test.ts`, `b2b.test.ts` unchanged and green. User: open every dialog once in dark and light at M and XL.

**Commits**: `feat(ui): restyle dialogs, menus and toasts`, `feat(ui): restyle settings, statistics and maintenance pages`, `feat(ui): help, notifications and support dialogs`, `build(ui): rebuild dist with restyled dialogs and pages`.

### Phase 6: ship-first UX items and the accessibility pass

**6a. Active-view strip (#1).** The chips row becomes the single place for scope: folder, search, letter, model types, tags (with the Any/All state), licence states, favourites, updates, each removable, with the result count and one "Clear all" that calls `filters.clear()`. The row is visible exactly when `chips.length > 0` or to reserve height on desktop (review W5, L3). Test: `clear()` resets every field added in Phase 2.

**6b. Keyboard grid and one selection model (#2).** NEW `composables/useGridKeyboard.ts`: the grid is one tab stop (roving `tabindex` on the focused item's primary button, kept across virtual-row recycling by key, with `scrollToIndex` on move); arrows move by column count from `gridMetrics`; Home / End / PageUp / PageDown; Space toggles selection, Enter opens details, `S` send, `C` copy syntax, `F` favourite, `Delete` delete (confirm), `/` search. Merge the two models (review C6): `selectionMode` is derived as `selected.size > 0`; Ctrl/Cmd+click and Shift+click select without a mode switch; the Select button and bare `s` start an empty selection state that shows the bar; Escape closes overlays first, then clears the selection. Bare `s` currently toggles selection mode (`LibraryToolbar.vue`): inside the grid `S` means send, so move "select" to `B` (mock-up) and update `aria-keyshortcuts`, Help and `tests/libraryToolbar.test.ts`. Add `D` (download dialog), `?` (help), Ctrl+F (local search), Alt+letter (alphabet) through `shouldHandleShortcut`.

**6c. Strength-aware send, one verb (#3).** The verb is "Send to ComfyUI" everywhere (card, row, inspector, flyout, bulk bar, menus, toast): align `card.sendToComfy`, `detail.sendAppend`, `selection.send`, `workflow.appended` and friends. `useSendToWorkflow` already takes `strength` and falls back to `usage_tips` through `buildLoraSyntax`; show the effective strength on the inspector and flyout Send button and add a stepper in the inspector. Test in `tests/features.test.ts` or NEW: syntax uses the usage-tip strength, never a literal.

**6d. Real states (#4).** `StateBlock.vue` variants: empty library (first run, with links to Settings > Library and Download), empty folder, zero favourites, no match (Clear all), error with Retry; broken preview (existing `LazyMedia` fallback) and missing file badge when the payload exposes it (VERIFY); Civitai rate-limit / offline banner fed by `worker.rate_limited` (`useDownloadQueue`) and the 429 `retryAfter` of `/model-versions-status`, with Retry. Skeleton cards already exist.

**6e. Command palette (#5).** Adopt Command (`CommandDialog`, `CommandInput`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `CommandShortcut`) in `GlobalSearchDialog.vue` with its built-in filtering turned off for the async groups: groups Models / Recipes / Tags (existing suggester), Folders (loaded tree), Actions (from `config/shortcuts.ts` and the Tools entries), Settings (tabs and cards from `config/settingsTabs.ts`, using their `keywords`). Pure ranking in `utils/suggest.ts` style with tests.

**6f. Accessibility pass.** One checklist, each with a test where jsdom allows:
- Focus trap, initial focus and focus return: audit that no hand-built popover / dialog / flyout is left outside the Reka primitives (grep for `useDismissLayer` and `<dialog`); no shared helper is written.
- `ModelActionMenu`: Shift+F10 opens on the focused card; long menus scroll; arrow keys, typeahead and keyboard-reachable submenus come from DropdownMenu.
- Every icon-only button has `aria-label`; thumbnails, trigger-word chips and row stars are real buttons.
- Disabled controls use `aria-disabled` + muted token colour, never opacity below the 4.5:1 text threshold.
- Highlight clamp (Phase 0) is enforced in the picker UI with a visible note when a colour was adjusted.
- Reduced motion: `base.css` already zeroes the motion tokens; verify no component hard-codes a duration, and stop hover preview cycling (Phase 7) under `prefers-reduced-motion`.
- Toasts: timer pauses on hover and focus; action toasts are reachable by keyboard; Undo toasts stay for the full `UNDO_TOAST_MS` (from `vue-sonner` if adopted, otherwise hand-built in `useFeedback.ts` / `ToastHost.vue`).

**Acceptance**: three commands green; new tests for 6a-6e. User: operate the library without a mouse: Tab into the grid once, arrows, Space, Enter, Escape, Delete, Shift+F10.

**Commits**: `feat(ui): active-view strip with clear all`, `feat(ui): keyboard grid and merged selection`, `feat(ui): strength-aware send with one verb`, `feat(ui): empty, error and rate-limit states`, `feat(ui): command palette`, `fix(ui): accessibility pass for overlays, menus and toasts`, `build(ui): rebuild dist with the UX pass`.

### Phase 7: further frontend ideas

- **#6 Saved views**: upgrade `lm-ui.fpresets.<prefix>` to `lm-ui.views.<prefix>` (`{ name, filters, folder, search, sort, view }`, migrate on read), pinned above the folder tree. No counts (Phase 9).
- **#8 Compare**: selection of 2-4 opens NEW `CompareDialog.vue` (preview, base model, size, usage, trigger words, tags side by side) from the bulk bar.
- **#10 Health filters (frontend part)**: Statistics tiles link to filtered library views that existing parameters can express; the rest waits for Phase 9.
- **#12 Activity centre**: NEW `useActivity.ts` + `ActivityPanel.vue` merging scan state (`useRefresh`), download queue (`useDownloadQueue`), example-image and fetch-all progress (existing polling) and toast history; it replaces the Phase 5 notifications list.
- **#13 Narrow-window layout**: rail as a bar (done minimally in Phase 2), folder panel and inspector as overlay drawers with scrim and focus trap, toolbar overflow menu between 720 and 1100px.
- **#14 Recent and search history**: `lm-ui.recent` (last 20 opened items per library) and `lm-ui.search.history` (last 10 queries) shown in the search combobox when empty; "Clear history".
- **Card extras from the mock-up**: hover preview cycling (only with a data source that needs no extra request per card; otherwise defer), drag a card or the selection onto a folder (existing `moveModel` / `moveBulk`, confirm for more than one item, toast with a "Move back" action that issues the reverse move).
- **Bulk favourite / base model / rating**: client-side loops over `saveMetadata` / `setNsfwLevel` with concurrency 4, progress in the activity centre, partial-failure summary.

Each item is its own commit pair (`feat(ui): ...` + tests) and the phase ends with one `build(ui): rebuild dist ...`.

### Phase 8: later, with short specs

- **#7 Send tray**: a staging list (NEW `useSendTray.ts`, session memory) with per-LoRA strength, trigger-word toggles, syntax preview, Append / Replace, one `sendCode` call (`useSendToWorkflow.sendCode` already takes a ready code string). Entry points: card action with Alt, bulk bar "Add to tray". Open question: tray placement (inspector tab vs rail popover).
- **#9 Search tokens**: grammar `key:value`, `-key:value`, quoted values; keys `base`, `tag`, `type`, `folder`, `fav`, `update` map to existing parameters (`base_model`, `tag_include` / `tag_exclude`, `model_type`, `folder`, `favorites_only`, `update_available_only`); `used:` and `size:` need Phase 9. Pure parser NEW `utils/searchTokens.ts` with tests; autocomplete through `SearchCombobox`; parsed tokens show as chips in the active-view strip.

### Phase 9: backend track (separate PRs, each needs a decision)

| Item | Needed | Notes |
| --- | --- | --- |
| #11 Recently deleted | Longer-lived staging in `py/services/pending_delete_service.py` (TTL is 20 s today), list + restore + purge endpoints, a setting for retention | GET variants must be classified in `py/utils/request_guard.py`; sidecar paths via `py/utils/sidecar_paths.py` |
| #15 Dry-run + operation log | Dry-run flag and a persisted log for move / rename / organize / template / delete | Organize and template previews exist; unify |
| Last-sent timestamp | Field written by `update-lora-code` / usage stats, exposed in the list payload | Enables "recently sent" sort and filter |
| Facet counts | Counts per folder, letter, model type, licence for the current filter | Enables folder counts, disabled letters, "show empty folders" |
| Alphabet filter for all types | `name_pattern_*` (or a `first_letter` parameter) in the shared service | Today only `lora_service.py` |
| Group by | `sort_by` keys for base model and folder (grouping needs server order with paging) | Then group headers in `VirtualGrid` |
| New search fields / tokens | `used:`, `size:` ranges, health flags (no preview, no hash, no metadata, never used) | #9 and #10 |
| Bulk metadata endpoints | Bulk favourite / base model / rating | Replaces the Phase 7 client loops |
| Appearance sync across browsers | Optional: persist highlight / scale / views in backend settings | New keys go only in `DEFAULT_SETTINGS` (`py/services/settings_manager.py`), never in `settings.json.example` |
| Font MIME | Only if Phase 0 reports a refused font | `py/routes/modern_ui_routes.py` |

Rules for this phase: follow the repo `AGENTS.md` (endpoints used by the browser extension also accept GET; no outbound requests; `.civitai.info` is read-only; business paths, not `realpath`), add pytest coverage, and update the route tables in `ui/README.md`.

## 5. UX-review traceability

| # | Finding | Phase | Acceptance |
| --- | --- | --- | --- |
| W1 | Folder selection and "include subfolders" not applied | 2 | Folder and `recursive` change `signature` and the list query (test) |
| W2 | Licence include / exclude not applied; excluded missing from count and chips | 2, 6a | Both states sent; each has a chip and counts in `panelCount` (test) |
| W3 | Creator search option not applied | 2 | `search_creator=true` in the query (test) |
| W4 | Detail Delete / Send without handlers; `Del` missing | 4, 6b | Buttons run the existing flows; `Delete` on a focused card opens the confirm |
| W5 | "View is filtered" indicator never built | 6a | Strip visible whenever any scope is active |
| C1 | "Group by model" means two things | 5 | View says "Group by"; setting says "Collapse versions into one card" |
| C2 | Send named four ways | 6c | One verb in every message key that names the action |
| C3 | Copy icon copies different things | 3 | Icon = syntax everywhere; words via their chips |
| C4 | Strength hard-coded 0.8 | 6c | Strength from usage tips, shown on the button (test) |
| C5 | Uneven delete safety | 5 | Every delete confirms; Undo only when a batch id exists |
| C6 | Two selection models | 6b | One Set; Ctrl / Shift+click without a mode; Escape order tested |
| C7 | Danger red hard-coded, low contrast | 1 | One token family, `contrast.test.ts` pairs, no red literal |
| L1 | Up to five strips | 2 | At most three rows above the grid |
| L2 | Action bar mixes kinds | 2 | Toolbar groups: scope, view, mode, tools, primary action |
| L3 | Scope in six places, no global Clear | 6a | One strip, one Clear all |
| L4 | Card settings owned twice | 5 | View popover is the only owner for the modern UI |
| A1 | Every card a tab stop, no arrows, Space dead | 6b | One tab stop; arrows and Space work |
| A2 | Option divs without semantics; hidden tri-state | 2 | Native checkboxes / radios; licence as a labelled three-way choice |
| A3 | Menus: no focus, arrows, Shift+F10; clipping | 2, 4, 5 | Adopt DropdownMenu (arrows, typeahead, submenus); Shift+F10; scroll instead of clip |
| A4 | Modals / flyout without trap, initial focus, return, `aria-modal` | 2, 4, 5 | Adopt Dialog / AlertDialog / Sheet / Popover; smoke test per primitive |
| A5 | Icon-only buttons rely on `title`; non-focusable clickables | 2, 3, 6f | Adopt Tooltip; `aria-label` everywhere; real buttons |
| A6 | Contrast of dim text and disabled letters | 1, 6f | No sub-4.5 text level; no opacity-dimmed text |
| A7 | Highlight has no clamp and doubles as focus ring | 0 | `resolveHighlight` clamp; separate `--lm-color-focus` (tests) |
| A8 | Reduced motion only on the flyout | 6f | Token-based motion everywhere; cycling off |
| A9 | Undo toast: 5 s, no pause, no keyboard | 5, 6f | Adopt Sonner (or hand-build): pause on hover / focus; keyboard route |
| R1 | Narrow widths hide navigation | 2, 7 | Rail becomes a bar; overlays in #13 |
| R2 | Full re-render per click | 0-3 | Virtual grid kept; selection / focus in place (ground rule 5) |
| R3 | Font from Google Fonts | 0 | Bundled files; `fonts.test.ts` |
| R4 | List without headers, sort, send / copy | 3 | Header with `aria-sort`; Send, Copy, Favourite, More per row |
| Ideas 1-5 | | 6a-6e | Per sub-phase (#5 = adopt Command) |
| Ideas 6, 8, 10, 12, 13, 14 | | 7 | Per item |
| Ideas 7, 9 | | 8 | Spec only until scheduled |
| Ideas 11, 15, 10 (backend) | | 9 | Table above |

## 6. Existing tests that will move

| Test | Why | Phase |
| --- | --- | --- |
| `tests/themes.test.ts` | New storage keys in the bootstrap; theme list (D6) | 0, 1 |
| `tests/listView.test.ts` | rem tokens, `extraHeight`, view switch location, `display` prop | 0, 2, 3 |
| `tests/contrast.test.ts` | New pairs (info); thresholds unchanged | 1 |
| `tests/branding.test.ts` | Favicon colours; brand tile moves from `TopBar` to `AppRail` | 1, 2 |
| `tests/styleTokens.test.ts` | New gradient rule | 1 |
| `tests/libraryToolbar.test.ts` | Toolbar structure, flyout instead of inline panel, bulk bar position, `b` instead of `s` | 2, 3, 6b |
| `tests/api.test.ts` | New list parameters | 2 |
| `tests/rowColumns.test.ts` | Extra row button, rem breakpoints | 3 |
| `tests/cardInteractions.test.ts` | Focus vs open on click | 3 |
| `tests/drawer.test.ts`, `drawerNav.test.ts` | Tab ids | 4 |
| `tests/menuItems.test.ts` | Only if entries are added or relabelled | 5, 6c |
| `tests/dismiss.test.ts`, `tests/dialogStub.ts` | Reka layers leave the dismiss stack; stub removed with the last native `<dialog>` | 2, 4, 5 |
| Every test that mounts a dialog, menu or drawer (`downloadDialog`, `recipes`, `modelTools`, `updates*`, `versionManagement`, `b2b`, `refresh`) | Content is teleported: mount with `attachTo: document.body`, query the body | with each converted shell |
| `tests/pageLayout.test.ts` | Unchanged unless a route is added | - |

## 7. Performance and accessibility notes

- Selection and focus are `Set` / key refs read by `:selected` bindings on rendered rows only; never store selection on the items.
- `VirtualGrid` renders `visible` rows plus `overscan`; group headers, masonry ("Original" shape) and per-card observers are not compatible with its uniform rows (D5).
- Inspector and palette requests are aborted on change (`AbortSignal` is already threaded through `api.list`, `api.metadata`).
- The roving `tabindex` must survive row recycling: track the focused key, not the DOM node.
- Text scale XL (20px root) is the stress case for the toolbar (one row) and the row columns: check at 1280px.

## 8. Settings persistence summary

| Setting | Where | Key |
| --- | --- | --- |
| Theme, density (existing) | localStorage | `lm-ui.theme`, `lm-ui.theme.user`, `lm-ui.density` |
| Highlight, text size (NEW) | localStorage, applied pre-paint | `lm-ui.highlight`, `lm-ui.highlight.vars`, `lm-ui.scale` |
| Sort, card size, layout (existing) + shape, fit, show-on-cards, search-in, recursive (NEW) | localStorage, validated on read | `lm-ui.library.<prefix>` |
| Folder panel open (existing), tree / list, alphabet open, inspector open (NEW) | localStorage | `lm-ui.library.<prefix>.folders`, `lm-ui.folders.view`, `lm-ui.alpha.open`, `lm-ui.inspector` |
| Filter presets, saved views, recents, search history (NEW) | localStorage | `lm-ui.fpresets.<prefix>`, `lm-ui.views.<prefix>`, `lm-ui.recent`, `lm-ui.search.history` |
| Behaviour settings (blur, syntax format, trigger words, ...) | Backend, via `useAppSettings` / Settings page | unchanged |

The mock-up's own keys (`lm-ui-highlight`, `lm-ui-scale`, `lm-ui-view`, ...) are not used. Backend sync of appearance is a Phase 9 option.

## 9. Decisions needed from the user

| # | Question | Recommended default |
| --- | --- | --- |
| D1 | Geist files: the repo contains no Geist font. May the executor add the official Geist and Geist Mono variable `.woff2` files (SIL Open Font License 1.1, licence text committed next to them) to `ui/src/assets/fonts/`? Someone has to obtain the files once. | Yes; the user supplies the two files (or approves a one-time `bun add -d` of a font package to copy them from). Until then Phase 0 task 1 ships the system stack and everything else proceeds. |
| D2 | The base-model quick-filter row is a `ui/` extra that would be a fourth strip above the grid. | Fold it into the Filters flyout as the Base model group and keep the row behind a View option, default off. |
| D3 | Pages: (a) the mock-up's rail lists Other models / Workflows / Wildcards, which `ui/` does not have; (b) Settings and Doctor are modals in the mock-up but routed pages in `ui/` (deep-linkable tabs, sticky save bar). | (a) No rail entries now; the Classic UI link stays; building those pages is a separate project. (b) Keep them as pages, restyled; the rail buttons navigate. |
| D4 | New dependencies for the primitive layer (section 3b): `reka-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, optionally `vue-sonner`, plus copied shadcn-vue component source under `ui/src/components/ui/`. Today `ui/` has three runtime dependencies and "no UI kit". Everything is bundled into `ui/dist`: nothing is fetched at run time, so standalone / offline use is unaffected (fonts and icons are bundled too). | Yes, adopt incrementally (one surface per commit, classes rewritten to the `--lm-*` utilities, bundle growth recorded per phase). `vue-sonner`: yes, behind `useToasts()`. If declined, every "adopt X" task falls back to the hand-built variant on `useDismiss.ts`, and Phase 6f regains a shared focus-trap helper. |
| D5 | View options that the virtual grid cannot do yet: "Original" shape (needs masonry) and "Group by" (needs server ordering with paging). | Ship Portrait / Square now; leave both out of the popover until Phase 9 instead of showing dead controls. Charts: grey ramp + highlight; revert to the colour-blind-safe palette if a multi-series chart becomes unreadable. |
| D6 | The existing "Midnight" (navy + amber) built-in theme. | Remove it from `BUILTIN_THEMES` and ship its CSS as a documented user-theme example in `ui/README.md`; a stored `midnight` choice already falls back to the system default (`resolveThemeId`). Update `tests/themes.test.ts` accordingly. |

## 10. Coverage audit (after Phases 0-6)

Audit of the working tree against the mock-up, `ux-review.md`, the Phase 0-6 task lists and `git HEAD`. Closed in the same pass: full file path back in the details Info block; `Delete` in the details flyout; per-version "Open on Civitai" link; bulk "Mark as favorite" (client loop, concurrency 4) and "Copy LoRA syntax"; Ctrl/Cmd+A starts a selection; Tools > "Rebuild cache (full rescan)" (`scan?full_rebuild=true`); grid-background context menu; Undo on filter-preset delete; recipes page actions in the command palette.

Still open, front end only (Phase 7): drag a card onto a folder (the card surface is a `<button>`, and Firefox is known not to start a drag from a button inside a draggable element: needs a browser check before it ships), hover preview cycling (the list payload has no example images), bulk base model / content rating, a "Skip metadata refresh" toggle (the list payload carries `skip_metadata_refresh`; VERIFY that `save-metadata` accepts it), "View local versions" filter, saved views, compare, activity centre with progress panel, narrow-window overlays, recents and search history.

Needs the backend (Phase 9): folder counts and "show empty folders", disabled alphabet letters and the alphabet bar outside LoRAs, per-folder scan / update check, scan one root only, edit precision, link to a non-Civitai source, version-name / creator edit, sidecar location, AutoV3 hash, group by, "Original" shape.
