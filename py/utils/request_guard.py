"""Request guard for state-changing GET routes (cross-site request forgery).

Several LoRA Manager routes change state or start work on ``GET`` because the
browser extension can only use ``GET`` against ComfyUI (ComfyUI's origin
middleware rejects its non-GET requests).

Current ComfyUI's ``origin_only_middleware`` already returns 403 on every
method for ``Sec-Fetch-Site: cross-site`` and for a loopback ``Host`` whose
``Origin`` host differs, so a cross-site ``<img src>`` from a modern browser
is blocked before it reaches LoRA Manager. This guard is defence in depth
for older ComfyUI versions without that middleware (or ComfyUI started with
``--enable-cors-header``, which replaces it), standalone mode (no ComfyUI
middleware), ``same-site`` requests from another local port, and future
changes. DNS rebinding is handled by ``py/utils/host_guard.py``.

This module holds:

* the **explicit registry** of guarded GET routes (:data:`GUARDED_GET_ROUTES`)
  and of read-only GET routes that stay open (:data:`READ_ONLY_GET_ROUTES`),
  each with a one-line reason. ``tests/security/test_request_guard_routes.py``
  enumerates every registered GET route and fails for one that is in neither
  list, so a new route cannot silently be unsafe;
* the pure decision function :func:`evaluate_request`;
* the aiohttp middlewares :data:`request_guard` (ComfyUI mode, registered in
  ``py/lora_manager.py``) and :data:`standalone_request_guard` (``standalone.py``).
  The standalone one also applies :func:`evaluate_request` to every non-safe
  method (``POST``, ``PUT``, ``PATCH``, ``DELETE`` ...) on every route,
  because standalone mode has no ComfyUI origin middleware.

Protocol (documented in ``ui/README.md``, "Request guard for state-changing
GET routes"). For a ``GET``/``HEAD`` request to a guarded route (and, in
standalone mode, any non-safe request):

1. ``Sec-Fetch-Site`` is ``same-origin`` or ``none``: allow (a same-origin
   page, or a user-initiated / extension request). Browsers set this header;
   page script cannot forge it.
2. ``Origin`` has the scheme ``chrome-extension``, ``moz-extension`` or
   ``safari-web-extension``: allow. A web page can never send such an Origin,
   so it proves an extension context. This is how the browser extension is
   admitted: it sends no custom header (a custom header on a GET can trigger
   a CORS preflight that ComfyUI does not answer).
3. ``X-LM-Client`` carries a client id (``lm-ui``, ``lm-classic`` for the
   in-repo same-origin web clients ...) and ``Origin`` is absent or equals
   the request's own origin: allow. A page on another site always sends its
   own ``Origin`` with a custom header (CORS), so it can never satisfy this,
   even when ComfyUI answers CORS for any origin.
4. Neither ``Sec-Fetch-Site`` nor ``Origin`` is present: allow (a non-browser
   client such as curl or a script, not a CSRF vector).
5. Anything else: reject with HTTP 403
   ``{"success": false, "error": "...", "code": "csrf_blocked"}``.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Awaitable, Callable, Mapping, Optional
from urllib.parse import urlsplit

from aiohttp import web

logger = logging.getLogger(__name__)

CLIENT_HEADER = "X-LM-Client"
BLOCKED_CODE = "csrf_blocked"
BLOCKED_STATUS = 403
BLOCKED_ERROR = (
    "Cross-site request blocked by LoRA Manager: state-changing requests must "
    "come from the LoRA Manager web interface or from a browser extension or "
    "tool that is not a web page on another site."
)

#: Documented client ids. Any short token is accepted (see ``_CLIENT_ID_RE``);
#: these are the ones the in-repo clients and the browser extension send.
KNOWN_CLIENT_IDS = frozenset({"lm-ui", "lm-classic", "lm-comfyui", "lm-extension"})

EXTENSION_ORIGIN_SCHEMES = frozenset(
    {"chrome-extension", "moz-extension", "safari-web-extension"}
)

_ALLOWED_FETCH_SITES = frozenset({"same-origin", "none"})
_GUARDED_METHODS = frozenset({"GET", "HEAD"})
#: Methods never guarded. Every other method is "non-safe" and guarded in
#: standalone mode (POST, PUT, PATCH, DELETE, and anything unusual).
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "TRACE"})
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


# ---------------------------------------------------------------------------
# Route registry
#
# Keys are route templates as aiohttp reports them in
# ``resource.canonical``; ``{prefix}`` stands for any single path segment (the
# model-type prefix: loras, checkpoints, embeddings, other, wildcards,
# workflows, recipes ...). Other ``{name}`` placeholders match literally,
# because the canonical form keeps them (``/api/lm/recipe/{recipe_id}/share``).
# A route matching any guarded template is guarded, even if it also matches a
# read-only one (fail closed).
# ---------------------------------------------------------------------------

GUARDED_GET_ROUTES: Mapping[str, str] = {
    # Downloads (started, controlled or recorded through GET for the extension)
    "/api/lm/download-model-get": "starts a model download",
    "/api/lm/cancel-download-get": "cancels a running download",
    "/api/lm/skip-download": "skips a running download",
    "/api/lm/pause-download": "pauses a running download",
    "/api/lm/resume-download": "resumes a paused download",
    "/api/lm/downloads/queue/add": "adds a download to the persistent queue (the worker starts it)",
    "/api/lm/downloads/queue/remove": "removes a queue item",
    "/api/lm/downloads/queue/move-to-top": "reorders the queue",
    "/api/lm/downloads/queue/move-to-end": "reorders the queue",
    "/api/lm/downloads/queue/clear": "clears queue items",
    "/api/lm/downloads/queue/pause-all": "pauses the queue worker (persisted)",
    "/api/lm/downloads/queue/resume-all": "resumes the queue worker",
    "/api/lm/downloads/queue/complete": "moves a queue item to history with a client-supplied status and file_path",
    "/api/lm/downloads/queue/status": "changes a queue item's status",
    "/api/lm/downloads/history/clear": "clears download history",
    "/api/lm/downloads/history/delete": "deletes a history entry",
    "/api/lm/downloads/history/retry": "re-queues (and may start) a failed download",
    "/api/lm/downloads/history/retry-all": "re-queues every failed download",
    "/api/lm/set-model-version-download-status": "marks a version downloaded/deleted in the download history",
    "/api/lm/delete-model-version": "deletes a model version's files",
    # Library maintenance
    "/api/lm/{prefix}/scan": "rescans a library (also /api/lm/recipes/scan)",
    "/api/lm/recipes/scan": "rescans the recipe library",
    "/api/lm/{prefix}/forget-folder": "drops a folder from the library state",
    "/api/lm/{prefix}/auto-organize": "moves model files",
    "/api/lm/{prefix}/apply-filename-template": "renames model files",
    "/api/lm/first-scan/start": "starts the initial library scan",
    "/api/lm/sidecars/migrate": "migrates sidecar files on disk",
    # Recipes
    "/api/lm/recipes/import-remote": "downloads an image and creates a recipe",
    "/api/lm/recipes/import-from-url": "downloads an image and creates a recipe",
    "/api/lm/recipe/{recipe_id}/reimport": "deletes and re-imports a recipe",
    "/api/lm/recipe/{recipe_id}/share": "writes a temporary shared copy of a recipe image",
    # ComfyUI workflow / node state
    "/api/lm/workflows/send-to-comfy": "loads a library workflow into the open ComfyUI graph",
    "/api/lm/update-lora-code": "writes LoRA syntax into ComfyUI nodes",
    "/api/lm/update-node-widget": "writes a widget value into ComfyUI nodes",
}

READ_ONLY_GET_ROUTES: Mapping[str, str] = {
    # Pages, static files, websockets
    "/": "standalone root: redirect to /loras",
    "/loras": "classic manager page",
    "/checkpoints": "classic manager page",
    "/embeddings": "classic manager page",
    "/other": "classic manager page",
    "/wildcards": "classic manager page",
    "/workflows": "classic manager page",
    "/statistics": "classic statistics page",
    "/lm-ui": "redirect to the modern UI",
    "/loras/recipes": "classic recipes page",
    "/lm-ui/{tail}": "modern UI files",
    "/loras_static": "static plugin assets",
    "/locales": "static locale files",
    "/example_images_static": "static example images",
    "/ws/fetch-progress": "progress websocket (read-only event stream)",
    "/ws/download-progress": "download progress websocket (read-only event stream)",
    "/ws/init-progress": "init progress websocket (read-only event stream)",
    "/ws/batch-import-progress": "batch import progress websocket (read-only event stream)",
    # Model library reads (per model type)
    "/api/lm/{prefix}/list": "lists models",
    "/api/lm/{prefix}/excluded": "lists excluded models",
    "/api/lm/{prefix}/auto-organize-progress": "reports auto-organize progress",
    "/api/lm/{prefix}/top-tags": "reads tag counts",
    "/api/lm/{prefix}/search-tags": "searches tags",
    "/api/lm/{prefix}/base-models": "reads base model counts",
    "/api/lm/{prefix}/model-types": "reads model types",
    "/api/lm/{prefix}/roots": "reads library roots",
    "/api/lm/{prefix}/folders": "reads folders",
    "/api/lm/{prefix}/resolve-folder": "resolves a folder path",
    "/api/lm/{prefix}/folder-tree": "reads the folder tree",
    "/api/lm/{prefix}/unified-folder-tree": "reads the folder tree",
    "/api/lm/{prefix}/find-duplicates": "reports duplicates",
    "/api/lm/{prefix}/find-filename-conflicts": "reports file name conflicts",
    "/api/lm/{prefix}/get-notes": "reads notes",
    "/api/lm/{prefix}/preview-url": "reads a preview URL",
    "/api/lm/{prefix}/civitai-url": "reads a Civitai URL",
    "/api/lm/{prefix}/metadata": "reads model metadata",
    "/api/lm/{prefix}/model-description": "reads a model description",
    "/api/lm/{prefix}/relative-paths": "reads relative paths",
    "/api/lm/{prefix}/active-filters": "reads saved filters (changes go through PUT)",
    "/api/lm/{prefix}/civitai/versions/{model_id}": "reads Civitai versions",
    "/api/lm/{prefix}/civitai/model/version/{modelVersionId}": "reads a Civitai version",
    "/api/lm/{prefix}/civitai/model/hash/{hash}": "reads a Civitai model by hash",
    "/api/lm/{prefix}/updates/status/{model_id}": "reads an update record; refresh=1 only re-fetches Civitai data into the cache",
    "/api/lm/{prefix}/updates/versions/{model_id}": "reads an update record; refresh=1 only re-fetches Civitai data into the cache",
    "/api/lm/{prefix}/updates/overview": "reads the updates overview",
    "/api/lm/{prefix}/updates/old-versions": "reads owned older versions per model line (scanner cache + records)",
    "/api/lm/{prefix}/info/{name}": "reads model info",
    "/api/lm/wildcards/content": "reads wildcard file content",
    "/api/lm/wildcards/entries": "reads wildcard entries",
    "/api/lm/wildcards/active": "reads active wildcards",
    "/api/lm/workflows/content": "reads workflow file content",
    "/api/lm/workflows/link-status": "reads workflow link status",
    "/api/lm/workflows/comfyui-state": "reads LM-linked workflows open in ComfyUI",
    "/api/lm/checkpoints/checkpoints_roots": "reads checkpoint roots",
    "/api/lm/checkpoints/unet_roots": "reads unet roots",
    "/api/lm/checkpoints/loader-pool": "reads the loader pool",
    "/api/lm/other/roots_by_subtype": "reads other-model roots",
    "/api/lm/loras/block-weight-schema": "reads the block-weight schema",
    "/api/lm/loras/details": "reads LoRA details",
    "/api/lm/loras/folder-index": "reads the LoRA folder index",
    "/api/lm/loras/get-trigger-words": "reads trigger words",
    "/api/lm/loras/letter-counts": "reads letter counts",
    "/api/lm/loras/usage-tips-by-path": "reads usage tips",
    # Downloads (reads)
    "/api/lm/download-progress/{download_id}": "reads download progress",
    "/api/lm/downloads/queue": "reads the queue",
    "/api/lm/downloads/history": "reads download history",
    "/api/lm/downloads/stats": "reads download stats",
    "/api/lm/model-version-download-status": "reads a version's download status",
    "/api/lm/model-versions-status": "reads version status; refresh=1 only re-fetches Civitai data into the cache",
    "/api/lm/check-model-exists": "reads library membership",
    "/api/lm/check-models-exist": "reads library membership",
    # Recipes (reads)
    "/api/lm/recipes": "lists recipes",
    "/api/lm/recipe/{recipe_id}": "reads a recipe",
    "/api/lm/recipe/{recipe_id}/syntax": "reads recipe syntax",
    "/api/lm/recipe/{recipe_id}/share/download": "serves an already prepared shared copy",
    "/api/lm/recipe/{recipe_id}/lora/{lora_index}/reconnect-suggestions": "reads suggestions",
    "/api/lm/recipe/{recipe_id}/checkpoint/reconnect-suggestions": "reads suggestions",
    "/api/lm/recipes/batch-import/progress": "reads batch import progress",
    "/api/lm/recipes/rematch-progress": "reads rematch progress",
    "/api/lm/recipes/check-image-exists": "reads whether an image is imported",
    "/api/lm/recipes/for-lora": "lists recipes using a LoRA",
    "/api/lm/recipes/for-checkpoint": "lists recipes using a checkpoint",
    # App, settings, misc reads
    "/api/lm/settings": "reads settings (changes go through POST)",
    "/api/lm/llm/models": "reads the LLM model catalog",
    "/api/lm/llm/provider-models": "reads an LLM provider's models",
    "/api/lm/doctor/diagnostics": "reads diagnostics (repairs go through POST)",
    "/api/lm/environment": "reads environment info",
    "/api/lm/priority-tags": "reads priority tags",
    "/api/lm/health-check": "liveness probe",
    "/api/lm/init-status": "reads init status",
    "/api/lm/first-run-info": "reads first-run info",
    "/api/lm/metadata-fetch-candidates": "reads metadata-fetch candidates",
    "/api/lm/supporters": "reads supporters",
    "/api/lm/wildcards/search": "searches wildcards",
    "/api/lm/get-usage-stats": "reads usage stats",
    "/api/lm/trained-words": "reads trained words",
    "/api/lm/model-example-files": "reads example files",
    "/api/lm/get-registry": "reads the ComfyUI node registry (may ask open tabs to report)",
    "/api/lm/creators": "reads creators",
    "/api/lm/civitai/user-models": "reads a Civitai user's models",
    "/api/lm/metadata-archive-status": "reads archive status",
    "/api/lm/backup/status": "reads backup status",
    "/api/lm/custom-words/search": "searches custom words",
    "/api/lm/example-workflows": "lists example workflows",
    "/api/lm/example-workflows/{filename}": "reads an example workflow",
    "/api/lm/base-models": "reads base models",
    "/api/lm/base-models/categories": "reads base model categories",
    "/api/lm/base-models/cache-status": "reads base model cache status",
    "/api/lm/model-source-files": "lists files of a remote repository",
    "/api/lm/hf-repo-files": "lists files of a remote repository (legacy alias)",
    "/api/lm/model-sources": "reads supported model sources",
    "/api/lm/agent/skills": "lists agent skills",
    "/api/lm/example-images-status": "reads example-image download status",
    "/api/lm/example-image-files": "lists example image files",
    "/api/lm/has-example-images": "reads whether example images exist",
    "/api/lm/previews": "serves a preview file",
    "/api/lm/check-updates": "reads version info from GitHub",
    "/api/lm/version-info": "reads version info",
    "/api/lm/ui/themes": "lists modern UI themes",
    "/api/lm/stats/collection-overview": "reads statistics",
    "/api/lm/stats/usage-analytics": "reads statistics",
    "/api/lm/stats/model-usage-list": "reads statistics",
    "/api/lm/stats/base-model-distribution": "reads statistics",
    "/api/lm/stats/tag-analytics": "reads statistics",
    "/api/lm/stats/storage-analytics": "reads statistics",
    "/api/lm/stats/insights": "reads statistics",
}


#: Standalone mode guards every non-safe method on every route. Templates
#: listed here (same syntax as above) would stay open for non-safe methods;
#: none are needed today. ``tests/security/test_request_guard_routes.py``
#: enumerates the non-GET routes and fails on a stale entry.
UNSAFE_METHOD_EXEMPTIONS: Mapping[str, str] = {}


def _template_regex(template: str) -> re.Pattern[str]:
    pattern = re.escape(template).replace(re.escape("{prefix}"), "[^/]+")
    return re.compile(f"^{pattern}$")


_GUARDED_PATTERNS = tuple(_template_regex(t) for t in GUARDED_GET_ROUTES)


@lru_cache(maxsize=1024)
def is_guarded_route(canonical: str) -> bool:
    """Return True when the route template *canonical* is guarded."""

    if not canonical.startswith("/api/lm/"):
        return False
    return any(pattern.match(canonical) for pattern in _GUARDED_PATTERNS)


def matching_templates(canonical: str, registry: Mapping[str, str]) -> list[str]:
    """Templates of *registry* that match *canonical* (used by the tests)."""

    return [t for t in registry if _template_regex(t).match(canonical)]


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GuardDecision:
    allowed: bool
    reason: str


def _normalize_host(netloc: str, scheme: str) -> Optional[str]:
    """``host[:port]`` lower-cased, default port dropped; None when unusable."""

    if not netloc:
        return None
    try:
        parts = urlsplit(f"//{netloc}")
        hostname = parts.hostname
        port = parts.port
    except ValueError:
        return None
    if not hostname:
        return None
    hostname = hostname.lower()
    if ":" in hostname:  # IPv6 literal
        hostname = f"[{hostname}]"
    default = {"http": 80, "https": 443}.get(scheme.lower())
    if port is None or port == default:
        return hostname
    return f"{hostname}:{port}"


def origin_matches_host(origin: str, host: Optional[str], scheme: str = "http") -> bool:
    """True when *origin* names the same host (and port) the request was sent to.

    The scheme is not compared: behind a TLS-terminating proxy the backend
    sees ``http`` while the page origin is ``https``; the host is what a
    foreign site cannot fake.
    """

    if not host:
        return False
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return False
    origin_host = _normalize_host(parts.netloc, parts.scheme)
    request_host = _normalize_host(host, parts.scheme)
    return origin_host is not None and origin_host == request_host


def _origin_scheme(origin: str) -> str:
    try:
        return urlsplit(origin).scheme.lower()
    except ValueError:
        return ""


def valid_client_id(value: Optional[str]) -> bool:
    return bool(value) and bool(_CLIENT_ID_RE.match(value.strip()))  # type: ignore[union-attr]


def evaluate_request(
    *,
    sec_fetch_site: Optional[str],
    origin: Optional[str],
    client_header: Optional[str],
    host: Optional[str],
    scheme: str = "http",
) -> GuardDecision:
    """Decide whether a request to a guarded GET route may proceed.

    Header values are passed as received (``None`` when absent). Pure
    function: the middleware and the tests share it.
    """

    site = sec_fetch_site.strip().lower() if sec_fetch_site is not None else None
    origin_value = origin.strip() if origin is not None else None
    if origin_value == "":
        origin_value = None

    if site in _ALLOWED_FETCH_SITES:
        return GuardDecision(True, f"sec-fetch-site:{site}")

    if origin_value is not None and _origin_scheme(origin_value) in EXTENSION_ORIGIN_SCHEMES:
        return GuardDecision(True, "extension-origin")

    if valid_client_id(client_header):
        if origin_value is None:
            return GuardDecision(True, "client-header")
        if origin_matches_host(origin_value, host, scheme):
            return GuardDecision(True, "client-header-same-origin")
        return GuardDecision(False, "client-header-foreign-origin")

    if site is None and origin_value is None:
        return GuardDecision(True, "non-browser")

    return GuardDecision(False, "cross-site-without-client-header")


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

_LOGGED_KEYS: set[str] = set()
_LOGGED_KEYS_LIMIT = 256


def _log_block_once(request: web.Request, decision: GuardDecision) -> None:
    origin = request.headers.get("Origin") or "<no origin>"
    site = request.headers.get("Sec-Fetch-Site") or "<missing>"
    key = f"{origin}|{site}"
    # Hint for web clients served from the backend's own origin only; the
    # browser extension must not send a custom header (it is admitted by its
    # extension-scheme Origin or Sec-Fetch-Site: none).
    logger.debug(
        "Request guard blocked %s %s (origin=%s, sec-fetch-site=%s, reason=%s). "
        "A web client served from the backend's own origin should send the %s "
        "header.",
        request.method, request.path, origin, site, decision.reason, CLIENT_HEADER,
    )
    if key in _LOGGED_KEYS:
        return
    if len(_LOGGED_KEYS) < _LOGGED_KEYS_LIMIT:
        _LOGGED_KEYS.add(key)
    logger.warning(
        "LoRA Manager blocked a cross-site %s %s as a possible cross-site request "
        "forgery (origin=%s, sec-fetch-site=%s, reason=%s); further blocks from "
        "this origin are logged at debug level.",
        request.method, request.path, origin, site, decision.reason,
    )


def _route_canonical(request: web.Request) -> Optional[str]:
    try:
        resource = request.match_info.route.resource
    except AttributeError:
        return None
    if resource is None:
        return None
    return resource.canonical


def blocked_response() -> web.Response:
    return web.json_response(
        {"success": False, "error": BLOCKED_ERROR, "code": BLOCKED_CODE},
        status=BLOCKED_STATUS,
    )


Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]


def is_guarded_request(
    method: str, canonical: Optional[str], *, guard_unsafe_methods: bool
) -> bool:
    """True when a request with *method* to the route template *canonical*
    must pass :func:`evaluate_request`.

    ``GET``/``HEAD``: only routes in :data:`GUARDED_GET_ROUTES`. Non-safe
    methods (anything but ``GET``, ``HEAD``, ``OPTIONS``, ``TRACE``): every
    route when *guard_unsafe_methods* (standalone mode), except the templates
    in :data:`UNSAFE_METHOD_EXEMPTIONS`; never otherwise (ComfyUI mode, where
    ComfyUI's origin middleware covers them).
    """

    method = method.upper()
    if method in _GUARDED_METHODS:
        return canonical is not None and is_guarded_route(canonical)
    if method in _SAFE_METHODS or not guard_unsafe_methods:
        return False
    if canonical is not None and matching_templates(canonical, UNSAFE_METHOD_EXEMPTIONS):
        return False
    return True


def create_request_guard(*, guard_unsafe_methods: bool = False):
    """Build the request-guard middleware.

    ``guard_unsafe_methods=False`` (ComfyUI mode): only guarded GET routes.
    ``guard_unsafe_methods=True`` (standalone mode): also every ``POST``,
    ``PUT``, ``PATCH``, ``DELETE`` (any non-safe method) on any path.
    """

    @web.middleware
    async def middleware(request: web.Request, handler: Handler) -> web.StreamResponse:
        method = request.method.upper()
        if method in _GUARDED_METHODS:
            if not request.path.startswith("/api/lm/"):
                return await handler(request)
        elif method in _SAFE_METHODS or not guard_unsafe_methods:
            return await handler(request)
        canonical = _route_canonical(request)
        if not is_guarded_request(method, canonical, guard_unsafe_methods=guard_unsafe_methods):
            return await handler(request)

        decision = evaluate_request(
            sec_fetch_site=request.headers.get("Sec-Fetch-Site"),
            origin=request.headers.get("Origin"),
            client_header=request.headers.get(CLIENT_HEADER),
            host=request.host,
            scheme=request.scheme,
        )
        if decision.allowed:
            return await handler(request)
        _log_block_once(request, decision)
        return blocked_response()

    return middleware


#: ComfyUI mode: guarded GET routes only (see module docs).
request_guard = create_request_guard(guard_unsafe_methods=False)
request_guard.__name__ = "request_guard"

#: Standalone mode: guarded GET routes plus every non-safe method.
standalone_request_guard = create_request_guard(guard_unsafe_methods=True)
standalone_request_guard.__name__ = "standalone_request_guard"


def install_request_guard(app: web.Application) -> None:
    """Add :func:`request_guard` to *app* right after ``api_json_error``.

    Idempotent. Used in ComfyUI mode, where the app (and its middleware
    list) belongs to ComfyUI's PromptServer.
    """

    if request_guard in app.middlewares:
        return
    index = next(
        (
            idx + 1
            for idx, middleware in enumerate(app.middlewares)
            if getattr(middleware, "__name__", "") == "api_json_error"
        ),
        0,
    )
    app.middlewares.insert(index, request_guard)
