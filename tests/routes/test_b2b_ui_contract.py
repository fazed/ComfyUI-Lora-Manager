"""Contract tests for the modern UI phase B2b (written before the UI).

They pin the backend behaviour the new UI relies on, on real temp files:

* example images: multipart import, NSFW level per image, delete of an
  imported image, the local file listing and the example-images path
  validation of ``POST /api/lm/settings``;
* backups: export never leaves a file behind and never prunes, restore
  overwrites exactly the known targets and refuses broken archives before
  touching anything;
* doctor: the filename-conflict fix renames the duplicate and its sidecars,
  the cache repair only rebuilds the caches;
* settings: per-key validation, partial writes, ``__DELETE__`` for the proxy
  credentials, the secret flags of GET and that secrets are not logged.
"""

from __future__ import annotations

import io
import json
import logging
import os
import zipfile
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer

import py.services.backup_service as backup_service
from py.routes.example_images_routes import ExampleImagesRoutes
from py.routes.handlers import misc_handlers
from py.routes.handlers.misc_handlers import BackupHandler, DoctorHandler, SettingsHandler
from py.services.settings_manager import get_settings_manager
from py.utils import example_images_processor as processor_module
from py.utils.cache_paths import CacheType

HASH = "ab" * 32


# --------------------------------------------------------------------------- helpers


class FakeRequest:
    def __init__(self, *, json_data=None, query=None, method="POST"):
        self._json_data = json_data or {}
        self.query = query or {}
        self.method = method

    async def json(self):
        return self._json_data


def _payload(response) -> Dict[str, Any]:
    assert response.text is not None
    return json.loads(response.text)


@pytest.fixture(autouse=True)
def restore_settings():
    manager = get_settings_manager()
    original = manager.settings.copy()
    try:
        yield
    finally:
        manager.settings.clear()
        manager.settings.update(original)


# --------------------------------------------------------------------------- example images


class StubScanner:
    def __init__(self, models):
        self._cache = SimpleNamespace(raw_data=models)
        self.synced: list[tuple[str, Dict[str, Any]]] = []

    async def get_cached_data(self, *_, **__):
        return self._cache

    async def update_single_model_cache(self, old_path, new_path, metadata):
        self.synced.append((new_path, metadata))
        return True

    def has_hash(self, value):
        return any(item.get("sha256") == value for item in self._cache.raw_data)


class StubDownloadManager:
    """Never started by these tests; download/status are mocked in the UI tests."""

    async def get_status(self, request):  # pragma: no cover - not exercised
        return {"success": True, "is_downloading": False, "status": {}}


@pytest.fixture
def example_env(monkeypatch, tmp_path):
    root = tmp_path / "examples"
    root.mkdir()
    models = tmp_path / "models"
    models.mkdir()
    model_file = models / "style.safetensors"
    model_file.write_bytes(b"weights")
    sidecar = {
        "file_name": "style",
        "model_name": "Style",
        "file_path": str(model_file).replace(os.sep, "/"),
        "sha256": HASH,
        "size": 7,
        "modified": 1.0,
        "base_model": "SDXL 1.0",
        "preview_url": "",
        "civitai": {
            "id": 1,
            "images": [
                {"url": "https://image.civitai.com/x/a.jpeg", "type": "image", "nsfwLevel": 1},
                {"url": "https://image.civitai.com/x/b.jpeg", "type": "image", "nsfwLevel": 1},
            ],
            "trainedWords": ["style"],
        },
    }
    (models / "style.metadata.json").write_text(json.dumps(sidecar), encoding="utf-8")

    settings = get_settings_manager()
    settings.settings["example_images_path"] = str(root)

    scanner = StubScanner([dict(sidecar)])

    async def _scanner(cls=None):
        return scanner

    for name in ("get_lora_scanner", "get_checkpoint_scanner", "get_embedding_scanner", "get_other_scanner"):
        monkeypatch.setattr(processor_module.ServiceRegistry, name, classmethod(_scanner))

    return SimpleNamespace(root=root, model_file=model_file, sidecar=models / "style.metadata.json", scanner=scanner)


@pytest.fixture
async def example_client(example_env):
    app = web.Application()
    ExampleImagesRoutes(ws_manager=SimpleNamespace(), download_manager=StubDownloadManager()).register(app)  # pyright: ignore[reportArgumentType]
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client
    finally:
        await client.close()


