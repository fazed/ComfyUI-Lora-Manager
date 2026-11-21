"""Tests for the fork-local modern UI route module."""

from __future__ import annotations

from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from py.routes.modern_ui_routes import (
    ModernUiRoutes,
    parse_theme_header,
    relative_base_href,
)

INDEX_HTML = (
    "<!doctype html><html><head><meta charset=\"utf-8\">"
    "<script type=\"module\" src=\"./assets/index-abc.js\"></script>"
    "</head><body><div id=\"app\"></div></body></html>"
)


@pytest.fixture
def dist_dir(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX_HTML, encoding="utf-8")
    (dist / "assets" / "index-abc.js").write_text("console.log('ok')", encoding="utf-8")
    (dist / "favicon.svg").write_text("<svg/>", encoding="utf-8")
    return dist


@pytest.fixture
def themes_dir(tmp_path: Path) -> Path:
    themes = tmp_path / "ui-themes"
    themes.mkdir()
    (themes / "sunset.css").write_text(
        '/* @lm-theme {"id": "sunset", "label": "Sunset", "scheme": "dark",'
        ' "description": "Warm"} */\n:root[data-theme="sunset"] { --lm-color-bg: #200; }\n',
        encoding="utf-8",
    )
    (themes / "plain.css").write_text(":root { }\n", encoding="utf-8")
    (themes / "notes.txt").write_text("ignored", encoding="utf-8")
    return themes


async def _client(dist: Path, themes: Path | None) -> TestClient:
    app = web.Application()
    ModernUiRoutes.setup_routes(
        app, dist_dir=str(dist), user_themes_dir=str(themes) if themes else ""
    )
    client = TestClient(TestServer(app))
    await client.start_server()
    return client


def test_relative_base_href_depths() -> None:
    assert relative_base_href("") == "./"
    assert relative_base_href("loras") == "./"
    assert relative_base_href("loras/") == "../"
    assert relative_base_href("loras/detail") == "../"
    assert relative_base_href("a/b/c") == "../../"


def test_parse_theme_header_defaults_and_validation() -> None:
    assert parse_theme_header(":root{}", "mine") == {
        "id": "mine",
        "label": "mine",
        "scheme": "light",
        "description": "",
    }
    meta = parse_theme_header('/* @lm-theme {"id": "../evil", "scheme": "x"} */', "ok")
    assert meta["id"] == "ok"
    assert meta["scheme"] == "light"
    broken = parse_theme_header("/* @lm-theme {not json} */", "fallback")
    assert broken["id"] == "fallback"


@pytest.mark.asyncio
async def test_serves_index_with_base_tag(dist_dir: Path) -> None:
    client = await _client(dist_dir, None)
    try:
        resp = await client.get("/lm-ui/")
        assert resp.status == 200
        assert resp.headers["Content-Type"].startswith("text/html")
        body = await resp.text()
        assert '<head><base href="./">' in body
        assert "./assets/index-abc.js" in body
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_spa_fallback_uses_relative_base_for_deep_routes(dist_dir: Path) -> None:
    client = await _client(dist_dir, None)
    try:
        shallow = await client.get("/lm-ui/downloads")
        assert shallow.status == 200
        assert '<base href="./">' in await shallow.text()

        deep = await client.get("/lm-ui/loras/some/folder")
        assert deep.status == 200
        assert '<base href="../../">' in await deep.text()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_mount_without_slash_redirects_relatively(dist_dir: Path) -> None:
    client = await _client(dist_dir, None)
    try:
        resp = await client.get("/lm-ui?x=1", allow_redirects=False)
        assert resp.status == 302
        # Relative target keeps any reverse-proxy prefix in front of /lm-ui.
        assert resp.headers["Location"] == "lm-ui/?x=1"
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_serves_assets_and_404s_missing_ones(dist_dir: Path) -> None:
    client = await _client(dist_dir, None)
    try:
        asset = await client.get("/lm-ui/assets/index-abc.js")
        assert asset.status == 200
        assert "immutable" in asset.headers.get("Cache-Control", "")
        assert await asset.text() == "console.log('ok')"

        icon = await client.get("/lm-ui/favicon.svg")
        assert icon.status == 200

        missing = await client.get("/lm-ui/assets/missing-123.js")
        assert missing.status == 404

        traversal = await client.get("/lm-ui/assets/..%2F..%2Fsecret.txt")
        assert traversal.status == 404
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_reports_unbuilt_dist(tmp_path: Path) -> None:
    client = await _client(tmp_path / "nope", None)
    try:
        resp = await client.get("/lm-ui/")
        assert resp.status == 503
        assert "bun run build" in await resp.text()
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_head_probe_tells_built_from_unbuilt(dist_dir: Path, tmp_path: Path) -> None:
    # The ComfyUI top-bar button (web/comfyui/modern_ui_link.js) sends
    # HEAD /lm-ui/ and falls back to the classic UI unless it gets a 2xx.
    built = await _client(dist_dir, None)
    try:
        assert (await built.head("/lm-ui/")).status == 200
    finally:
        await built.close()

    unbuilt = await _client(tmp_path / "nope", None)
    try:
        assert (await unbuilt.head("/lm-ui/")).status == 503
    finally:
        await unbuilt.close()


@pytest.mark.asyncio
async def test_lists_and_serves_user_themes(dist_dir: Path, themes_dir: Path) -> None:
    client = await _client(dist_dir, themes_dir)
    try:
        resp = await client.get("/api/lm/ui/themes")
        assert resp.status == 200
        payload = await resp.json()
        assert payload["success"] is True
        by_id = {theme["id"]: theme for theme in payload["themes"]}
        assert set(by_id) == {"sunset", "plain"}
        assert by_id["sunset"] == {
            "id": "sunset",
            "label": "Sunset",
            "scheme": "dark",
            "description": "Warm",
            "href": "user-themes/sunset.css",
        }

        css = await client.get("/lm-ui/user-themes/sunset.css")
        assert css.status == 200
        assert css.headers["Content-Type"].startswith("text/css")

        assert (await client.get("/lm-ui/user-themes/notes.txt")).status == 404
        assert (await client.get("/lm-ui/user-themes/missing.css")).status == 404
    finally:
        await client.close()


@pytest.mark.asyncio
async def test_theme_listing_without_directory(dist_dir: Path, tmp_path: Path) -> None:
    client = await _client(dist_dir, tmp_path / "does-not-exist")
    try:
        payload = await (await client.get("/api/lm/ui/themes")).json()
        assert payload["themes"] == []
    finally:
        await client.close()
