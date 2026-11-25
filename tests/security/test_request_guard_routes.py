"""Every registered GET route is either guarded or explicitly read-only.

Builds the real route table through ``LoraManager.add_routes`` (ComfyUI mode)
and checks it against ``GUARDED_GET_ROUTES`` / ``READ_ONLY_GET_ROUTES`` in
``py/utils/request_guard.py``. A new GET route that is in neither list fails
here: decide whether it changes state (guard it) or not (add it to the
read-only list with a one-line reason).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from aiohttp import web

from py import lora_manager
from py.middleware.error_middleware import api_json_error
from py.utils.request_guard import (
    GUARDED_GET_ROUTES,
    READ_ONLY_GET_ROUTES,
    UNSAFE_METHOD_EXEMPTIONS,
    is_guarded_request,
    is_guarded_route,
    matching_templates,
    request_guard,
)

REPO_ROOT = Path(__file__).resolve().parents[2]

# Registered only in standalone mode; the ComfyUI-mode table cannot show them.
STANDALONE_ONLY = {"/", "/ws/batch-import-progress"}


@pytest.fixture
def comfy_app(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> web.Application:
    app = web.Application(middlewares=[])
    # Replace the module-level name, not an attribute of the shared conftest
    # MagicMock (undoing that would delete the attribute for later tests).
    monkeypatch.setattr(lora_manager, "PromptServer", SimpleNamespace(instance=SimpleNamespace(app=app)))
    # Keep the host-check scope of this throwaway app out of the global one.
    from py.utils import host_guard

    monkeypatch.setattr(host_guard, "LM_ROUTE_SCOPE", host_guard.LmRouteScope())
    example_dir = tmp_path / "example_images"
    example_dir.mkdir()
    monkeypatch.setattr(
        lora_manager.settings,
        "get",
        lambda key, default=None: str(example_dir) if key == "example_images_path" else default,
    )
    asyncio_logger = logging.getLogger("asyncio")
    access_logger = logging.getLogger("aiohttp.access")
    saved_filters, saved_level = list(asyncio_logger.filters), access_logger.level
    try:
        lora_manager.LoraManager.add_routes()
    finally:
        asyncio_logger.filters[:] = saved_filters
        access_logger.setLevel(saved_level)
    return app


def _get_routes(app: web.Application) -> dict[str, str]:
    routes: dict[str, str] = {}
    for route in app.router.routes():
        if route.method != "GET":
            continue
        canonical = route.resource.canonical if route.resource is not None else None
        assert canonical is not None
        routes[canonical] = getattr(route.handler, "__qualname__", repr(route.handler))
    return routes


def test_every_get_route_is_classified(comfy_app) -> None:
    routes = _get_routes(comfy_app)
    assert len(routes) > 250, "route table looks incomplete"
    unclassified = sorted(
        path
        for path in routes
        if not matching_templates(path, GUARDED_GET_ROUTES)
        and not matching_templates(path, READ_ONLY_GET_ROUTES)
    )
    assert unclassified == [], (
        "GET routes missing from GUARDED_GET_ROUTES / READ_ONLY_GET_ROUTES in "
        f"py/utils/request_guard.py: {unclassified}"
    )


def test_no_route_is_both_guarded_and_read_only(comfy_app) -> None:
    both = sorted(
        path
        for path in _get_routes(comfy_app)
        if matching_templates(path, GUARDED_GET_ROUTES)
        and matching_templates(path, READ_ONLY_GET_ROUTES)
    )
    assert both == []


def test_registry_has_no_stale_templates(comfy_app) -> None:
    routes = _get_routes(comfy_app)
    stale = []
    for registry in (GUARDED_GET_ROUTES, READ_ONLY_GET_ROUTES):
        for template in registry:
            if template in STANDALONE_ONLY:
                continue
            if not any(matching_templates(path, {template: ""}) for path in routes):
                stale.append(template)
    assert stale == []


def test_every_registry_entry_has_a_reason() -> None:
    for registry in (GUARDED_GET_ROUTES, READ_ONLY_GET_ROUTES):
        for template, reason in registry.items():
            assert reason.strip(), template
    assert all(t.startswith("/api/lm/") for t in GUARDED_GET_ROUTES)


@pytest.mark.parametrize(
    "path",
    [
        "/api/lm/download-model-get",
        "/api/lm/downloads/queue/add",
        "/api/lm/downloads/queue/complete",
        "/api/lm/downloads/queue/pause-all",
        "/api/lm/downloads/history/retry",
        "/api/lm/loras/scan",
        "/api/lm/checkpoints/scan",
        "/api/lm/recipes/scan",
        "/api/lm/wildcards/forget-folder",
        "/api/lm/first-scan/start",
        "/api/lm/recipe/{recipe_id}/reimport",
    ],
)
def test_audit_examples_are_guarded(comfy_app, path) -> None:
    assert path in _get_routes(comfy_app)
    assert is_guarded_route(path)


@pytest.mark.parametrize(
    "path",
    [
        "/api/lm/downloads/queue",
        "/api/lm/downloads/history",
        "/api/lm/health-check",
        "/api/lm/model-versions-status",
        "/api/lm/check-models-exist",
        "/api/lm/download-progress/{download_id}",
        "/api/lm/loras/list",
    ],
)
def test_extension_read_endpoints_stay_open(path) -> None:
    assert not is_guarded_route(path)


def test_guard_registered_after_json_error_middleware(comfy_app) -> None:
    from py.utils.host_guard import host_guard

    middlewares = list(comfy_app.middlewares)
    # api_json_error, then the host check (DNS rebinding), then this guard.
    assert middlewares.index(host_guard) == middlewares.index(api_json_error) + 1
    assert middlewares.index(request_guard) == middlewares.index(host_guard) + 1
    # Idempotent: a second add_routes run does not stack another copy.
    from py.utils.request_guard import install_request_guard

    install_request_guard(comfy_app)
    assert list(comfy_app.middlewares).count(request_guard) == 1


def test_standalone_server_uses_the_guard() -> None:
    # Checked on the source: importing standalone.py rewrites sys.modules and
    # the environment for the whole test session.
    source = (REPO_ROOT / "standalone.py").read_text(encoding="utf-8")
    assert "from py.utils.request_guard import standalone_request_guard" in source
    assert re.search(
        r"middlewares: list\[Any\] = \[\s*api_json_error,\s*standalone_host_guard,"
        r"\s*standalone_request_guard,\s*cache_control,?\s*\]",
        source,
    )


def _non_get_routes(app: web.Application) -> list[tuple[str, str]]:
    routes = []
    for route in app.router.routes():
        if route.method in ("GET", "HEAD", "*"):
            continue
        canonical = route.resource.canonical if route.resource is not None else None
        assert canonical is not None
        routes.append((route.method, canonical))
    return routes


def test_every_non_get_route_is_guarded_in_standalone_only(comfy_app) -> None:
    routes = _non_get_routes(comfy_app)
    assert len(routes) > 100, "route table looks incomplete"
    methods = {method for method, _ in routes}
    assert methods <= {"POST", "PUT", "PATCH", "DELETE"}, methods
    unguarded = [
        f"{method} {path}"
        for method, path in routes
        if not is_guarded_request(method, path, guard_unsafe_methods=True)
    ]
    # Exemptions must be listed (with a reason) in UNSAFE_METHOD_EXEMPTIONS.
    exempt = [
        f"{method} {path}"
        for method, path in routes
        if matching_templates(path, UNSAFE_METHOD_EXEMPTIONS)
    ]
    assert unguarded == exempt
    # ComfyUI mode leaves non-GET methods to ComfyUI's origin middleware.
    assert not any(
        is_guarded_request(method, path, guard_unsafe_methods=False) for method, path in routes
    )


def test_unsafe_method_exemptions_are_not_stale(comfy_app) -> None:
    paths = {path for _, path in _non_get_routes(comfy_app)}
    for template, reason in UNSAFE_METHOD_EXEMPTIONS.items():
        assert reason.strip(), template
        assert any(matching_templates(path, {template: ""}) for path in paths), template


_LM_PATH_RE = re.compile(r"(?:/api)?/lm/[A-Za-z0-9_\-./${}]+")


def _guarded_paths_in(files) -> list[str]:
    hits = []
    for file in files:
        text = file.read_text(encoding="utf-8", errors="ignore")
        for match in _LM_PATH_RE.findall(text):
            path = re.sub(r"\$\{[^}]*\}", "x", match).rstrip("./")
            if not path.startswith("/api/"):
                path = "/api" + path
            if is_guarded_route(path):
                hits.append(f"{file.relative_to(REPO_ROOT)}: {match}")
    return hits


def test_comfyui_side_clients_do_not_call_guarded_get_routes() -> None:
    """web/comfyui and vue-widgets run inside the ComfyUI page (same origin,
    allowed through Sec-Fetch-Site) and use ComfyUI's ``api.fetchApi`` or raw
    fetch without the X-LM-Client header. They call no guarded route today;
    if one is added, send the header (``X-LM-Client: lm-comfyui``) there and
    extend this test."""

    files = list((REPO_ROOT / "web" / "comfyui").glob("*.js"))
    vue_src = REPO_ROOT / "vue-widgets" / "src"
    files += [p for p in vue_src.rglob("*") if p.suffix in {".ts", ".vue", ".js"}]
    assert files
    assert _guarded_paths_in(files) == []
