/**
 * Base-path handling.
 *
 * The backend serves the app at `<prefix>/lm-ui/` and injects a relative
 * `<base href>` into index.html, so `document.baseURI` always points at the
 * app root, whatever reverse-proxy prefix (llama-swap, SwarmUI, ...) sits in
 * front of ComfyUI. The API lives one level up: `<prefix>/api/lm/...`.
 *
 * In `vite dev` there is no injected <base>; the dev server mounts the app at
 * import.meta.env.BASE_URL ("/lm-ui/") on its own origin.
 */

export interface BasePaths {
  /** Absolute URL of the app root, always ending with "/". */
  appBase: string
  /** Path of the app root (router history base), e.g. "/comfy/lm-ui/". */
  appPath: string
  /** Reverse-proxy prefix in front of the backend routes, e.g. "/comfy" or "". */
  mountPrefix: string
}

export function computeBasePaths(baseUri: string, hasBaseElement: boolean, devBase?: string): BasePaths {
  const location = new URL(baseUri)
  const app = hasBaseElement || !devBase ? new URL('./', location) : new URL(devBase, location.origin)
  const mount = new URL('../', app)
  return {
    appBase: app.href,
    appPath: app.pathname,
    mountPrefix: mount.pathname.replace(/\/+$/, ''),
  }
}

let cached: BasePaths | null = null

export function basePaths(): BasePaths {
  if (!cached) {
    const hasBase = typeof document !== 'undefined' && !!document.querySelector('base[href]')
    const baseUri = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/lm-ui/'
    cached = computeBasePaths(baseUri, hasBase, import.meta.env.DEV ? import.meta.env.BASE_URL : undefined)
  }
  return cached
}

/** Test hook. */
export function setBasePathsForTesting(paths: BasePaths | null): void {
  cached = paths
}

/**
 * Prefix a backend root-absolute URL ("/api/lm/...", "/loras_static/...")
 * with the mount prefix. Absolute (http:, data:, blob:) and protocol-relative
 * URLs are returned unchanged.
 */
export function withMountPrefix(url: string, prefix = basePaths().mountPrefix): string {
  if (!url) return url
  if (url.startsWith('/') && !url.startsWith('//')) {
    if (prefix && (url === prefix || url.startsWith(prefix + '/'))) return url
    return prefix + url
  }
  return url
}

/** Resolve a URL relative to the app root ("user-themes/x.css"). */
export function appUrl(relative: string): string {
  return new URL(relative, basePaths().appBase).href
}
