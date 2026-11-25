"""The ``allowed_hosts`` setting: default, normalisation, settings POST, and
the host check reading it from the settings manager (no file access)."""

from __future__ import annotations

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from py.routes.handlers.misc_handlers import SettingsHandler
from py.services import settings_manager as settings_manager_module
from py.services.settings_manager import DEFAULT_SETTINGS, SettingsManager
from py.utils import host_guard as host_module
from py.utils.host_guard import HOST_BLOCKED_CODE, standalone_host_guard


@pytest.fixture
def manager(tmp_path, monkeypatch):
    monkeypatch.setattr(SettingsManager, "_save_settings", lambda self: None)
    fake_settings_path = tmp_path / "settings.json"
    monkeypatch.setattr(
        "py.services.settings_manager.ensure_settings_file",
        lambda logger=None: str(fake_settings_path),
    )
    mgr = SettingsManager()
    mgr.settings_file = str(fake_settings_path)
    monkeypatch.setattr(settings_manager_module, "get_settings_manager", lambda: mgr)
    monkeypatch.delenv(host_module.ALLOWED_HOSTS_ENV, raising=False)
    return mgr


def test_default_is_an_empty_list(manager) -> None:
    assert DEFAULT_SETTINGS["allowed_hosts"] == []
    assert manager.get("allowed_hosts", []) == []


def test_set_normalises_entries(manager) -> None:
    manager.set("allowed_hosts", ["Comfy.LAN:8188", "*.My.Tld", "a@b", "", "comfy.lan", "http://pc.lan:8188/"])
    assert manager.get("allowed_hosts") == ["comfy.lan", "*.my.tld", "pc.lan"]
    manager.set("allowed_hosts", "x.lan, y.lan")
    assert manager.get("allowed_hosts") == ["x.lan", "y.lan"]
    manager.set("allowed_hosts", None)
    assert manager.get("allowed_hosts") == []


async def test_settings_post_updates_the_host_check(manager) -> None:
    handler = SettingsHandler(settings_service=manager)
    app = web.Application(middlewares=[standalone_host_guard])
    app.router.add_post("/api/lm/settings", handler.update_settings)
    app.router.add_get("/api/lm/settings", handler.get_settings)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        blocked = await client.get("/api/lm/settings", headers={"Host": "comfy.lan:8188"})
        assert blocked.status == 403
        assert (await blocked.json())["code"] == HOST_BLOCKED_CODE

        # Set from an accepted host (here the loopback address of the test server).
        response = await client.post("/api/lm/settings", json={"allowed_hosts": ["Comfy.LAN:8188"]})
        assert response.status == 200
        assert (await response.json())["success"] is True
        assert manager.get("allowed_hosts") == ["comfy.lan"]

        allowed = await client.get("/api/lm/settings", headers={"Host": "comfy.lan:8188"})
        assert allowed.status == 200
        body = await allowed.json()
        assert body["settings"]["allowed_hosts"] == ["comfy.lan"]
    finally:
        await client.close()


def test_provider_reads_the_settings_manager(manager) -> None:
    manager.set("allowed_hosts", ["comfy.lan"])
    assert host_module._default_allowed_hosts_provider() == ["comfy.lan"]
