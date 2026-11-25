"""Standalone mode: the request guard also covers non-safe methods.

Standalone mode has no ComfyUI ``origin_only_middleware``, so
``standalone_request_guard`` applies :func:`evaluate_request` to every
``POST``/``PUT``/``PATCH``/``DELETE``. ComfyUI mode (``request_guard``) leaves
them to ComfyUI. Spy handlers only; nothing touches a live backend.
"""

from __future__ import annotations

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer

from py.middleware.error_middleware import api_json_error
from py.utils import request_guard as guard_module
from py.utils.request_guard import (
    BLOCKED_CODE,
    CLIENT_HEADER,
    is_guarded_request,
    request_guard,
    standalone_request_guard,
)

UNSAFE = ("POST", "PUT", "PATCH", "DELETE")


@pytest.fixture(autouse=True)
def _reset_log_memory():
    guard_module._LOGGED_KEYS.clear()
    yield
    guard_module._LOGGED_KEYS.clear()


# ---------------------------------------------------------------------------
# Which requests are guarded
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("method", UNSAFE + ("post", "PROPFIND"))
def test_non_safe_methods_are_guarded_in_standalone(method) -> None:
    assert is_guarded_request(method, "/api/lm/settings", guard_unsafe_methods=True)
    assert is_guarded_request(method, "/api/lm/{prefix}/delete", guard_unsafe_methods=True)
    assert is_guarded_request(method, None, guard_unsafe_methods=True)  # 404/405
    assert not is_guarded_request(method, "/api/lm/settings", guard_unsafe_methods=False)


@pytest.mark.parametrize("method", ("OPTIONS", "TRACE"))
def test_safe_methods_are_never_guarded(method) -> None:
    assert not is_guarded_request(method, "/api/lm/settings", guard_unsafe_methods=True)


@pytest.mark.parametrize("guard_unsafe", (True, False))
def test_get_rules_are_unchanged(guard_unsafe) -> None:
    assert is_guarded_request("GET", "/api/lm/loras/scan", guard_unsafe_methods=guard_unsafe)
    assert is_guarded_request("HEAD", "/api/lm/loras/scan", guard_unsafe_methods=guard_unsafe)
    assert not is_guarded_request("GET", "/api/lm/settings", guard_unsafe_methods=guard_unsafe)
    assert not is_guarded_request("GET", None, guard_unsafe_methods=guard_unsafe)


def test_exemptions_are_honoured(monkeypatch) -> None:
    monkeypatch.setattr(guard_module, "UNSAFE_METHOD_EXEMPTIONS", {"/api/lm/{prefix}/open": "test"})
    assert not is_guarded_request("POST", "/api/lm/loras/open", guard_unsafe_methods=True)
    assert is_guarded_request("POST", "/api/lm/loras/other", guard_unsafe_methods=True)


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class Spy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    async def handle(self, request: web.Request) -> web.Response:
        details: dict = {"content_type": request.content_type}
        if request.content_type == "multipart/form-data":
            form = await request.post()
            upload = form["file"]
            details["file"] = (upload.filename, upload.file.read())
            details["field"] = form["name"]
        elif request.can_read_body:
            details["body"] = await request.read()
        self.calls.append((request.method, request.path, details))
        return web.json_response({"success": True})


def _build_app(middleware) -> tuple[web.Application, Spy]:
    spy = Spy()
    app = web.Application(middlewares=[api_json_error, middleware])
    for method in UNSAFE:
        app.router.add_route(method, "/api/lm/settings", spy.handle)
    app.router.add_post("/api/lm/loras/delete", spy.handle)
    app.router.add_get("/api/lm/settings", spy.handle)
    return app, spy


@pytest.fixture
async def standalone_client():
    app, spy = _build_app(standalone_request_guard)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client, spy
    finally:
        await client.close()


@pytest.fixture
async def comfy_client():
    app, spy = _build_app(request_guard)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client, spy
    finally:
        await client.close()


def _origin(client: TestClient) -> str:
    return f"http://{client.host}:{client.port}"


async def _assert_blocked(response) -> None:
    assert response.status == 403
    body = await response.json()
    assert body["success"] is False
    assert body["code"] == BLOCKED_CODE


@pytest.mark.parametrize("method", UNSAFE)
async def test_standalone_cross_site_is_blocked_without_side_effects(standalone_client, method) -> None:
    client, spy = standalone_client
    response = await client.request(
        method,
        "/api/lm/settings",
        json={"civitai_api_key": "x"},
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
    )
    await _assert_blocked(response)
    assert spy.calls == []


