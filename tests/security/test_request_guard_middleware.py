"""In-process aiohttp tests of the CSRF guard middleware.

Routes are bound with the real registrars (real paths and methods), but every
handler is a spy standing in for the service: a blocked request must leave the
spy uncalled. Nothing here touches a live backend.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Iterable

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from py.middleware.error_middleware import api_json_error
from py.routes.model_route_registrar import ModelRouteRegistrar
from py.routes.recipe_route_registrar import RecipeRouteRegistrar
from py.utils import request_guard as guard_module
from py.utils.request_guard import BLOCKED_CODE, CLIENT_HEADER, request_guard


def _make_spy(name: str):
    calls: list[tuple[str, str]] = []

    async def spy(request: web.Request) -> web.Response:
        calls.append((request.method, request.path))
        return web.json_response({"success": True, "handler": name})

    spy.calls = calls  # type: ignore[attr-defined]
    return spy


_Spy = Any


class _Spies(defaultdict):
    def __missing__(self, key: str):
        spy = _make_spy(key)
        self[key] = spy
        return spy


@pytest.fixture(autouse=True)
def _reset_log_memory() -> Iterable[None]:
    guard_module._LOGGED_KEYS.clear()
    yield
    guard_module._LOGGED_KEYS.clear()


@pytest.fixture
async def guarded_app():
    spies = _Spies()
    recipe_spies = _Spies()
    app = web.Application(middlewares=[api_json_error, request_guard])
    registrar = ModelRouteRegistrar(app)
    registrar.register_common_routes("loras", spies)
    RecipeRouteRegistrar(app).register_routes(recipe_spies)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client, spies, recipe_spies
    finally:
        await client.close()


def _same_origin(client: TestClient) -> str:
    return f"http://{client.host}:{client.port}"


# (path, handler name, registry) for one route of each guarded class
GUARDED_CASES = [
    ("/api/lm/downloads/queue/add?model_id=1&model_version_id=2", "add_to_download_queue", "model"),
    ("/api/lm/downloads/queue/pause-all", "pause_download_queue", "model"),
    ("/api/lm/downloads/queue/remove?download_id=x", "remove_from_download_queue", "model"),
    ("/api/lm/loras/scan?full_rebuild=true", "scan_models", "model"),
    ("/api/lm/recipes/scan", "scan_recipes", "recipe"),
    ("/api/lm/download-model-get?model_id=1", "download_model_get", "model"),
    ("/api/lm/downloads/queue/complete?download_id=x&file_path=C:/x", "complete_download_in_queue", "model"),
]


def _spy(spies, recipe_spies, registry: str, name: str) -> _Spy:
    return (spies if registry == "model" else recipe_spies)[name]


async def _assert_blocked(response) -> None:
    assert response.status == 403
    body = await response.json()
    assert body["success"] is False
    assert body["code"] == BLOCKED_CODE
    assert isinstance(body["error"], str)
    assert "Cross-site request blocked" in body["error"]
    # The extension must not send a custom header: the message does not
    # prescribe X-LM-Client to every client.
    assert "X-LM-Client" not in body["error"]


@pytest.mark.parametrize("path,name,registry", GUARDED_CASES)
async def test_cross_site_get_is_blocked_without_side_effects(guarded_app, path, name, registry):
    client, spies, recipe_spies = guarded_app
    response = await client.get(path, headers={"Sec-Fetch-Site": "cross-site"})
    await _assert_blocked(response)
    assert _spy(spies, recipe_spies, registry, name).calls == []


@pytest.mark.parametrize("path,name,registry", GUARDED_CASES)
async def test_same_site_page_without_header_is_blocked(guarded_app, path, name, registry):
    client, spies, recipe_spies = guarded_app
    response = await client.get(
        path, headers={"Sec-Fetch-Site": "same-site", "Origin": "http://127.0.0.1:3000"}
    )
    await _assert_blocked(response)
    assert _spy(spies, recipe_spies, registry, name).calls == []


@pytest.mark.parametrize("path,name,registry", GUARDED_CASES)
async def test_same_origin_is_allowed(guarded_app, path, name, registry):
    client, spies, recipe_spies = guarded_app
    response = await client.get(path, headers={"Sec-Fetch-Site": "same-origin"})
    assert response.status == 200
    assert len(_spy(spies, recipe_spies, registry, name).calls) == 1


@pytest.mark.parametrize("path,name,registry", GUARDED_CASES)
async def test_extension_with_header_is_allowed(guarded_app, path, name, registry):
    client, spies, recipe_spies = guarded_app
    response = await client.get(
        path,
        headers={
            "Sec-Fetch-Site": "cross-site",
            "Origin": "chrome-extension://abcdefghijklmnop",
            CLIENT_HEADER: "lm-extension",
        },
    )
    assert response.status == 200
    assert len(_spy(spies, recipe_spies, registry, name).calls) == 1


@pytest.mark.parametrize("path,name,registry", GUARDED_CASES)
async def test_header_with_foreign_origin_is_blocked(guarded_app, path, name, registry):
    client, spies, recipe_spies = guarded_app
    response = await client.get(
        path,
        headers={
            "Sec-Fetch-Site": "cross-site",
            "Origin": "https://evil.example",
            CLIENT_HEADER: "lm-extension",
        },
    )
    await _assert_blocked(response)
    assert _spy(spies, recipe_spies, registry, name).calls == []


async def test_stale_extension_without_header_keeps_working(guarded_app):
    """Firefox-style extension request: cross-site + moz-extension Origin, no header."""
    client, spies, _ = guarded_app
    response = await client.get(
        "/api/lm/downloads/queue/add?model_id=1",
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "moz-extension://uuid"},
    )
    assert response.status == 200
    assert len(spies["add_to_download_queue"].calls) == 1


async def test_chrome_extension_service_worker_shape_is_allowed(guarded_app):
    """Chrome extension fetch with host permission: Sec-Fetch-Site none."""
    client, spies, _ = guarded_app
    response = await client.get(
        "/api/lm/downloads/queue/pause-all", headers={"Sec-Fetch-Site": "none"}
    )
    assert response.status == 200
    assert len(spies["pause_download_queue"].calls) == 1


async def test_old_browser_same_origin_needs_the_header(guarded_app):
    """No Sec-Fetch-Site (old browser or a proxy stripping it) + same Origin."""
    client, spies, _ = guarded_app
    origin = _same_origin(client)
    blocked = await client.get("/api/lm/loras/scan", headers={"Origin": origin})
    await _assert_blocked(blocked)
    assert spies["scan_models"].calls == []

    allowed = await client.get(
        "/api/lm/loras/scan", headers={"Origin": origin, CLIENT_HEADER: "lm-classic"}
    )
    assert allowed.status == 200
    assert len(spies["scan_models"].calls) == 1


async def test_non_browser_client_is_allowed(guarded_app):
    client, spies, _ = guarded_app
    response = await client.get("/api/lm/downloads/queue/add?model_id=1")
    assert response.status == 200
    assert len(spies["add_to_download_queue"].calls) == 1


async def test_head_request_is_guarded_too(guarded_app):
    client, spies, _ = guarded_app
    response = await client.head(
        "/api/lm/download-model-get?model_id=1", headers={"Sec-Fetch-Site": "cross-site"}
    )
    assert response.status == 403
    assert spies["download_model_get"].calls == []


async def test_read_only_routes_stay_open(guarded_app):
    client, spies, _ = guarded_app
    for path, name in (
        ("/api/lm/downloads/queue", "get_download_queue"),
        ("/api/lm/downloads/history", "get_download_history"),
        ("/api/lm/loras/list", "get_models"),
    ):
        response = await client.get(path, headers={"Sec-Fetch-Site": "cross-site"})
        assert response.status == 200, path
        assert len(spies[name].calls) == 1


async def test_post_routes_are_not_affected(guarded_app):
    """Non-GET methods stay with ComfyUI's origin middleware."""
    client, spies, _ = guarded_app
    response = await client.post(
        "/api/lm/download-model", json={}, headers={"Sec-Fetch-Site": "same-origin"}
    )
    assert response.status == 200
    assert len(spies["download_model"].calls) == 1


async def test_unknown_route_still_returns_json_404(guarded_app):
    client, _, _ = guarded_app
    response = await client.get("/api/lm/does-not-exist", headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status == 404
    assert (await response.json())["success"] is False


async def test_block_is_logged_once_per_origin(guarded_app, caplog):
    client, _, _ = guarded_app
    caplog.set_level(logging.DEBUG, logger=guard_module.logger.name)
    headers = {"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"}
    for _ in range(3):
        await client.get("/api/lm/downloads/queue/clear", headers=headers)
    await client.get(
        "/api/lm/downloads/queue/clear",
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://other.example"},
    )
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING and r.name == guard_module.logger.name]
    assert len(warnings) == 2
    assert "evil.example" in warnings[0].getMessage()
    assert "other.example" in warnings[1].getMessage()
    assert all("blocked" in w.getMessage() for w in warnings)
    assert all("X-LM-Client" not in w.getMessage() for w in warnings)
    hints = [r for r in caplog.records if r.levelno == logging.DEBUG and "X-LM-Client" in r.getMessage()]
    assert hints, "the X-LM-Client hint for same-origin web clients is logged at debug level"
