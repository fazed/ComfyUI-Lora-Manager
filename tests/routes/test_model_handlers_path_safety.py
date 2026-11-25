"""Path-safety regression tests for model handlers that take a model path.

``replace_preview`` deleted ``<stem>.<every preview extension>`` and wrote a
preview plus a sidecar next to any path; ``save_metadata``/``add_tags``/
``relink_civitai``/``verify_duplicates`` wrote sidecars next to any existing
file. They now require the path to be inside the model type's library roots
(case-insensitive on Windows, fail closed when no root is configured).
"""

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from py.routes.handlers import misc_handlers
from py.routes.handlers.misc_handlers import ModelExampleFilesHandler, TrainedWordsHandler
from py.routes.handlers.model_handlers import ModelManagementHandler, ModelQueryHandler
from py.utils import library_roots


class _Scanner:
    def __init__(self, roots):
        self.roots = list(roots)
        self.cache = SimpleNamespace(raw_data=[], resort=AsyncMock())
        self.update_preview_in_cache = AsyncMock(return_value=True)
        self.update_single_model_cache = AsyncMock(return_value=None)

    def get_model_roots(self):
        return list(self.roots)

    async def get_cached_data(self):
        return self.cache


@pytest.fixture
def library(tmp_path):
    root = tmp_path / "loras"
    inside = root / "sub" / "model.safetensors"
    inside.parent.mkdir(parents=True)
    inside.write_bytes(b"model")
    outside_dir = tmp_path / "outside"
    outside_dir.mkdir()
    outside = outside_dir / "victim.safetensors"
    outside.write_bytes(b"victim")
    victims = [outside]
    for ext in (".png", ".webp", ".mp4", ".metadata.json"):
        victim = outside_dir / f"victim{ext}"
        victim.write_bytes(b"keep me")
        victims.append(victim)
    sibling = tmp_path / "loras_evil" / "victim.safetensors"
    sibling.parent.mkdir()
    sibling.write_bytes(b"victim")
    victims.append(sibling)
    return SimpleNamespace(
        tmp_path=tmp_path,
        root=root,
        inside=inside,
        outside=outside,
        sibling=sibling,
        victims=victims,
    )


def _outside_variants(library):
    return [
        str(library.outside),
        str(library.sibling),
        os.path.join(str(library.root), "..", "outside", "victim.safetensors"),
        "\\\\srv\\share\\victim.safetensors",
        "//srv/share/victim.safetensors",
    ]


def _snapshot(paths):
    return {str(p): p.read_bytes() for p in paths}


def _make_handler(roots):
    scanner = _Scanner(roots)
    service = SimpleNamespace(
        scanner=scanner,
        model_type="lora",
        format_response=AsyncMock(return_value={"ok": True}),
    )
    preview_service = SimpleNamespace(
        replace_preview=AsyncMock(
            return_value={"preview_path": "/x/model.webp", "preview_nsfw_level": 0}
        )
    )
    metadata_sync = SimpleNamespace(
        load_local_metadata=AsyncMock(return_value={}),
        save_metadata_updates=AsyncMock(return_value={}),
        relink_metadata=AsyncMock(return_value={"sha256": "abc"}),
        verify_duplicate_hashes=AsyncMock(return_value={}),
    )
    tag_update_service = SimpleNamespace(add_tags=AsyncMock(return_value=([], [])))
    handler = ModelManagementHandler(
        service=service,
        logger=__import__("logging").getLogger("test"),
        metadata_sync=metadata_sync,
        preview_service=preview_service,
        tag_update_service=tag_update_service,
        lifecycle_service=SimpleNamespace(),
    )
    return handler, SimpleNamespace(
        scanner=scanner,
        preview=preview_service,
        metadata_sync=metadata_sync,
        tags=tag_update_service,
    )


async def _client(handler):
    app = web.Application()
    app.router.add_post("/replace-preview", handler.replace_preview)
    app.router.add_post("/set-preview-from-url", handler.set_preview_from_url)
    app.router.add_post("/save-metadata", handler.save_metadata)
    app.router.add_post("/add-tags", handler.add_tags)
    app.router.add_post("/relink-civitai", handler.relink_civitai)
    app.router.add_post("/verify-duplicates", handler.verify_duplicates)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client


def _preview_form(model_path):
    form = aiohttp.FormData()
    form.add_field("preview_file", b"GIF89a", filename="p.gif", content_type="image/gif")
    form.add_field("model_path", model_path)
    form.add_field("nsfw_level", "0")
    return form


async def _post_all(client, path):
    return {
        "replace_preview": await client.post("/replace-preview", data=_preview_form(path)),
        "set_preview_from_url": await client.post(
            "/set-preview-from-url",
            json={"model_path": path, "image_url": "https://example.invalid/p.png"},
        ),
        "save_metadata": await client.post(
            "/save-metadata", json={"file_path": path, "notes": "x"}
        ),
        "add_tags": await client.post("/add-tags", json={"file_path": path, "tags": ["a"]}),
        "relink_civitai": await client.post(
            "/relink-civitai", json={"file_path": path, "model_id": 1}
        ),
        "verify_duplicates": await client.post(
            "/verify-duplicates", json={"file_paths": [path]}
        ),
    }


@pytest.fixture
def no_network(monkeypatch):
    from py.services import downloader

    calls = []

    async def fake_get_downloader():
        class _D:
            async def download_to_memory(self, url, **_kw):
                calls.append(url)
                return True, b"\x89PNG", {"Content-Type": "image/png"}

        return _D()

    monkeypatch.setattr(downloader, "get_downloader", fake_get_downloader)
    return calls


