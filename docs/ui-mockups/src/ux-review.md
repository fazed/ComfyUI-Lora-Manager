# UX review of mock-up D (from a read-only review of the sources)

## Problems in the mock-up
Wiring gaps
- Folder selection does not filter the grid; `rowsNow()` ignores `curFold` and the "include subfolders" option.
- Licence include/exclude is not applied, and excluded options are missing from the filter count and chips.
- The "Creator" search option is offered but not applied.
- Detail header: Delete and "Send to ComfyUI" have no handlers; the `Del` shortcut listed in Help is not implemented.
- `hasF` is computed in `render()` and unused (the intended "view is filtered" indicator was never built).

Consistency
- "Group by model" means two things (View panel: group by base model; Settings: collapse versions into one card).
- Send is named four ways: "Send to workflow", "Send to ComfyUI", "Send", "Added to ComfyUI". Pick one verb.
- The copy icon copies LoRA syntax on cards but trigger words in the inspector.
- Strength is hardcoded to 0.8 in every copy/send although the detail flyout has a per-model strength.
- Delete safety is uneven: model delete has confirm + undo; folder delete has no confirm and claims an undo that does not exist.
- Two selection models: single `sel` and bulk `SELS`; Ctrl/Shift+click do nothing outside bulk mode; Esc discards the selection.
- Danger red is hardcoded in about eight places with no token; estimated ~2.8:1 contrast on the light theme.

Clutter
- Up to five strips above the grid (toolbar, action bar, banners, breadcrumb, alphabet bar).
- The action bar mixes actions, filters, a mode and a tool in one identical button style.
- Active scope is spread over six places; a single "Clear" exists only in the empty state.
- Card settings are owned twice (View panel and Settings > Interface).

Keyboard and accessibility
- Every card is a tab stop (1,000+), no arrow-key movement, Space does nothing.
- Filter/View/Search-in options are click-only divs without role, aria-checked or tabindex; licence tri-state is undiscoverable.
- Context menus: no focus move, no arrow keys, no Shift+F10, submenus hover-only; the 17-item card menu clips on short windows.
- Modals and the detail flyout: no focus trap, no initial focus, no focus return, no aria-modal on the detail dialog.
- Icon-only buttons rely on `title` only; thumbnails, trigger-word chips and the list-row star are clickable but not focusable.
- Contrast: `--text-3` at small sizes is about 4.3:1 on panels (3.7:1 on hover); light theme muted text about 4.2:1; disabled letters at opacity .28.
- A custom highlight has no contrast clamp; `--hi` is also the focus ring and selection outline, so a dark pick vanishes on the dark theme.
- Reduced motion is honoured only for the detail flyout, not for hover preview cycling or other transitions.
- Undo toast lasts 5 s with no pause on hover/focus and no keyboard route to Undo.

Responsive and performance
- Narrow breakpoints just hide the rail/folders/inspector: below 640px there is no page navigation and the toggles are dead.
- `render()` rebuilds the whole grid and inspector on every click/keystroke; the real app has a virtual scroller, which must be kept and selection must update in place.
- The mock-up loads Geist from Google Fonts; a local-first tool must bundle fonts or use a system stack.
- List layout has no column headers, no click-to-sort and no send/copy actions.

## Ideas (ordered by value/effort; * = ship first)
1.* One "active view" strip: every scope as a removable chip (folder, search, letter, type, favourites, updates, excluded licences) with result count and Clear all; move Favorites/Updates/Duplicates into Filters. S, low, frontend.
2.* Keyboard grid: roving tabindex + arrow keys; Space select, Enter open, S send, C copy syntax, F favourite, Del delete, / search; Ctrl/Shift+click select without a mode switch (merge sel and SELS). S-M, low, frontend.
3.* Strength-aware send: use the model's usage-tip strength instead of 0.8, show it on the button, small stepper in the inspector; one verb "Send to ComfyUI". S, low, frontend.
4.* Real states: skeleton cards during scan, broken-preview and missing-file states, empty folder / zero favourites, first-run flow, Civitai rate-limit/offline banner with retry. S, low, mostly frontend.
5.* Command palette (Ctrl K) for models, folders, actions, settings. M, low, frontend + existing search API.
6. Saved views: extend filter presets to folder, search, sort, view options; pin above the folder tree with counts. M, low.
7. Send tray: stage several LoRAs, per-LoRA strength, trigger words, syntax preview, append/replace, send once. M, med.
8. Compare 2-4 models side by side. M, low, frontend.
9. Search tokens (`base:anima tag:style -tag:x used:0 size:>200`) with autocomplete. M, med.
10. Library-health smart filters (never used, no preview, no trigger words, no metadata, no hash); clickable Statistics tiles. S-M.
11. Recently deleted (restorable trash). M, med, backend.
12. Activity centre merging progress, scan status, notifications, toast history. M, low-med.
13. Narrow-window layout: rail to bar, folders/inspector as overlay drawers, toolbar overflow menu. M, low.
14. Recent entries and search history. S-M.
15. Dry-run + operation log for all bulk writes. M, med, backend.

Also a fix, not an idea: one accessibility pass (focus trap/return, menu keyboard support, real checkbox semantics, aria-labels, `--danger` token, contrast clamp on the highlight picker, global reduced-motion), alongside idea 2.