def _png_bytes() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (8, 6), (10, 20, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


def _sidecar(env) -> Dict[str, Any]:
    return json.loads(env.sidecar.read_text(encoding="utf-8"))


async def _import_one(client, env) -> Dict[str, Any]:
    form = FormData()
    form.add_field("model_hash", HASH)
    form.add_field("model_path", str(env.model_file))
    form.add_field("files", _png_bytes(), filename="mine.png", content_type="image/png")
    response = await client.post("/api/lm/import-example-images", data=form)
    assert response.status == 200, await response.text()
    return await response.json()


async def test_import_copies_file_as_custom_and_records_it(example_client, example_env):
    body = await _import_one(example_client, example_env)

    assert body["success"] is True
    [entry] = body["files"]
    assert entry["name"].startswith("custom_") and entry["name"].endswith(".png")
    assert entry["path"] == f"/example_images_static/{HASH}/{entry['name']}"
    assert entry["is_video"] is False
    assert (example_env.root / HASH / entry["name"]).read_bytes() == _png_bytes()

    short_id = entry["name"][len("custom_") : -len(".png")]
    [custom] = body["custom_images"]
    assert custom["id"] == short_id and custom["url"] == "" and custom["nsfwLevel"] == 0
    assert len(body["regular_images"]) == 2
    # Persisted in the sidecar, regular images untouched.
    saved = _sidecar(example_env)["civitai"]
    assert [c["id"] for c in saved["customImages"]] == [short_id]
    assert [i["url"] for i in saved["images"]] == [
        "https://image.civitai.com/x/a.jpeg",
        "https://image.civitai.com/x/b.jpeg",
    ]


async def test_import_without_files_or_hash_is_400(example_client):
    form = FormData(default_to_multipart=True)
    form.add_field("model_hash", HASH)
    response = await example_client.post("/api/lm/import-example-images", data=form)
    assert response.status == 400
    assert (await response.json())["success"] is False


async def test_file_listing_maps_regular_and_custom_files(example_client, example_env):
    folder = example_env.root / HASH
    folder.mkdir()
    (folder / "image_0.jpeg").write_bytes(b"a")
    (folder / "image_1.mp4").write_bytes(b"b")
    (folder / "notes.txt").write_bytes(b"ignored")

    response = await example_client.get("/api/lm/example-image-files", params={"model_hash": HASH})
    body = await response.json()
    assert response.status == 200 and body["success"] is True
    files = {f["name"]: f for f in body["files"]}
    assert set(files) == {"image_0.jpeg", "image_1.mp4"}
    assert files["image_1.mp4"]["is_video"] is True
    assert files["image_0.jpeg"]["path"] == f"/example_images_static/{HASH}/image_0.jpeg"

    has = await (await example_client.get("/api/lm/has-example-images", params={"model_hash": HASH})).json()
    assert has["has_images"] is True


async def test_file_listing_of_a_model_without_folder_is_empty_not_404(example_client):
    response = await example_client.get("/api/lm/example-image-files", params={"model_hash": "cd" * 32})
    assert response.status == 200
    assert (await response.json())["files"] == []


async def test_set_nsfw_level_for_regular_and_custom_images(example_client, example_env):
    body = await _import_one(example_client, example_env)
    short_id = body["custom_images"][0]["id"]

    response = await example_client.post(
        "/api/lm/example-images/set-nsfw-level",
        json={"model_hash": HASH, "nsfw_level": 8, "source": "civitai", "index": 1},
    )
    assert response.status == 200
    assert (await response.json())["regular_images"][1]["nsfwLevel"] == 8

    response = await example_client.post(
        "/api/lm/example-images/set-nsfw-level",
        json={"model_hash": HASH, "nsfw_level": 4, "source": "custom", "id": short_id},
    )
    assert response.status == 200

    saved = _sidecar(example_env)["civitai"]
    assert [i["nsfwLevel"] for i in saved["images"]] == [1, 8]
    assert saved["customImages"][0]["nsfwLevel"] == 4


@pytest.mark.parametrize(
    "payload, status",
    [
        ({"model_hash": HASH}, 400),
        ({"model_hash": HASH, "nsfw_level": "x", "index": 0}, 400),
        ({"model_hash": HASH, "nsfw_level": 4, "source": "custom"}, 400),
        ({"model_hash": HASH, "nsfw_level": 4, "index": "first"}, 400),
        ({"model_hash": HASH, "nsfw_level": 4, "index": 9}, 404),
        ({"model_hash": "ef" * 32, "nsfw_level": 4, "index": 0}, 404),
    ],
)
async def test_set_nsfw_level_validation(example_client, example_env, payload, status):
    before = example_env.sidecar.read_bytes()
    response = await example_client.post("/api/lm/example-images/set-nsfw-level", json=payload)
    assert response.status == status
    assert (await response.json())["success"] is False
    assert example_env.sidecar.read_bytes() == before


async def test_delete_removes_the_imported_file_and_entry(example_client, example_env):
    body = await _import_one(example_client, example_env)
    entry = body["files"][0]
    short_id = body["custom_images"][0]["id"]

    response = await example_client.post("/api/lm/delete-example-image", json={"model_hash": HASH, "short_id": short_id})
    result = await response.json()
    assert response.status == 200 and result["success"] is True
    assert result["custom_images"] == []
    assert not (example_env.root / HASH / entry["name"]).exists()
    saved = _sidecar(example_env)["civitai"]
    assert saved["customImages"] == []
    assert len(saved["images"]) == 2


async def test_delete_refuses_unknown_ids_and_regular_images(example_client, example_env):
    folder = example_env.root / HASH
    folder.mkdir()
    (folder / "image_0.jpeg").write_bytes(b"a")

    # No custom images at all: 404 and the regular file stays.
    response = await example_client.post("/api/lm/delete-example-image", json={"model_hash": HASH, "short_id": "0"})
    assert response.status == 404
    assert (folder / "image_0.jpeg").exists()

    await _import_one(example_client, example_env)
    response = await example_client.post("/api/lm/delete-example-image", json={"model_hash": HASH, "short_id": "nope"})
    assert response.status == 404

    response = await example_client.post("/api/lm/delete-example-image", json={"model_hash": HASH})
    assert response.status == 400


async def test_example_endpoints_without_a_configured_path(example_client, example_env):
    get_settings_manager().settings["example_images_path"] = ""
    response = await example_client.get("/api/lm/example-image-files", params={"model_hash": HASH})
    assert response.status == 400
    assert "No example images path configured" in (await response.json())["error"]
    response = await example_client.post("/api/lm/delete-example-image", json={"model_hash": HASH, "short_id": "x"})
    assert response.status == 400


# --------------------------------------------------------------------------- settings


class RecordingDownloader:
    def __init__(self):
        self.refreshed = 0

    async def refresh_session(self):
        self.refreshed += 1


def _settings_handler(downloader=None, provider_calls=None):
    downloader = downloader or RecordingDownloader()

    async def factory():
        return downloader

    async def updater():
        if provider_calls is not None:
            provider_calls.append(1)

    return SettingsHandler(
        settings_service=get_settings_manager(),
        metadata_provider_updater=updater,
        downloader_factory=factory,
    )


async def test_example_images_path_validation(tmp_path):
    handler = _settings_handler()
    settings = get_settings_manager()

    missing = tmp_path / "missing"
    body = _payload(await handler.update_settings(FakeRequest(json_data={"example_images_path": str(missing)})))
    assert body["success"] is False and "Path does not exist" in body["error"]

    a_file = tmp_path / "file.txt"
    a_file.write_text("x")
    body = _payload(await handler.update_settings(FakeRequest(json_data={"example_images_path": str(a_file)})))
    assert body["success"] is False

    busy = tmp_path / "busy"
    busy.mkdir()
    (busy / "holiday.jpg").write_bytes(b"x")
    body = _payload(await handler.update_settings(FakeRequest(json_data={"example_images_path": str(busy)})))
    assert body["success"] is False and "holiday.jpg" in body["error"]
    assert settings.get("example_images_path") in ("", None)

    dedicated = tmp_path / "dedicated"
    dedicated.mkdir()
    (dedicated / HASH).mkdir()
    body = _payload(await handler.update_settings(FakeRequest(json_data={"example_images_path": str(dedicated)})))
    assert body["success"] is True
    assert settings.get("example_images_path") == str(dedicated)
    # No folders are created or moved by setting the path.
    assert sorted(p.name for p in dedicated.iterdir()) == [HASH]

    body = _payload(await handler.update_settings(FakeRequest(json_data={"example_images_path": ""})))
    assert body["success"] is True and settings.get("example_images_path") == ""


async def test_update_is_partial_keys_before_an_invalid_one_are_saved():
    handler = _settings_handler()
    settings = get_settings_manager()
    settings.set("autoplay_on_hover", False)

    body = _payload(
        await handler.update_settings(
            FakeRequest(json_data={"autoplay_on_hover": True, "download_queue_max_concurrent": 9, "card_info_display": "hover"})
        )
    )
    assert body["success"] is False and "download_queue_max_concurrent" in body["error"]
    assert settings.get("autoplay_on_hover") is True  # written before the failing key
    assert settings.get("card_info_display") != "hover"  # never reached


async def test_update_with_validated_keys_first_saves_nothing_on_error():
    handler = _settings_handler()
    settings = get_settings_manager()
    settings.set("autoplay_on_hover", False)

    body = _payload(
        await handler.update_settings(FakeRequest(json_data={"download_queue_max_concurrent": 0, "autoplay_on_hover": True}))
    )
    assert body["success"] is False
    assert settings.get("autoplay_on_hover") is False


async def test_queue_concurrency_is_normalised_to_int():
    handler = _settings_handler()
    body = _payload(await handler.update_settings(FakeRequest(json_data={"download_queue_max_concurrent": "3"})))
    assert body["success"] is True
    assert get_settings_manager().get("download_queue_max_concurrent") == 3


async def test_proxy_changes_refresh_the_session_and_delete_marker_removes_credentials():
    downloader = RecordingDownloader()
    handler = _settings_handler(downloader)
    settings = get_settings_manager()

    body = _payload(
        await handler.update_settings(
            FakeRequest(json_data={"proxy_enabled": True, "proxy_host": "127.0.0.1", "proxy_port": "8080", "proxy_username": "u", "proxy_password": "pw-123"})
        )
    )
    assert body["success"] is True
    assert downloader.refreshed == 1  # once per request, not per key
    assert settings.get("proxy_password") == "pw-123"

    body = _payload(await handler.update_settings(FakeRequest(json_data={"proxy_username": "__DELETE__", "proxy_password": "__DELETE__"})))
    assert body["success"] is True
    assert settings.get("proxy_password") in (None, "")
    assert settings.get("proxy_username") in (None, "")
    assert downloader.refreshed == 2


async def test_unchanged_values_cause_no_side_effects():
    downloader = RecordingDownloader()
    calls: list[int] = []
    handler = _settings_handler(downloader, calls)
    settings = get_settings_manager()
    settings.set("proxy_host", "h")
    settings.set("enable_civarchive_api", True)
    body = _payload(await handler.update_settings(FakeRequest(json_data={"proxy_host": "h", "enable_civarchive_api": True})))
    assert body["success"] is True
    assert downloader.refreshed == 0 and calls == []

    body = _payload(await handler.update_settings(FakeRequest(json_data={"enable_civarchive_api": False})))
    assert calls == [1]


async def test_get_settings_hides_api_keys_but_exposes_set_flags():
    handler = _settings_handler()
    settings = get_settings_manager()
    settings.set("civitai_api_key", "civ-secret")
    settings.set("llm_api_key", "llm-secret")
    settings.set("proxy_password", "pw-secret")

    body = _payload(await handler.get_settings(FakeRequest(method="GET")))
    returned = body["settings"]
    text = json.dumps(returned)
    assert "civ-secret" not in text and "llm-secret" not in text
    assert returned["civitai_api_key_set"] is True and returned["llm_api_key_set"] is True
    assert returned["huggingface_api_key_set"] is False
    # Documented gap: the proxy password IS returned in clear; the new UI
    # strips it on read and only ever shows "configured".
    assert returned.get("proxy_password") == "pw-secret"
    assert returned["settings_file"]


async def test_saving_secrets_does_not_log_them(caplog):
    caplog.set_level(logging.DEBUG)
    handler = _settings_handler()
    body = _payload(
        await handler.update_settings(
            FakeRequest(json_data={"civitai_api_key": "civ-log-secret", "proxy_password": "pw-log-secret", "llm_api_key": "llm-log-secret"})
        )
    )
    assert body["success"] is True
    assert "civ-log-secret" not in caplog.text
    assert "pw-log-secret" not in caplog.text
    assert "llm-log-secret" not in caplog.text


# --------------------------------------------------------------------------- backups


class BackupSettings:
    def __init__(self, settings_file: Path, values=None):
        self.settings_file = str(settings_file)
        self._values = values or {}

    def get(self, key, default=None):
        return self._values.get(key, default)


@pytest.fixture
def backup_env(monkeypatch, tmp_path):
    settings_dir = tmp_path / "settings"
    cache_dir = settings_dir / "cache"
    settings_dir.mkdir()

    def fake_settings_dir(create=True):
        return str(settings_dir)

    def fake_cache_base(create=True):
        cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)

    def fake_cache_file(cache_type, library_name=None, create_dir=True):
        if cache_type == CacheType.SYMLINK:
            path = cache_dir / "symlink" / "symlink_map.json"
        else:
            path = cache_dir / "model_update" / f"{library_name or 'default'}.sqlite"
        path.parent.mkdir(parents=True, exist_ok=True)
        return str(path)

    monkeypatch.setattr(backup_service, "get_settings_dir", fake_settings_dir)
    monkeypatch.setattr(backup_service, "get_cache_base_dir", fake_cache_base)
    monkeypatch.setattr(backup_service, "get_cache_file_path", fake_cache_file)

    settings_file = settings_dir / "settings.json"
    settings_file.write_text('{"a": 1}', encoding="utf-8")
    history = cache_dir / "download_history" / "downloaded_versions.sqlite"
    history.parent.mkdir(parents=True)
    history.write_bytes(b"history-v1")
    symlinks = cache_dir / "symlink" / "symlink_map.json"
    symlinks.parent.mkdir(parents=True)
    symlinks.write_text("{}", encoding="utf-8")
    stats = settings_dir / "stats" / "lora_manager_stats.json"
    stats.parent.mkdir()
    stats.write_text('{"total_executions": 3}', encoding="utf-8")

    backups = settings_dir / "backups"
    service = backup_service.BackupService(
        settings_manager=BackupSettings(settings_file, {"backup_retention_count": 1}), backup_dir=str(backups)
    )
    return SimpleNamespace(
        service=service, backups=backups, settings_file=settings_file, history=history, symlinks=symlinks, stats=stats, settings_dir=settings_dir
    )


