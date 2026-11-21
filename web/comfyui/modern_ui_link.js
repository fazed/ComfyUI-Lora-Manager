/**
 * Fork-local: choose between the modern LoRA Manager UI (`/lm-ui/`, see
 * ui/README.md) and the classic UI (`/loras`) for the ComfyUI top-bar button.
 *
 * The modern UI only works when `ui/dist` has been built; otherwise the
 * backend answers `/lm-ui/` with 503 (or 404 on a backend without the route).
 * A single HEAD probe per page load decides; until it has answered, and
 * whenever it fails, the classic UI is used, because it always exists.
 * The probe runs ahead of the click so the click can call `window.open`
 * synchronously (no popup-blocker trouble).
 */
import { lmUrl } from "./base_path.js";

export const MODERN_UI_PATH = "/lm-ui/";
export const CLASSIC_UI_PATH = "/loras";

let availability = null; // null = unknown, true/false once probed
let probePromise = null;

/** Pure: the manager home path for a probe result (`null` = not known yet). */
export function managerHomePath(modernAvailable) {
  return modernAvailable === true ? MODERN_UI_PATH : CLASSIC_UI_PATH;
}

/** Probe `/lm-ui/` once per page load; resolves to `true` when it is served. */
export function probeModernUi(fetchFn = globalThis.fetch) {
  if (!probePromise) {
    probePromise = Promise.resolve()
      .then(() => fetchFn(lmUrl(MODERN_UI_PATH), { method: "HEAD", cache: "no-store" }))
      .then((response) => Boolean(response?.ok))
      .catch(() => false)
      .then((available) => {
        availability = available;
        return available;
      });
  }
  return probePromise;
}

/** Synchronous view of the probe result: `true`, `false` or `null` (pending). */
export function modernUiAvailability() {
  return availability;
}

/** Test helper: forget the cached probe. */
export function resetModernUiProbe() {
  availability = null;
  probePromise = null;
}
