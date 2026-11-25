"""In-process aiohttp tests of the host check (DNS rebinding).

Two setups, both with spy handlers (a blocked request must leave the spy
uncalled) and no live backend:

* ComfyUI mode: a shared app with a ComfyUI core route, the guard installed
  with :func:`install_host_guard` and scoped to the routes LoRA Manager
  registered (:class:`LmRouteScope`);
* standalone mode: the middleware list ``standalone.py`` uses
  (``standalone_host_guard`` covers every path).

The last tests build the real ComfyUI-mode route table through
``LoraManager.add_routes``.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestClient, TestServer, make_mocked_request

from py import lora_manager
from py.middleware.error_middleware import api_json_error
from py.utils import host_guard as host_module
from py.utils.host_guard import (
    HOST_BLOCKED_CODE,
    LmRouteScope,
    create_host_guard,
    host_guard,
    install_host_guard,
    standalone_host_guard,
)
from py.utils.request_guard import request_guard

REPO_ROOT = Path(__file__).resolve().parents[2]

EVIL = "evil.example.com"


class Spy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def handle(self, request: web.Request) -> web.StreamResponse:
        self.calls.append((request.method, request.path))
        return web.json_response({"success": True})


@pytest.fixture(autouse=True)
def _reset_host_guard_state(monkeypatch: pytest.MonkeyPatch):
    host_module._LOGGED_HOSTS.clear()
    monkeypatch.delenv(host_module.ALLOWED_HOSTS_ENV, raising=False)
    yield
    host_module._LOGGED_HOSTS.clear()


async def _assert_host_blocked(response, host: str) -> None:
    assert response.status == 403
    body = await response.json()
    assert body == {
        "success": False,
        "error": (
            f"Host not allowed: {host}. Add it to the LoRA Manager setting "
            "allowed_hosts if you access ComfyUI through this hostname."
        ),
        "code": HOST_BLOCKED_CODE,
    }


def _ws_handler_factory(spy: Spy):
    async def ws_handler(request: web.Request) -> web.StreamResponse:
        spy.calls.append((request.method, request.path))
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        await ws.send_str("hello")
        await ws.close()
        return ws

    return ws_handler


# ---------------------------------------------------------------------------
# ComfyUI mode
# ---------------------------------------------------------------------------


@pytest.fixture
async def comfy_client(tmp_path: Path):
    """A shared app: ComfyUI core routes plus LM routes registered in between."""

    allowed: list[str] = []
    scope = LmRouteScope()
    guard = create_host_guard(scope=scope, allowed_hosts_provider=lambda: allowed)
    app = web.Application(middlewares=[api_json_error])
    install_host_guard(app, guard)

    spies: dict[str, Spy] = {name: Spy() for name in ("core", "core_api", "lm_get", "lm_post", "page", "lm_ws", "ui")}
    app.router.add_get("/prompt", spies["core"].handle)
    app.router.add_get("/api/queue", spies["core_api"].handle)

    before = set(app.router.resources())
    app.router.add_get("/api/lm/settings", spies["lm_get"].handle)
    app.router.add_post("/api/lm/settings", spies["lm_post"].handle)
    app.router.add_get("/loras", spies["page"].handle)
    app.router.add_get("/lm-ui/{tail:.*}", spies["ui"].handle)
    static_dir = tmp_path / "static"
    static_dir.mkdir()
    (static_dir / "app.js").write_text("console.log(1)", encoding="utf-8")
    app.router.add_static("/loras_static", static_dir)
    app.router.add_get("/ws/fetch-progress", _ws_handler_factory(spies["lm_ws"]))
    scope.add_resources(r for r in app.router.resources() if r not in before)

    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client, spies, allowed
    finally:
        await client.close()


@pytest.mark.parametrize(
    "host",
    ["127.0.0.1:8188", "[::1]:8188", "localhost:8000", "LOCALHOST", "foo.localhost", "192.168.1.20"],
)
async def test_comfy_mode_allows_local_and_ip_hosts(comfy_client, host) -> None:
    client, spies, _ = comfy_client
    response = await client.get("/api/lm/settings", headers={"Host": host})
    assert response.status == 200
    assert len(spies["lm_get"].calls) == 1


@pytest.mark.parametrize(
    "host,shown",
    [
        (EVIL, EVIL),
        (f"{EVIL}:8188", EVIL),
        (f"{EVIL}.", EVIL),
        ("localhost.evil.com", "localhost.evil.com"),
        ("127.0.0.1.evil.com", "127.0.0.1.evil.com"),
        ("comfy.lan", "comfy.lan"),
    ],
)
async def test_comfy_mode_blocks_foreign_names_without_side_effects(comfy_client, host, shown) -> None:
    client, spies, _ = comfy_client
    response = await client.get("/api/lm/settings", headers={"Host": host})
    await _assert_host_blocked(response, shown)
    response = await client.post("/api/lm/settings", json={"allowed_hosts": [EVIL]}, headers={"Host": host})
    await _assert_host_blocked(response, shown)
    assert spies["lm_get"].calls == []
    assert spies["lm_post"].calls == []


@pytest.mark.parametrize("path,spy", [("/loras", "page"), ("/lm-ui/index.html", "ui"), ("/lm-ui/assets/x.js", "ui")])
async def test_comfy_mode_guards_pages(comfy_client, path, spy) -> None:
    client, spies, _ = comfy_client
    response = await client.get(path, headers={"Host": EVIL})
    await _assert_host_blocked(response, EVIL)
    assert spies[spy].calls == []


async def test_comfy_mode_guards_static_files(comfy_client) -> None:
    client, _, _ = comfy_client
    blocked = await client.get("/loras_static/app.js", headers={"Host": EVIL})
    await _assert_host_blocked(blocked, EVIL)
    allowed = await client.get("/loras_static/app.js", headers={"Host": "127.0.0.1:8188"})
    assert allowed.status == 200
    assert "console.log" in await allowed.text()


async def test_comfy_mode_leaves_comfyui_core_routes_alone(comfy_client) -> None:
    client, spies, _ = comfy_client
    for path, name in (("/prompt", "core"), ("/api/queue", "core_api")):
        response = await client.get(path, headers={"Host": EVIL})
        assert response.status == 200, path
        assert len(spies[name].calls) == 1
    # Unknown non-LM path: ComfyUI's own 404, not a host error.
    response = await client.get("/not-ours", headers={"Host": EVIL})
    assert response.status == 404


async def test_comfy_mode_guards_unknown_paths_under_api_lm(comfy_client) -> None:
    client, _, _ = comfy_client
    response = await client.get("/api/lm/does-not-exist", headers={"Host": EVIL})
    await _assert_host_blocked(response, EVIL)
    response = await client.get("/api/lm/does-not-exist", headers={"Host": "localhost"})
    assert response.status == 404


async def test_allowed_hosts_setting_admits_listed_names(comfy_client) -> None:
    client, spies, allowed = comfy_client
    allowed.extend(["comfy.lan:8188", "*.my.tld"])
    for host in ("comfy.lan:8188", "COMFY.LAN", "pc.my.tld", "a.b.my.tld:443"):
        response = await client.get("/api/lm/settings", headers={"Host": host})
        assert response.status == 200, host
    assert len(spies["lm_get"].calls) == 4
    response = await client.get("/api/lm/settings", headers={"Host": "my.tld"})
    await _assert_host_blocked(response, "my.tld")
    # The setting is re-read: removing an entry takes effect immediately.
    allowed.clear()
    response = await client.get("/api/lm/settings", headers={"Host": "comfy.lan"})
    await _assert_host_blocked(response, "comfy.lan")


async def test_env_var_admits_listed_names(comfy_client, monkeypatch) -> None:
    client, spies, _ = comfy_client
    monkeypatch.setenv(host_module.ALLOWED_HOSTS_ENV, "comfy.lan,*.my.tld")
    response = await client.get("/api/lm/settings", headers={"Host": "pc.my.tld:8188"})
    assert response.status == 200
    assert len(spies["lm_get"].calls) == 1


@pytest.mark.parametrize("host", ["a@b", "localhost@evil.com", "x" * 1000])
async def test_odd_host_headers_are_blocked(comfy_client, host) -> None:
    client, spies, _ = comfy_client
    response = await client.get("/api/lm/settings", headers={"Host": host})
    assert response.status == 403
    body = await response.json()
    assert body["code"] == HOST_BLOCKED_CODE
    assert len(body["error"]) < 250
    assert spies["lm_get"].calls == []


async def test_websocket_upgrade_is_checked(comfy_client) -> None:
    client, spies, _ = comfy_client
    with pytest.raises(Exception):
        await client.ws_connect("/ws/fetch-progress", headers={"Host": EVIL})
    assert spies["lm_ws"].calls == []

    ws = await client.ws_connect("/ws/fetch-progress", headers={"Host": "127.0.0.1:8188"})
    message = await ws.receive()
    assert message.type == WSMsgType.TEXT and message.data == "hello"
    await ws.close()
    assert len(spies["lm_ws"].calls) == 1


async def test_head_and_options_are_checked(comfy_client) -> None:
    client, spies, _ = comfy_client
    head = await client.head("/api/lm/settings", headers={"Host": EVIL})
    assert head.status == 403
    options = await client.options("/api/lm/settings", headers={"Host": EVIL})
    assert options.status == 403
    assert spies["lm_get"].calls == []
    ok = await client.head("/api/lm/settings", headers={"Host": "localhost"})
    assert ok.status == 200


async def test_block_is_logged_once_per_host(comfy_client, caplog) -> None:
    client, _, _ = comfy_client
    caplog.set_level(logging.DEBUG, logger=host_module.logger.name)
    for _ in range(3):
        await client.get("/api/lm/settings", headers={"Host": EVIL})
    await client.get("/api/lm/settings", headers={"Host": "other.example.com"})
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and r.name == host_module.logger.name]
    assert len(warnings) == 2
    assert EVIL in warnings[0].getMessage()
    assert "allowed_hosts" in warnings[0].getMessage()
    assert "other.example.com" in warnings[1].getMessage()


def test_install_host_guard_order_and_idempotence() -> None:
    from py.utils.request_guard import install_request_guard

    app = web.Application(middlewares=[api_json_error])
    install_request_guard(app)
    install_host_guard(app)
    install_host_guard(app)
    middlewares = list(app.middlewares)
    assert middlewares.count(host_guard) == 1
    assert middlewares.index(host_guard) == middlewares.index(api_json_error) + 1
    assert middlewares.index(request_guard) == middlewares.index(host_guard) + 1


# ---------------------------------------------------------------------------
# Missing Host header (HTTP/1.0 clients, some tools)
# ---------------------------------------------------------------------------


async def test_missing_host_header_is_allowed() -> None:
    spy = Spy()
    middleware = create_host_guard(scope=None, allowed_hosts_provider=lambda: [])
    request = make_mocked_request("GET", "/api/lm/settings", headers={})
    assert "Host" not in request.headers
    response = await middleware(request, spy.handle)
    assert response.status == 200
    assert len(spy.calls) == 1


async def test_settings_provider_errors_fail_closed_to_defaults() -> None:
    def broken() -> Any:
        raise RuntimeError("settings not ready")

    spy = Spy()
    middleware = create_host_guard(scope=None, allowed_hosts_provider=broken)
    blocked = await middleware(make_mocked_request("GET", "/api/lm/x", headers={"Host": EVIL}), spy.handle)
    assert blocked.status == 403
    allowed = await middleware(make_mocked_request("GET", "/api/lm/x", headers={"Host": "localhost"}), spy.handle)
    assert allowed.status == 200
    assert len(spy.calls) == 1


# ---------------------------------------------------------------------------
# Standalone mode
# ---------------------------------------------------------------------------


@pytest.fixture
async def standalone_client(monkeypatch):
    allowed: list[str] = []
    monkeypatch.setattr(host_module, "_default_allowed_hosts_provider", lambda: allowed)
    spies = {name: Spy() for name in ("root", "lm_get", "lm_post", "page")}
    app = web.Application(middlewares=[api_json_error, standalone_host_guard])
    app.router.add_get("/", spies["root"].handle)
    app.router.add_get("/api/lm/settings", spies["lm_get"].handle)
    app.router.add_post("/api/lm/settings", spies["lm_post"].handle)
    app.router.add_get("/loras", spies["page"].handle)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client, spies, allowed
    finally:
        await client.close()


async def test_standalone_guards_every_path(standalone_client) -> None:
    client, spies, _ = standalone_client
    for path in ("/", "/loras", "/api/lm/settings", "/anything"):
        response = await client.get(path, headers={"Host": EVIL}, allow_redirects=False)
        await _assert_host_blocked(response, EVIL)
    response = await client.post("/api/lm/settings", json={}, headers={"Host": EVIL})
    await _assert_host_blocked(response, EVIL)
    assert all(spy.calls == [] for spy in spies.values())


async def test_standalone_allows_local_hosts_and_listed_names(standalone_client) -> None:
    client, spies, allowed = standalone_client
    for host in ("127.0.0.1:8188", "localhost:8188", "192.168.1.20:8188", "[::1]:8188"):
        response = await client.get("/api/lm/settings", headers={"Host": host})
        assert response.status == 200, host
    allowed.append("comfy.lan")
    response = await client.post("/api/lm/settings", json={}, headers={"Host": "comfy.lan:8188"})
    assert response.status == 200
    assert len(spies["lm_get"].calls) == 4
    assert len(spies["lm_post"].calls) == 1


def test_standalone_server_uses_the_host_guard() -> None:
    # Checked on the source: importing standalone.py rewrites sys.modules and
    # the environment for the whole test session.
    source = (REPO_ROOT / "standalone.py").read_text(encoding="utf-8")
    assert "from py.utils.host_guard import standalone_host_guard" in source
    assert re.search(
        r"middlewares: list\[Any\] = \[\s*api_json_error,\s*standalone_host_guard,\s*standalone_request_guard,\s*cache_control,?\s*\]",
        source,
    )


# ---------------------------------------------------------------------------
# Real ComfyUI-mode route table
# ---------------------------------------------------------------------------


@pytest.fixture
def real_comfy_app(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    app = web.Application(middlewares=[])
    core = Spy()
    app.router.add_get("/prompt", core.handle)  # registered by ComfyUI before custom nodes
    monkeypatch.setattr(lora_manager, "PromptServer", SimpleNamespace(instance=SimpleNamespace(app=app)))
    example_dir = tmp_path / "example_images"
    example_dir.mkdir()
    monkeypatch.setattr(
        lora_manager.settings,
        "get",
        lambda key, default=None: str(example_dir) if key == "example_images_path" else default,
    )
    monkeypatch.setattr(host_module, "LM_ROUTE_SCOPE", LmRouteScope())
    monkeypatch.setattr(host_module, "_default_allowed_hosts_provider", lambda: [])
    asyncio_logger = logging.getLogger("asyncio")
    access_logger = logging.getLogger("aiohttp.access")
    saved_filters, saved_level = list(asyncio_logger.filters), access_logger.level
    try:
        lora_manager.LoraManager.add_routes()
    finally:
        asyncio_logger.filters[:] = saved_filters
        access_logger.setLevel(saved_level)
    return app, core


def test_real_scope_covers_lm_routes_only(real_comfy_app) -> None:
    app, _ = real_comfy_app
    scope = host_module.LM_ROUTE_SCOPE
    for path in (
        "/api/lm/settings",
        "/api/lm/loras/list",
        "/api/lm/anything/unknown",
        "/lm-ui",
        "/lm-ui/index.html",
        "/loras",
        "/loras/recipes",
        "/checkpoints",
        "/embeddings",
        "/statistics",
        "/loras_static/js/app.js",
        "/locales/en.json",
        "/example_images_static/abc/1.png",
        "/ws/fetch-progress",
        "/ws/download-progress",
        "/ws/init-progress",
    ):
        assert scope.covers_path(path), path
    for path in ("/", "/prompt", "/api/queue", "/ws", "/api/prompt", "/extensions/x.js", "/lorasx", "/api/lmx"):
        assert not scope.covers_path(path), path
    # Every registered LM route is covered; the core route is not.
    for resource in app.router.resources():
        if resource.canonical == "/prompt":
            assert not scope.covers_resource(resource)
        else:
            assert scope.covers_resource(resource), resource.canonical


async def test_real_app_blocks_rebinding_on_lm_routes_only(real_comfy_app) -> None:
    app, core_spy = real_comfy_app
    app.on_startup.clear()  # no service initialisation in tests
    app.on_shutdown.clear()
    assert host_guard in app.middlewares
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        blocked = await client.get("/api/lm/health-check", headers={"Host": EVIL})
        await _assert_host_blocked(blocked, EVIL)
        allowed = await client.get("/api/lm/health-check", headers={"Host": "127.0.0.1:8188"})
        assert allowed.status == 200
        core = await client.get("/prompt", headers={"Host": EVIL})
        assert core.status == 200
        assert len(core_spy.calls) == 1
    finally:
        await client.close()