def _files(folder: Path) -> list[str]:
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


async def test_export_is_a_download_that_leaves_no_file_and_never_prunes(backup_env):
    for name in ("lora-manager-backup-20200101T000000Z-auto.zip", "lora-manager-backup-20200102T000000Z-auto.zip"):
        (backup_env.backups / name).write_bytes(b"old")
    before = _files(backup_env.backups)

    handler = BackupHandler(backup_service_factory=lambda: _async(backup_env.service))
    response = await handler.export_backup(FakeRequest())

    assert response.status == 200
    assert response.content_type == "application/zip"
    assert "-manual.zip" in response.headers["Content-Disposition"]
    # Retention is 1, yet the two auto snapshots stay: export does not prune.
    assert _files(backup_env.backups) == before
    with zipfile.ZipFile(io.BytesIO(response.body)) as archive:
        names = set(archive.namelist())
    assert names == {
        "manifest.json",
        "settings/settings.json",
        "cache/download_history/downloaded_versions.sqlite",
        "cache/symlink/symlink_map.json",
        "stats/lora_manager_stats.json",
    }


async def _async(value):
    return value


async def test_status_lists_snapshots_newest_first(backup_env):
    older = backup_env.backups / "lora-manager-backup-20200101T000000Z-auto.zip"
    newer = backup_env.backups / "lora-manager-backup-20200102T000000Z-manual.zip"
    older.write_bytes(b"1")
    newer.write_bytes(b"22")
    os.utime(older, (1_000, 1_000))
    os.utime(newer, (2_000, 2_000))
    (backup_env.backups / "unrelated.zip").write_bytes(b"x")

    handler = BackupHandler(backup_service_factory=lambda: _async(backup_env.service))
    body = _payload(await handler.get_backup_status(FakeRequest(method="GET")))
    assert [s["name"] for s in body["snapshots"]] == [newer.name, older.name]
    assert [s["is_auto"] for s in body["snapshots"]] == [False, True]
    assert body["snapshots"][0]["size"] == 2
    assert body["status"]["retentionCount"] == 1
    assert body["status"]["backupDir"] == str(backup_env.backups)