async def test_standalone_html_form_post_is_blocked(standalone_client) -> None:
    """A cross-site <form method=post> (simple request, no preflight)."""
    client, spy = standalone_client
    response = await client.post(
        "/api/lm/loras/delete",
        data={"file_path": "C:/models/x.safetensors"},
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
    )
    await _assert_blocked(response)
    # Old browser without Sec-Fetch-Site: the foreign Origin alone is enough.
    response = await client.post(
        "/api/lm/loras/delete", data={"file_path": "x"}, headers={"Origin": "https://evil.example"}
    )
    await _assert_blocked(response)
    # Same-site page on another local port.
    response = await client.post(
        "/api/lm/loras/delete",
        data={"file_path": "x"},
        headers={"Sec-Fetch-Site": "same-site", "Origin": "http://127.0.0.1:3000"},
    )
    await _assert_blocked(response)
    assert spy.calls == []


async def test_standalone_foreign_origin_with_client_header_is_blocked(standalone_client) -> None:
    client, spy = standalone_client
    response = await client.post(
        "/api/lm/settings",
        json={},
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example", CLIENT_HEADER: "lm-ui"},
    )
    await _assert_blocked(response)
    assert spy.calls == []


@pytest.mark.parametrize("method", UNSAFE)
async def test_standalone_same_origin_is_allowed(standalone_client, method) -> None:
    client, spy = standalone_client
    response = await client.request(
        method,
        "/api/lm/settings",
        json={"language": "en"},
        headers={"Sec-Fetch-Site": "same-origin", "Origin": _origin(client)},
    )
    assert response.status == 200
    assert len(spy.calls) == 1
    assert spy.calls[0][2]["body"] == b'{"language": "en"}'


async def test_standalone_same_origin_without_sec_fetch_site_needs_the_header(standalone_client) -> None:
    """Old browser / proxy stripping Sec-Fetch-Site: same-host Origin plus header."""
    client, spy = standalone_client
    origin = _origin(client)
    blocked = await client.post("/api/lm/settings", json={}, headers={"Origin": origin})
    await _assert_blocked(blocked)
    assert spy.calls == []
    allowed = await client.post(
        "/api/lm/settings", json={}, headers={"Origin": origin, CLIENT_HEADER: "lm-classic"}
    )
    assert allowed.status == 200
    assert len(spy.calls) == 1


async def test_standalone_non_browser_client_is_allowed(standalone_client) -> None:
    client, spy = standalone_client
    response = await client.post("/api/lm/settings", json={"language": "en"})
    assert response.status == 200
    assert len(spy.calls) == 1


async def test_standalone_extension_origin_is_allowed(standalone_client) -> None:
    client, spy = standalone_client
    response = await client.post(
        "/api/lm/settings",
        json={},
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "chrome-extension://abcdefghijklmnop"},
    )
    assert response.status == 200
    assert len(spy.calls) == 1


async def test_standalone_multipart_upload_keeps_working(standalone_client) -> None:
    client, spy = standalone_client
    form = FormData()
    form.add_field("name", "preview")
    form.add_field("file", b"\x89PNG data", filename="x.png", content_type="image/png")
    response = await client.post(
        "/api/lm/loras/delete",
        data=form,
        headers={"Sec-Fetch-Site": "same-origin", "Origin": _origin(client), CLIENT_HEADER: "lm-classic"},
    )
    assert response.status == 200
    details = spy.calls[0][2]
    assert details["content_type"] == "multipart/form-data"
    assert details["file"] == ("x.png", b"\x89PNG data")
    assert details["field"] == "preview"


async def test_standalone_cross_site_multipart_is_blocked(standalone_client) -> None:
    client, spy = standalone_client
    form = FormData()
    form.add_field("file", b"data", filename="x.png", content_type="image/png")
    response = await client.post(
        "/api/lm/loras/delete",
        data=form,
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
    )
    await _assert_blocked(response)
    assert spy.calls == []


async def test_standalone_options_and_read_only_get_stay_open(standalone_client) -> None:
    client, spy = standalone_client
    response = await client.get("/api/lm/settings", headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status == 200
    response = await client.options("/api/lm/settings", headers={"Sec-Fetch-Site": "cross-site"})
    assert response.status != 403


async def test_standalone_unknown_route_cross_site_post_is_blocked(standalone_client) -> None:
    client, _ = standalone_client
    response = await client.post(
        "/api/lm/does-not-exist", json={}, headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"}
    )
    await _assert_blocked(response)


@pytest.mark.parametrize("method", UNSAFE)
async def test_comfy_mode_non_get_methods_are_untouched(comfy_client, method) -> None:
    """ComfyUI's origin middleware covers these; the fork guard does not."""
    client, spy = comfy_client
    response = await client.request(
        method,
        "/api/lm/settings",
        json={},
        headers={"Sec-Fetch-Site": "cross-site", "Origin": "https://evil.example"},
    )
    assert response.status == 200
    assert len(spy.calls) == 1
