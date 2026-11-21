/**
 * Fork-local: choose between the modern LoRA Manager UI (`/lm-ui/`, see
 * ui/README.md) and the classic UI (`/loras`) for the ComfyUI top-bar button
 * and the "full details" / recipe deep links of the canvas panels.
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

const MODEL_TYPES = new Set(["loras", "checkpoints", "embeddings"]);

/**
 * Pure: the page path that opens one model (`?open=` on the modern library
 * route, `#model=` on the classic page). An empty path opens the bare library.
 * The modern UI matches `?open=` exactly against the library's `file_path`,
 * which the cache stores with forward slashes, so backslashes are normalized
 * for it; the classic link keeps the path untouched.
 */
export function modelDeepLinkPath(filePath, modernAvailable, modelType = "loras") {
  const type = MODEL_TYPES.has(modelType) ? modelType : "loras";
  const path = filePath ? String(filePath) : "";
  if (modernAvailable === true) {
    const base = `${MODERN_UI_PATH}${type}`;
    return path ? `${base}?open=${encodeURIComponent(path.replace(/\\/g, "/"))}` : base;
  }
  return path ? `/${type}#model=${encodeURIComponent(path)}` : `/${type}`;
}

/** Pure: the page path that opens one recipe (`?open=<id>` modern, `#recipe=<id>` classic). */
export function recipeDeepLinkPath(recipeId, modernAvailable) {
  const id = recipeId ? String(recipeId) : "";
  if (modernAvailable === true) {
    const base = `${MODERN_UI_PATH}recipes`;
    return id ? `${base}?open=${encodeURIComponent(id)}` : base;
  }
  return id ? `/loras/recipes#recipe=${encodeURIComponent(id)}` : "/loras/recipes";
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