async def test_restore_overwrites_exactly_the_known_targets(backup_env):
    result = await backup_env.service.create_snapshot(snapshot_type="manual", persist=False)
    archive_bytes = result["archive_bytes"]
    assert _files(backup_env.backups) == []

    backup_env.settings_file.write_text('{"a": 2}', encoding="utf-8")
    backup_env.history.write_bytes(b"history-v2")
    backup_env.stats.write_text("{}", encoding="utf-8")
    unrelated = backup_env.settings_dir / "keep-me.txt"
    unrelated.write_text("untouched")

    archive_path = backup_env.settings_dir / "upload.zip"
    archive_path.write_bytes(archive_bytes)
    restored = await backup_env.service.restore_snapshot(str(archive_path))

    assert backup_env.settings_file.read_text(encoding="utf-8") == '{"a": 1}'
    assert backup_env.history.read_bytes() == b"history-v1"
    assert backup_env.stats.read_text(encoding="utf-8") == '{"total_executions": 3}'
    assert unrelated.read_text() == "untouched"
    assert restored


def _zip_with(manifest: Any, members: Dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        if manifest is not None:
            archive.writestr("manifest.json", json.dumps(manifest))
        for name, data in members.items():
            archive.writestr(name, data)
    return buffer.getvalue()


@pytest.mark.parametrize(
    "archive",
    [
        b"not a zip at all",
        _zip_with(None, {"settings/settings.json": b"{}"}),
        _zip_with({"manifest_version": 2, "files": []}, {}),
        _zip_with(
            {"manifest_version": 1, "files": [{"kind": "settings", "archive_path": "../settings.json"}]},
            {"../settings.json": b'{"evil": 1}'},
        ),
        _zip_with(
            {"manifest_version": 1, "files": [{"kind": "settings", "archive_path": "settings/settings.json", "sha256": "0" * 64}]},
            {"settings/settings.json": b'{"tampered": 1}'},
        ),
    ],
    ids=["not-zip", "no-manifest", "bad-version", "traversal", "checksum"],
)
async def test_restore_refuses_broken_archives_without_touching_anything(backup_env, archive):
    before = backup_env.settings_file.read_bytes()
    handler = BackupHandler(backup_service_factory=lambda: _async(backup_env.service))

    form = FormData()
    form.add_field("archive", archive, filename="backup.zip", content_type="application/zip")
    app = web.Application()
    app.router.add_post("/api/lm/backup/import", handler.import_backup)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        response = await client.post("/api/lm/backup/import", data=form)
        body = await response.json()
    finally:
        await client.close()

    assert response.status == 400
    assert body["success"] is False
    assert backup_env.settings_file.read_bytes() == before


async def test_restore_with_an_empty_upload_is_400(backup_env):
    handler = BackupHandler(backup_service_factory=lambda: _async(backup_env.service))
    app = web.Application()
    app.router.add_post("/api/lm/backup/import", handler.import_backup)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        response = await client.post("/api/lm/backup/import", data=b"")
    finally:
        await client.close()
    assert response.status == 400


# --------------------------------------------------------------------------- doctor


class ConflictIndex:
    def __init__(self, duplicates):
        self._duplicates = duplicates

    def get_duplicate_filenames(self):
        return self._duplicates


class DoctorScanner:
    def __init__(self, raw, duplicates=None):
        self._raw = raw
        self._hash_index = ConflictIndex(duplicates or {})
        self.rebuilds = 0
        self.updates: list[tuple[str, str]] = []
        self._persistent_cache = SimpleNamespace(load_cache=lambda _t: SimpleNamespace(raw_data=list(self._raw)))

    async def get_cached_data(self, force_refresh=False, rebuild_cache=False):
        if rebuild_cache:
            self.rebuilds += 1
        return SimpleNamespace(raw_data=self._raw)

    async def update_single_model_cache(self, old, new, entry):
        self.updates.append((old, new))
        return True


class DoctorSettings(dict):
    def get(self, key, default=None):  # type: ignore[override]
        return super().get(key, default)

    def is_other_models_enabled(self):
        return False

    def is_workflows_enabled(self):
        return False


def _doctor(scanner, settings=None):
    async def factory():
        return scanner

    async def no_client():  # pragma: no cover - only reached with an API key
        raise AssertionError("diagnostics must not call Civitai without a key")

    return DoctorHandler(
        settings_service=settings or DoctorSettings(),
        civitai_client_factory=no_client,
        scanner_factories=(("lora", "LoRAs", factory),),
        app_version_getter=lambda: "1.0.0-test",
    )


async def test_resolve_filename_conflicts_renames_the_duplicate_and_its_sidecars(tmp_path):
    first = tmp_path / "a" / "style.safetensors"
    second = tmp_path / "b" / "style.safetensors"
    for path in (first, second):
        path.parent.mkdir()
        path.write_bytes(b"w")
        path.with_name("style.metadata.json").write_text("{}")
        path.with_name("style.preview.png").write_bytes(b"p")
    raw = [
        {"file_path": str(first), "file_name": "style", "sha256": "1" * 64},
        {"file_path": str(second), "file_name": "style", "sha256": "abcd" + "2" * 60},
    ]
    scanner = DoctorScanner(raw, {"style": [str(first), str(second)]})

    body = _payload(await _doctor(scanner).resolve_filename_conflicts(FakeRequest()))

    assert body["success"] is True and body["count"] == 1
    [renamed] = body["renamed"]
    assert renamed["old_path"] == str(second)
    new_name = renamed["new_filename"]
    assert new_name.startswith("style-") and new_name.endswith(".safetensors")
    stem = new_name[: -len(".safetensors")]
    assert not second.exists()
    assert (second.parent / new_name).exists()
    assert (second.parent / f"{stem}.metadata.json").exists()
    assert (second.parent / f"{stem}.preview.png").exists()
    # The first copy keeps its name.
    assert first.exists() and first.with_name("style.metadata.json").exists()
    assert scanner.updates == [(str(second), str(second.parent / new_name))]


async def test_resolve_filename_conflicts_is_a_no_op_with_full_syntax(tmp_path):
    scanner = DoctorScanner([], {"style": ["x", "y"]})
    body = _payload(await _doctor(scanner, DoctorSettings(lora_syntax_format="full")).resolve_filename_conflicts(FakeRequest()))
    assert body == {"success": True, "renamed": [], "count": 0}


async def test_repair_cache_only_rebuilds_caches():
    scanner = DoctorScanner([{"file_path": "x", "sha256": "1" * 64}])
    body = _payload(await _doctor(scanner).repair_doctor_cache(FakeRequest()))
    assert body == {"success": True, "repaired": [{"model_type": "lora", "label": "LoRAs"}], "failures": []}
    assert scanner.rebuilds == 1


async def test_diagnostics_shape_without_api_key_makes_no_network_call():
    scanner = DoctorScanner([], {"style": ["a/style.safetensors", "b/style.safetensors"]})
    response = await _doctor(scanner).get_doctor_diagnostics(FakeRequest(query={"clientVersion": "1.0.0-test"}, method="GET"))
    body = _payload(response)
    assert body["success"] is True
    ids = [item["id"] for item in body["diagnostics"]]
    assert ids == ["civitai_api_key", "cache_health", "filename_conflicts", "sidecar_mirror_orphans", "ui_version"]
    by_id = {item["id"]: item for item in body["diagnostics"]}
    assert by_id["civitai_api_key"]["status"] == "warning"
    conflicts = by_id["filename_conflicts"]
    assert conflicts["status"] == "warning"
    assert conflicts["details"][0] == {"conflict_groups": 1, "total_conflict_files": 2}
    assert [a["id"] for a in conflicts["actions"]] == ["resolve-filename-conflicts", "open-settings-syntax-format"]
    assert body["summary"]["status"] in ("warning", "error")
    for item in body["diagnostics"]:
        assert set(item) >= {"id", "title", "status", "summary", "details", "actions"}


def test_misc_handlers_still_expose_the_b2b_routes():
    from py.routes.misc_route_registrar import MISC_ROUTE_DEFINITIONS

    routes = {(d.method, d.path) for d in MISC_ROUTE_DEFINITIONS}
    for expected in [
        ("GET", "/api/lm/backup/status"),
        ("POST", "/api/lm/backup/export"),
        ("POST", "/api/lm/backup/import"),
        ("GET", "/api/lm/doctor/diagnostics"),
        ("POST", "/api/lm/doctor/repair-cache"),
        ("POST", "/api/lm/doctor/resolve-filename-conflicts"),
        ("POST", "/api/lm/doctor/export-bundle"),
        ("GET", "/api/lm/environment"),
        ("GET", "/api/lm/metadata-archive-status"),
        ("POST", "/api/lm/download-metadata-archive"),
        ("POST", "/api/lm/remove-metadata-archive"),
        ("GET", "/api/lm/settings"),
        ("POST", "/api/lm/settings"),
    ]:
        assert expected in routes, expected
    assert misc_handlers is not None