async def test_mutating_handlers_reject_paths_outside_roots(library, no_network):
    handler, fakes = _make_handler([str(library.root)])
    before = _snapshot(library.victims)
    client = await _client(handler)
    try:
        for path in _outside_variants(library):
            responses = await _post_all(client, path)
            for name, resp in responses.items():
                assert resp.status == 400, (name, path, await resp.text())
                assert "outside configured library" in await resp.text(), (name, path)
    finally:
        await client.close()

    fakes.preview.replace_preview.assert_not_awaited()
    fakes.metadata_sync.save_metadata_updates.assert_not_awaited()
    fakes.metadata_sync.relink_metadata.assert_not_awaited()
    fakes.metadata_sync.load_local_metadata.assert_not_awaited()
    fakes.metadata_sync.verify_duplicate_hashes.assert_not_awaited()
    fakes.tags.add_tags.assert_not_awaited()
    fakes.scanner.update_single_model_cache.assert_not_awaited()
    assert no_network == []
    # Nothing deleted or rewritten outside the roots.
    assert _snapshot(library.victims) == before
    assert sorted(p.name for p in (library.tmp_path / "outside").iterdir()) == sorted(
        p.name for p in library.victims if p.parent.name == "outside"
    )


async def test_mutating_handlers_fail_closed_without_roots(library, no_network):
    handler, fakes = _make_handler([])
    client = await _client(handler)
    try:
        responses = await _post_all(client, str(library.inside))
        for name, resp in responses.items():
            assert resp.status == 400, name
            assert "no library directories" in await resp.text(), name
    finally:
        await client.close()
    fakes.preview.replace_preview.assert_not_awaited()
    fakes.metadata_sync.save_metadata_updates.assert_not_awaited()


async def test_mutating_handlers_accept_library_paths(library, no_network):
    roots = [str(library.root).replace(os.sep, "/")]
    handler, fakes = _make_handler(roots)
    variants = [str(library.inside), str(library.inside).replace(os.sep, "/")]
    if os.name == "nt":
        variants.append(str(library.inside).upper())
    client = await _client(handler)
    try:
        for path in variants:
            responses = await _post_all(client, path)
            for name, resp in responses.items():
                assert resp.status == 200, (name, path, await resp.text())
    finally:
        await client.close()
    assert fakes.preview.replace_preview.await_count == 2 * len(variants)
    assert fakes.metadata_sync.save_metadata_updates.await_count == len(variants)
    assert fakes.tags.add_tags.await_count == len(variants)
    assert fakes.metadata_sync.relink_metadata.await_count == len(variants)
    assert fakes.metadata_sync.verify_duplicate_hashes.await_count == len(variants)


# --- GET handlers ------------------------------------------------------------


def _query_handler(roots, cache_paths=()):
    scanner = _Scanner(roots)

    async def find_cache_entry(path):
        return {"file_path": path} if path in cache_paths else None

    service = SimpleNamespace(
        scanner=scanner,
        model_type="lora",
        get_model_metadata_with_fallback=AsyncMock(return_value=({"a": 1}, False, False)),
        get_model_description=AsyncMock(return_value="desc"),
        _find_cache_entry=find_cache_entry,
    )
    return ModelQueryHandler(service=service, logger=__import__("logging").getLogger("t")), service


async def _get(handler_method, query):
    app = web.Application()
    app.router.add_get("/q", handler_method)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        resp = await client.get("/q", params=query)
        return resp.status, await resp.text()
    finally:
        await client.close()


async def test_metadata_get_handlers_confine_paths(library):
    cached_outside = str(library.tmp_path / "offline-root" / "m.safetensors")
    handler, service = _query_handler([str(library.root)], cache_paths={cached_outside})

    for path in _outside_variants(library):
        for method in (handler.get_model_metadata, handler.get_model_description):
            status, body = await _get(method, {"file_path": path})
            assert status == 400, (path, body)
    service.get_model_metadata_with_fallback.assert_not_awaited()
    service.get_model_description.assert_not_awaited()

    for path in (str(library.inside), cached_outside):
        status, _ = await _get(handler.get_model_metadata, {"file_path": path})
        assert status == 200
        status, _ = await _get(handler.get_model_description, {"file_path": path})
        assert status == 200


async def test_trained_words_and_example_files_confine_paths(library, monkeypatch):
    monkeypatch.setattr(
        library_roots, "configured_download_roots", lambda config_obj=None: [str(library.root)]
    )
    extract = AsyncMock(return_value=(["w"], None))
    monkeypatch.setattr(misc_handlers, "extract_trained_words", extract)
    touched = []
    real_exists = os.path.exists

    def spy_exists(path):
        touched.append(str(path))
        return real_exists(path)

    monkeypatch.setattr(misc_handlers.os.path, "exists", spy_exists)

    for path in _outside_variants(library):
        status, _ = await _get(TrainedWordsHandler().get_trained_words, {"file_path": path})
        assert status == 400, path
        status, _ = await _get(
            ModelExampleFilesHandler().get_model_example_files, {"model_path": path}
        )
        assert status == 400, path
    assert touched == []
    extract.assert_not_awaited()

    status, body = await _get(
        TrainedWordsHandler().get_trained_words, {"file_path": str(library.inside)}
    )
    assert status == 200, body
    extract.assert_awaited_once()
    status, body = await _get(
        ModelExampleFilesHandler().get_model_example_files,
        {"model_path": str(library.inside)},
    )
    assert status == 200, body
