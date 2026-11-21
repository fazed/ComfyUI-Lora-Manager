"""Queue destination: a queued download can carry a chosen root / folder.

The modern UI's download dialog lets the user pick a library root and a
sub-folder (or "use default path" under a non-default root). The fork's queue
used to always start rows with ``use_default_paths: true``. These tests pin
the optional ``destination`` stored with a queue row:

* ``queue/add`` accepts ``model_root``, ``relative_path`` and
  ``use_default_paths`` and validates them (root must be a configured model
  root, the folder must stay below it);
* the row keeps the destination through history and retry;
* the worker payload passes it to the download use case.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import urlencode

import pytest
from aiohttp.test_utils import make_mocked_request

from py import config as config_module
from py.routes.handlers.model_handlers import ModelDownloadHandler
from py.services.download_queue_service import DownloadQueueService
from py.services.download_queue_worker import build_queue_download_payload


@pytest.fixture
def queue_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> DownloadQueueService:
    service = DownloadQueueService(db_path=str(tmp_path / "queue.sqlite"))

    async def fake_get_instance(_cls: object = None) -> DownloadQueueService:
        return service

    monkeypatch.setattr(DownloadQueueService, "get_instance", fake_get_instance)
    return service


@pytest.fixture
def roots(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    lora = tmp_path / "models" / "loras"
    ckpt = tmp_path / "models" / "checkpoints"
    for path in (lora, ckpt):
        path.mkdir(parents=True)
    monkeypatch.setattr(config_module.config, "loras_roots", [str(lora)])
    monkeypatch.setattr(config_module.config, "base_models_roots", [str(ckpt)])
    monkeypatch.setattr(config_module.config, "embeddings_roots", [], raising=False)
    for attr in ("extra_loras_roots", "extra_checkpoints_roots", "extra_unet_roots", "extra_embeddings_roots"):
        monkeypatch.setattr(config_module.config, attr, [], raising=False)
    return {"lora": lora, "checkpoint": ckpt}


@pytest.fixture(autouse=True)
def isolated_worker(monkeypatch: pytest.MonkeyPatch):
    from py.services import download_queue_worker as worker_module

    async def no_cooldown() -> float:
        return 0.0

    async def manager_factory():
        return SimpleNamespace(get_running_download_ids=lambda: set())

    worker = worker_module.DownloadQueueWorker(
        download_runner=AsyncMock(return_value={"success": True}),
        download_manager_factory=manager_factory,
        cooldown_probe=no_cooldown,
        settings_getter=lambda: SimpleNamespace(get=lambda key, default=None: default),
        startup_delay_seconds=0,
    )
    monkeypatch.setattr(worker_module, "_worker", worker)
    return worker


def _handler() -> ModelDownloadHandler:
    return ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType]
        logger=logging.getLogger("test-queue-destination"),
        download_use_case=None,  # pyright: ignore[reportArgumentType]
        download_coordinator=None,  # pyright: ignore[reportArgumentType]
    )


def _add(query: dict[str, str]):
    return make_mocked_request("GET", f"/api/lm/downloads/queue/add?{urlencode(query)}")


def _posix(path: Path) -> str:
    return str(path).replace("\\", "/")


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_destination_survives_history_and_retry(queue_service: DownloadQueueService, tmp_path: Path):
    destination = {"model_root": "/lib/loras", "relative_path": "style/anime", "use_default_paths": False}
    row = await queue_service.add_to_queue(download_id="dl-1", model_id=1, model_version_id=10, destination=destination)
    assert json.loads(row["destination"]) == destination

    await queue_service.complete_download("dl-1", "failed", error="boom")
    history = await queue_service.get_history()
    assert json.loads(history["items"][0]["destination"]) == destination

    retried = await queue_service.retry_from_history(download_id="dl-1")
    assert retried is not None
    assert json.loads(retried["destination"]) == destination


@pytest.mark.asyncio
async def test_retry_all_keeps_the_destination(queue_service: DownloadQueueService):
    destination = {"model_root": "/lib/loras", "relative_path": "x", "use_default_paths": False}
    await queue_service.add_to_queue(download_id="dl-a", model_id=1, destination=destination)
    await queue_service.complete_download("dl-a", "failed")

    assert await queue_service.retry_all_failed() == 1
    queue = await queue_service.get_queue()
    assert json.loads(queue[0]["destination"]) == destination


@pytest.mark.asyncio
async def test_rows_without_destination_stay_null(queue_service: DownloadQueueService):
    row = await queue_service.add_to_queue(download_id="dl-plain", model_id=2)
    assert row["destination"] is None


def test_existing_database_is_migrated(tmp_path: Path):
    db = tmp_path / "old.sqlite"
    conn = sqlite3.connect(db)
    # Pre-destination schema (columns as before phase B1).
    conn.executescript(
        """
        CREATE TABLE download_queue (
            download_id TEXT PRIMARY KEY, model_id INTEGER, model_version_id INTEGER,
            model_name TEXT NOT NULL DEFAULT '', version_name TEXT DEFAULT '',
            thumbnail_url TEXT DEFAULT '', source TEXT, file_params TEXT,
            status TEXT NOT NULL DEFAULT 'queued', priority INTEGER DEFAULT 0,
            progress INTEGER DEFAULT 0, bytes_downloaded INTEGER DEFAULT 0,
            total_bytes INTEGER, bytes_per_second REAL DEFAULT 0.0, error TEXT,
            file_path TEXT, added_at REAL NOT NULL, started_at REAL, completed_at REAL
        );
        CREATE TABLE download_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT, download_id TEXT, model_id INTEGER,
            model_version_id INTEGER, model_name TEXT NOT NULL DEFAULT '',
            version_name TEXT DEFAULT '', thumbnail_url TEXT DEFAULT '', file_params TEXT,
            status TEXT NOT NULL, error TEXT, file_path TEXT, bytes_downloaded INTEGER DEFAULT 0,
            total_bytes INTEGER, completed_at REAL NOT NULL, is_already_exists INTEGER DEFAULT 0
        );
        INSERT INTO download_queue (download_id, model_id, added_at) VALUES ('old-row', 7, 1.0);
        """
    )
    conn.commit()
    conn.close()

    DownloadQueueService(db_path=str(db))

    conn = sqlite3.connect(db)
    queue_cols = {row[1] for row in conn.execute("PRAGMA table_info(download_queue)")}
    history_cols = {row[1] for row in conn.execute("PRAGMA table_info(download_history)")}
    kept = conn.execute("SELECT model_id, destination FROM download_queue WHERE download_id='old-row'").fetchone()
    conn.close()
    assert "destination" in queue_cols and "destination" in history_cols
    assert kept == (7, None)


# ---------------------------------------------------------------------------
# Worker payload
# ---------------------------------------------------------------------------


def test_payload_without_destination_uses_default_paths():
    payload = build_queue_download_payload({"model_id": 1, "download_id": "d", "destination": None})
    assert payload["use_default_paths"] is True
    assert "model_root" not in payload and "relative_path" not in payload


def test_payload_with_explicit_folder():
    row = {
        "model_id": 1,
        "download_id": "d",
        "destination": json.dumps({"model_root": "/lib/loras", "relative_path": "style/anime", "use_default_paths": False}),
    }
    payload = build_queue_download_payload(row)
    assert payload["use_default_paths"] is False
    assert payload["model_root"] == "/lib/loras"
    assert payload["relative_path"] == "style/anime"
    assert not payload.get("use_save_dir_as_root")


def test_payload_with_default_path_under_a_chosen_root():
    row = {
        "model_id": 1,
        "download_id": "d",
        "destination": json.dumps({"model_root": "/lib/loras2", "relative_path": "", "use_default_paths": True}),
    }
    payload = build_queue_download_payload(row)
    assert payload["use_default_paths"] is True
    assert payload["model_root"] == "/lib/loras2"
    assert payload["use_save_dir_as_root"] is True


def test_payload_ignores_a_corrupt_destination():
    payload = build_queue_download_payload({"model_id": 1, "download_id": "d", "destination": "{not json"})
    assert payload["use_default_paths"] is True
    assert "model_root" not in payload


# ---------------------------------------------------------------------------
# queue/add handler
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_queue_add_stores_a_valid_destination(queue_service, roots):
    response = await _handler().add_to_download_queue(
        _add(
            {
                "download_id": "dl-d",
                "model_id": "5",
                "model_version_id": "50",
                "model_root": str(roots["lora"]),
                "relative_path": "style/anime",
                "use_default_paths": "false",
            }
        )
    )
    payload = json.loads(response.text)
    assert response.status == 200
    assert payload["queued"] is True
    stored = json.loads(payload["item"]["destination"])
    assert stored == {"model_root": _posix(roots["lora"]), "relative_path": "style/anime", "use_default_paths": False}


@pytest.mark.asyncio
async def test_queue_add_default_path_under_a_root(queue_service, roots):
    response = await _handler().add_to_download_queue(
        _add({"download_id": "dl-r", "model_id": "6", "model_root": str(roots["checkpoint"]), "use_default_paths": "true"})
    )
    payload = json.loads(response.text)
    stored = json.loads(payload["item"]["destination"])
    assert stored == {"model_root": _posix(roots["checkpoint"]), "relative_path": "", "use_default_paths": True}


@pytest.mark.asyncio
async def test_queue_add_without_destination_params_keeps_legacy_behaviour(queue_service, roots):
    response = await _handler().add_to_download_queue(_add({"download_id": "dl-l", "model_id": "7"}))
    payload = json.loads(response.text)
    assert payload["queued"] is True
    assert payload["item"]["destination"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "extra",
    [
        {"model_root": "C:/not-a-root", "use_default_paths": "false"},
        {"model_root": "ROOT", "relative_path": "../escape", "use_default_paths": "false"},
        {"model_root": "ROOT", "relative_path": "a/../../escape", "use_default_paths": "false"},
        {"model_root": "ROOT", "relative_path": "/abs/path", "use_default_paths": "false"},
        {"model_root": "ROOT", "relative_path": "C:/abs", "use_default_paths": "false"},
        {"model_root": "ROOT", "relative_path": "bad*name", "use_default_paths": "false"},
        {"relative_path": "style", "use_default_paths": "false"},
    ],
)
async def test_queue_add_rejects_unsafe_destinations(queue_service, roots, extra):
    query = {"download_id": "dl-x", "model_id": "8"}
    for key, value in extra.items():
        query[key] = str(roots["lora"]) if value == "ROOT" else value
    response = await _handler().add_to_download_queue(_add(query))
    assert response.status == 400
    payload = json.loads(response.text)
    assert payload["success"] is False
    assert await queue_service.get_queue() == []


@pytest.mark.asyncio
async def test_retry_with_start_passes_the_destination_to_the_runner(queue_service, roots, isolated_worker):
    destination = {"model_root": _posix(roots["lora"]), "relative_path": "x", "use_default_paths": False}
    await queue_service.add_to_history(download_id="dl-h", model_id=1, status="failed", destination=destination)
    runner = AsyncMock(return_value={"success": True})
    handler = ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType]
        logger=logging.getLogger("test-queue-destination"),
        download_use_case=SimpleNamespace(execute=runner),  # pyright: ignore[reportArgumentType]
        download_coordinator=None,  # pyright: ignore[reportArgumentType]
    )

    response = await handler.retry_download_from_history(
        make_mocked_request("GET", "/api/lm/downloads/history/retry?download_id=dl-h&start=true")
    )

    assert response.status == 200
    sent = runner.await_args.args[0]
    assert sent["use_default_paths"] is False
    assert sent["model_root"] == _posix(roots["lora"])
    assert sent["relative_path"] == "x"
