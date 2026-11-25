"""Replace-after-download (version management): validation and completion.

Everything runs in ``tmp_path`` sandboxes with fake scanners. Each test that
could delete something asserts exactly which files exist afterwards.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import urlencode

import pytest
from aiohttp.test_utils import make_mocked_request

from py.services import version_replace as vr
from py.services.download_queue_service import DownloadQueueService
from py.services.download_queue_worker import DownloadQueueWorker
from py.services.model_lifecycle_service import ModelLifecycleService
from py.services.pending_delete_service import (
    MANIFEST_FILE_NAME,
    PENDING_DELETE_DIR_NAME,
    _reset_pending_delete_service,
)

MODEL_ID = 100
OLD_VERSION = 1001
NEW_VERSION = 1002


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class _Cache:
    def __init__(self, raw_data: List[Dict[str, Any]]) -> None:
        self.raw_data = raw_data

    async def resort(self) -> None:
        return None


class FakeScanner:
    def __init__(self, roots: List[str], raw_data: List[Dict[str, Any]], model_type: str = "lora") -> None:
        self.model_type = model_type
        self._roots = roots
        self.cache = _Cache(raw_data)
        self._hash_index = None

    def get_model_roots(self) -> List[str]:
        return list(self._roots)

    async def get_cached_data(self, *args: Any, **kwargs: Any) -> _Cache:
        return self.cache

    async def _persist_current_cache(self) -> None:
        return None

    async def get_model_versions_by_id(self, model_id: int) -> List[Dict[str, Any]]:
        return [
            {"versionId": item["civitai"]["id"]}
            for item in self.cache.raw_data
            if item.get("civitai", {}).get("modelId") == model_id
        ]


class FakeLifecycle:
    """Records the delete call; ``mode`` decides the answer."""

    def __init__(self, mode: str = "stage") -> None:
        self.mode = mode
        self.calls: List[Dict[str, Any]] = []

    async def delete_model(self, file_path: str, **kwargs: Any) -> Dict[str, Any]:
        self.calls.append({"file_path": file_path, **kwargs})
        if self.mode == "raise":
            raise OSError("disk on fire")
        if self.mode == "no_batch":
            return {"success": False, "batch_id": None, "error": "staging_failed"}
        return {"success": True, "batch_id": "batch-1"}


class _Metadata:
    async def load_metadata_payload(self, file_path: str) -> Dict[str, Any]:
        return {"civitai": {"modelId": MODEL_ID}}


async def _empty_loader(path: str) -> Dict[str, Any]:
    return {}


def _entry(path: Path, version_id: int, model_id: int = MODEL_ID, base: str = "Anima") -> Dict[str, Any]:
    return {
        "file_path": path.as_posix(),
        "file_name": path.stem,
        "folder": "",
        "base_model": base,
        "size": path.stat().st_size if path.exists() else 0,
        "civitai": {"modelId": model_id, "id": version_id, "name": f"v{version_id}"},
    }


def _write(path: Path, content: bytes = b"weights") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return path


def _files(root: Path) -> List[str]:
    return sorted(
        p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _isolated_pending_delete(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    from py.services.service_registry import ServiceRegistry

    async def _none(*_args: Any, **_kwargs: Any) -> None:
        return None

    monkeypatch.setattr(ServiceRegistry, "get_lora_scanner", _none)
    monkeypatch.setattr(ServiceRegistry, "get_checkpoint_scanner", _none)
    monkeypatch.setattr(ServiceRegistry, "get_embedding_scanner", _none)
    _reset_pending_delete_service()
    yield
    _reset_pending_delete_service()


@pytest.fixture
def library(tmp_path: Path) -> Dict[str, Any]:
    root = tmp_path / "loras"
    old = _write(root / "chars" / "eldreda_v1.safetensors", b"old weights")
    other = _write(root / "chars" / "eldreda_illustrious_v1.safetensors", b"il weights")
    _write(root / "chars" / "eldreda_v1.metadata.json", b"{}")
    _write(root / "chars" / "eldreda_v1.preview.png", b"png")
    scanner = FakeScanner(
        [root.as_posix()],
        [_entry(old, OLD_VERSION), _entry(other, 900, base="Illustrious")],
    )
    return {"root": root, "old": old, "other": other, "scanner": scanner, "tmp": tmp_path}


@pytest.fixture
def queue(tmp_path: Path) -> DownloadQueueService:
    return DownloadQueueService(db_path=str(tmp_path / "db" / "queue.sqlite"))


def _add_new_file(library: Dict[str, Any], content: bytes = b"new weights") -> Path:
    new = _write(library["root"] / "chars" / "eldreda_v2.safetensors", content)
    library["scanner"].cache.raw_data.append(_entry(new, NEW_VERSION))
    return new


async def _validate(library: Dict[str, Any], paths: List[str], **kwargs: Any) -> List[Dict[str, Any]]:
    return await vr.validate_replace_targets(
        paths,
        model_id=kwargs.get("model_id", MODEL_ID),
        model_version_id=kwargs.get("model_version_id", NEW_VERSION),
        queue_rows=kwargs.get("queue_rows", []),
        scanners={"lora": library["scanner"]},
    )


async def _queue_completed(
    queue: DownloadQueueService,
    targets: List[Dict[str, Any]],
    *,
    download_id: str = "dl-1",
    status: str = "completed",
) -> None:
    await queue.add_to_queue(
        download_id=download_id,
        model_id=MODEL_ID,
        model_version_id=NEW_VERSION,
        replace_targets=targets,
        deduplicate=False,
    )
    await queue.complete_download(download_id, status=status)


async def _run(queue: DownloadQueueService, library: Dict[str, Any], lifecycle: Any, download_id: str = "dl-1"):
    async def scanners() -> Dict[str, Any]:
        return {"lora": library["scanner"]}

    async def factory(_scanner: Any) -> Any:
        return lifecycle

    return await vr.run_replace_for_download(
        download_id,
        queue_service=queue,
        scanners_provider=scanners,
        lifecycle_factory=factory,
    )


async def _history_row(queue: DownloadQueueService, download_id: str = "dl-1") -> Dict[str, Any]:
    items = (await queue.get_history())["items"]
    return next(item for item in items if item["download_id"] == download_id)


# ---------------------------------------------------------------------------
# Validation at queue time
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_accepts_another_version_of_the_same_model(library):
    targets = await _validate(library, [str(library["old"])])
    assert targets == [
        {
            "path": library["old"].as_posix(),
            "file_name": "eldreda_v1.safetensors",
            "model_type": "lora",
            "version_id": OLD_VERSION,
            "version_name": f"v{OLD_VERSION}",
            "size": len(b"old weights"),
        }
    ]


@pytest.mark.asyncio
async def test_validate_dedupes_and_accepts_backslash_spelling(library):
    raw = str(library["old"]).replace("/", "\\")
    targets = await _validate(library, [raw, library["old"].as_posix()])
    assert [t["path"] for t in targets] == [library["old"].as_posix()]


@pytest.mark.asyncio
async def test_validate_rejects_other_model(library):
    library["scanner"].cache.raw_data[0]["civitai"]["modelId"] = 555
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [str(library["old"])])
    assert info.value.code == vr.CODE_MODEL_MISMATCH


@pytest.mark.asyncio
async def test_validate_rejects_same_version(library):
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [str(library["old"])], model_version_id=OLD_VERSION)
    assert info.value.code == vr.CODE_SAME_VERSION


@pytest.mark.asyncio
async def test_validate_rejects_file_unknown_to_the_scanner(library):
    stray = _write(library["root"] / "stray.safetensors")
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [str(stray)])
    assert info.value.code == vr.CODE_NOT_IN_LIBRARY


@pytest.mark.asyncio
async def test_validate_rejects_cached_file_missing_on_disk(library):
    library["old"].unlink()
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [library["old"].as_posix()])
    assert info.value.code == vr.CODE_NOT_IN_LIBRARY


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "hostile",
    [
        "loras/chars/eldreda_v1.safetensors",
        "C:eldreda_v1.safetensors",
        "\\\\evil-host\\share\\eldreda_v1.safetensors",
        "//evil-host/share/eldreda_v1.safetensors",
        "\\\\?\\C:\\Windows\\win.ini",
        "\\\\.\\PhysicalDrive0",
        "",
        "   ",
        "eldreda\x00.safetensors",
    ],
)
async def test_validate_rejects_hostile_strings(library, hostile):
    before = _files(library["tmp"])
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [hostile] if hostile.strip() else [hostile, "x\x01"])
    assert info.value.code in {vr.CODE_INVALID_PATH, vr.CODE_OUTSIDE_ROOTS}
    assert _files(library["tmp"]) == before


@pytest.mark.asyncio
async def test_validate_rejects_dot_dot_even_when_it_lands_inside(library):
    sneaky = (library["root"] / "chars" / ".." / "chars" / "eldreda_v1.safetensors").as_posix()
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [sneaky])
    assert info.value.code == vr.CODE_INVALID_PATH


@pytest.mark.asyncio
async def test_validate_rejects_dot_dot_escape(library):
    outside = _write(library["tmp"] / "outside.safetensors")
    escape = (library["root"] / ".." / "outside.safetensors").as_posix()
    with pytest.raises(vr.ReplaceValidationError):
        await _validate(library, [escape])
    assert outside.exists()


@pytest.mark.asyncio
async def test_validate_rejects_outside_roots_even_if_cached(library):
    # A cache entry outside every root (prefix sibling "loras_evil").
    evil = _write(library["tmp"] / "loras_evil" / "eldreda_v0.safetensors")
    library["scanner"].cache.raw_data.append(_entry(evil, 999))
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [evil.as_posix()])
    assert info.value.code == vr.CODE_OUTSIDE_ROOTS
    assert evil.exists()


@pytest.mark.asyncio
@pytest.mark.requires_symlinks
async def test_validate_rejects_symlinked_file(library):
    outside = _write(library["tmp"] / "elsewhere" / "real.safetensors")
    link = library["root"] / "chars" / "linked.safetensors"
    os.symlink(outside, link)
    library["scanner"].cache.raw_data.append(_entry(link, 990))
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [link.as_posix()])
    assert info.value.code == vr.CODE_INVALID_PATH
    assert outside.exists() and os.path.islink(link)


@pytest.mark.asyncio
async def test_validate_rejects_version_that_is_itself_queued(library):
    rows = [{"download_id": "x", "model_version_id": OLD_VERSION}]
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [str(library["old"])], queue_rows=rows)
    assert info.value.code == vr.CODE_TARGET_QUEUED


@pytest.mark.asyncio
async def test_validate_rejects_file_another_item_already_replaces(library):
    rows = [
        {
            "download_id": "x",
            "model_version_id": 7,
            "replace_targets": json.dumps([{"path": library["old"].as_posix()}]),
        }
    ]
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [str(library["old"])], queue_rows=rows)
    assert info.value.code == vr.CODE_TARGET_PENDING


@pytest.mark.asyncio
async def test_validate_needs_ids_and_limits_count(library):
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, [str(library["old"])], model_version_id=None)
    assert info.value.code == vr.CODE_REQUIRES_VERSION
    many = [f"{library['root'].as_posix()}/f{i}.safetensors" for i in range(vr.MAX_REPLACE_TARGETS + 1)]
    with pytest.raises(vr.ReplaceValidationError) as info:
        await _validate(library, many)
    assert info.value.code == vr.CODE_TOO_MANY


@pytest.mark.asyncio
async def test_validate_without_paths_is_a_no_op(library):
    assert await _validate(library, []) == []
    assert await _validate(library, ["", "  "]) == []


# ---------------------------------------------------------------------------
# Completion time
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replaces_only_after_verified_success(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    lifecycle = FakeLifecycle()

    outcome = await _run(queue, library, lifecycle)

    assert lifecycle.calls == [
        {
            "file_path": library["old"].as_posix(),
            "undo_ttl_seconds": vr.REPLACE_UNDO_TTL_SECONDS,
            "allow_hard_delete": False,
        }
    ]
    assert outcome[0]["status"] == vr.STATUS_REPLACED
    assert outcome[0]["batch_id"] == "batch-1"
    row = await _history_row(queue)
    assert row["replace_status"] == "done"
    assert json.loads(row["replace_targets"])[0]["status"] == "replaced"


@pytest.mark.asyncio
async def test_real_staging_moves_only_the_old_file_and_its_sidecars(library, queue):
    targets = await _validate(library, [str(library["old"])])
    new = _add_new_file(library)
    await _queue_completed(queue, targets)

    async def scanners() -> Dict[str, Any]:
        return {"lora": library["scanner"]}

    async def factory(scanner: Any) -> ModelLifecycleService:
        return ModelLifecycleService(scanner=scanner, metadata_manager=_Metadata(), metadata_loader=_empty_loader)

    before = time.time()
    outcome = await vr.run_replace_for_download(
        "dl-1", queue_service=queue, scanners_provider=scanners, lifecycle_factory=factory
    )

    assert outcome and outcome[0]["status"] == "replaced"
    root = library["root"]
    remaining = [f for f in _files(root) if PENDING_DELETE_DIR_NAME not in f]
    assert remaining == [
        "chars/eldreda_illustrious_v1.safetensors",
        "chars/eldreda_v2.safetensors",
    ]
    staged = [f for f in _files(root) if PENDING_DELETE_DIR_NAME in f]
    names = sorted(f.rsplit("/", 1)[-1] for f in staged)
    assert names == sorted(
        [MANIFEST_FILE_NAME, "eldreda_v1.safetensors", "eldreda_v1.metadata.json", "eldreda_v1.preview.png"]
    )
    manifest_path = next(root.rglob(MANIFEST_FILE_NAME))
    manifest = json.loads(manifest_path.read_text())
    assert manifest["expires_at"] >= int(before) + vr.REPLACE_UNDO_TTL_SECONDS - 1
    assert new.read_bytes() == b"new weights"
    # The cache no longer lists the old file; the new one stays.
    assert [e["file_path"] for e in library["scanner"].cache.raw_data] == [
        library["other"].as_posix(),
        new.as_posix(),
    ]


@pytest.mark.asyncio
async def test_real_staging_without_root_keeps_the_file(library, queue):
    """Staging impossible -> no hard delete fallback for a background replace."""
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)

    async def scanners() -> Dict[str, Any]:
        return {"lora": library["scanner"]}

    class NoRootScanner(FakeScanner):
        pass

    async def factory(scanner: Any) -> ModelLifecycleService:
        lifecycle = ModelLifecycleService(scanner=scanner, metadata_manager=_Metadata(), metadata_loader=_empty_loader)
        from py.services import pending_delete_service as pds

        service = await pds.get_pending_delete_service()
        service._find_model_root = lambda *_a, **_k: None  # type: ignore[method-assign]
        return lifecycle

    before = _files(library["root"])
    outcome = await vr.run_replace_for_download(
        "dl-1", queue_service=queue, scanners_provider=scanners, lifecycle_factory=factory
    )
    assert outcome and outcome[0]["status"] == "kept"
    assert outcome[0]["note"] == "staging_failed"
    assert _files(library["root"]) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["failed", "canceled"])
async def test_failed_or_canceled_download_keeps_old_file(library, queue, status):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets, status=status)
    lifecycle = FakeLifecycle()

    assert await _run(queue, library, lifecycle) is None
    assert lifecycle.calls == []
    assert library["old"].exists()
    assert (await _history_row(queue))["replace_status"] == "pending"


@pytest.mark.asyncio
async def test_queued_or_paused_download_is_never_claimed(library, queue):
    targets = await _validate(library, [str(library["old"])])
    await queue.add_to_queue(download_id="dl-1", model_id=MODEL_ID, model_version_id=NEW_VERSION, replace_targets=targets)
    await queue.update_status("dl-1", "paused")
    lifecycle = FakeLifecycle()
    assert await _run(queue, library, lifecycle) is None
    assert lifecycle.calls == []
    assert library["old"].exists()


@pytest.mark.asyncio
async def test_new_version_not_in_scanner_keeps_old_file(library, queue):
    targets = await _validate(library, [str(library["old"])])
    await _queue_completed(queue, targets)  # no new file registered
    lifecycle = FakeLifecycle()
    outcome = await _run(queue, library, lifecycle)
    assert outcome[0]["status"] == "kept" and outcome[0]["note"] == "new_file_not_verified"
    assert lifecycle.calls == []
    assert library["old"].exists()


@pytest.mark.asyncio
async def test_empty_new_file_keeps_old_file(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library, content=b"")
    await _queue_completed(queue, targets)
    lifecycle = FakeLifecycle()
    outcome = await _run(queue, library, lifecycle)
    assert outcome[0]["note"] == "new_file_not_verified"
    assert lifecycle.calls == []


@pytest.mark.asyncio
async def test_new_entry_pointing_at_the_old_path_is_not_proof(library, queue):
    targets = await _validate(library, [str(library["old"])])
    # The cache now claims the OLD path carries the new version (file replaced in place).
    library["scanner"].cache.raw_data[0]["civitai"]["id"] = NEW_VERSION
    await _queue_completed(queue, targets)
    lifecycle = FakeLifecycle()
    outcome = await _run(queue, library, lifecycle)
    assert outcome[0]["status"] == "kept"
    assert lifecycle.calls == []
    assert library["old"].exists()


@pytest.mark.asyncio
async def test_old_file_already_removed(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    library["old"].unlink()
    lifecycle = FakeLifecycle()
    outcome = await _run(queue, library, lifecycle)
    assert outcome[0]["status"] == vr.STATUS_ALREADY_GONE
    assert lifecycle.calls == []


@pytest.mark.asyncio
async def test_old_file_remapped_to_another_model_is_kept(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    library["scanner"].cache.raw_data[0]["civitai"]["modelId"] = 4242
    lifecycle = FakeLifecycle()
    outcome = await _run(queue, library, lifecycle)
    assert outcome[0]["note"] == "model_mismatch"
    assert lifecycle.calls == []


@pytest.mark.asyncio
async def test_old_file_relinked_to_other_version_is_kept(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    library["scanner"].cache.raw_data[0]["civitai"]["id"] = 1500
    lifecycle = FakeLifecycle()
    outcome = await _run(queue, library, lifecycle)
    assert outcome[0]["note"] == "version_changed"
    assert lifecycle.calls == []


@pytest.mark.asyncio
async def test_delete_service_raising_never_fails_the_replace_run(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    outcome = await _run(queue, library, FakeLifecycle("raise"))
    assert outcome[0]["status"] == "kept"
    assert outcome[0]["note"].startswith("delete_failed")
    assert library["old"].exists()
    row = await _history_row(queue)
    assert row["status"] == "completed"
    assert row["replace_status"] == "done"


@pytest.mark.asyncio
async def test_staging_failure_is_recorded(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    outcome = await _run(queue, library, FakeLifecycle("no_batch"))
    assert outcome[0]["note"] == "staging_failed"


@pytest.mark.asyncio
async def test_two_items_replacing_the_same_file(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets, download_id="dl-1")
    # A second row with the same target (bypassing the add-time check).
    await queue.add_to_queue(
        download_id="dl-2", model_id=MODEL_ID, model_version_id=NEW_VERSION, replace_targets=targets, deduplicate=False
    )
    await queue.complete_download("dl-2", status="completed")

    async def scanners() -> Dict[str, Any]:
        return {"lora": library["scanner"]}

    async def factory(scanner: Any) -> ModelLifecycleService:
        return ModelLifecycleService(scanner=scanner, metadata_manager=_Metadata(), metadata_loader=_empty_loader)

    first = await vr.run_replace_for_download("dl-1", queue_service=queue, scanners_provider=scanners, lifecycle_factory=factory)
    after_first = _files(library["root"])
    second = await vr.run_replace_for_download("dl-2", queue_service=queue, scanners_provider=scanners, lifecycle_factory=factory)

    assert first[0]["status"] == "replaced"
    assert second[0]["status"] == vr.STATUS_ALREADY_GONE
    assert _files(library["root"]) == after_first
    assert library["other"].exists()


@pytest.mark.asyncio
async def test_replace_runs_at_most_once(library, queue):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    lifecycle = FakeLifecycle()
    assert await _run(queue, library, lifecycle)
    assert await _run(queue, library, lifecycle) is None
    assert len(lifecycle.calls) == 1


@pytest.mark.asyncio
async def test_restart_marks_unfinished_replace_interrupted(library, queue, tmp_path):
    targets = await _validate(library, [str(library["old"])])
    _add_new_file(library)
    await _queue_completed(queue, targets)
    queue.close()

    # "Restart": a fresh service on the same database, then the startup sweep.
    restarted = DownloadQueueService(db_path=queue.get_database_path())
    assert await restarted.interrupt_stale_replaces() == 1
    lifecycle = FakeLifecycle()
    assert await _run(restarted, library, lifecycle) is None
    assert lifecycle.calls == []
    row = await _history_row(restarted)
    assert row["replace_status"] == "interrupted"
    assert json.loads(row["replace_targets"])[0]["status"] == "kept"
    assert library["old"].exists()
    # The sweep is idempotent.
    assert await restarted.interrupt_stale_replaces() == 0


@pytest.mark.asyncio
async def test_retry_from_history_keeps_pending_targets(library, queue):
    targets = await _validate(library, [str(library["old"])])
    await _queue_completed(queue, targets, status="failed")
    item = await queue.retry_from_history(download_id="dl-1")
    assert item is not None
    assert item["replace_status"] == "pending"
    assert json.loads(item["replace_targets"])[0]["path"] == library["old"].as_posix()


@pytest.mark.asyncio
async def test_retry_all_keeps_pending_targets(library, queue):
    targets = await _validate(library, [str(library["old"])])
    await _queue_completed(queue, targets, status="canceled")
    assert await queue.retry_all_failed() == 1
    [row] = await queue.get_queue()
    assert row["replace_status"] == "pending" and row["replace_targets"]


# ---------------------------------------------------------------------------
# Schema migration
# ---------------------------------------------------------------------------


def test_migration_from_old_schema(tmp_path: Path):
    db = tmp_path / "old.sqlite"
    conn = sqlite3.connect(db)
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
            version_name TEXT DEFAULT '', thumbnail_url TEXT DEFAULT '',
            status TEXT NOT NULL, error TEXT, file_path TEXT,
            bytes_downloaded INTEGER DEFAULT 0, total_bytes INTEGER,
            completed_at REAL NOT NULL, is_already_exists INTEGER DEFAULT 0
        );
        INSERT INTO download_queue (download_id, model_id, added_at) VALUES ('q-old', 1, 1.0);
        INSERT INTO download_history (download_id, model_id, status, completed_at) VALUES ('h-old', 1, 'completed', 1.0);
        """
    )
    conn.commit()
    conn.close()

    for _ in range(2):  # idempotent
        service = DownloadQueueService(db_path=str(db))
        service.close()

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    for table in ("download_queue", "download_history"):
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        assert {"destination", "replace_targets", "replace_status"} <= columns
    queue_row = conn.execute("SELECT * FROM download_queue").fetchone()
    history_row = conn.execute("SELECT * FROM download_history").fetchone()
    assert queue_row["replace_targets"] is None and queue_row["replace_status"] is None
    assert history_row["replace_targets"] is None and history_row["replace_status"] is None
    conn.close()


@pytest.mark.asyncio
async def test_old_rows_are_never_claimed(tmp_path: Path):
    service = DownloadQueueService(db_path=str(tmp_path / "q.sqlite"))
    await service.add_to_queue(download_id="plain", model_id=1, model_version_id=2)
    await service.complete_download("plain", status="completed")
    assert await service.claim_replace("plain") is None
    assert await service.interrupt_stale_replaces() == 0


# ---------------------------------------------------------------------------
# Worker hook
# ---------------------------------------------------------------------------


class _Settings:
    def get(self, key: str, default: Any = None) -> Any:
        return default


class _Manager:
    def get_running_download_ids(self):
        return set()

    async def get_active_downloads(self):
        return {"downloads": []}


def _worker(queue: DownloadQueueService, runner, replace_calls: List[str]) -> DownloadQueueWorker:
    async def queue_factory():
        return queue

    async def manager_factory():
        return _Manager()

    async def no_cooldown():
        return 0.0

    async def replace_runner(download_id: str, service: Any) -> None:
        assert service is queue
        replace_calls.append(download_id)

    return DownloadQueueWorker(
        download_runner=runner,
        queue_service_factory=queue_factory,
        download_manager_factory=manager_factory,
        cooldown_probe=no_cooldown,
        settings_getter=lambda: _Settings(),
        safety_poll_seconds=0.05,
        startup_delay_seconds=0,
        replace_runner=replace_runner,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result, expected",
    [
        ({"success": True}, ["dl-1"]),
        ({"success": True, "skipped": True, "status": "skipped"}, []),
        ({"success": True, "cancelled": True}, []),
        ({"success": False, "error": "boom"}, []),
    ],
)
async def test_worker_runs_replace_only_after_success(queue, result, expected):
    calls: List[str] = []

    async def runner(payload: Dict[str, Any]) -> Dict[str, Any]:
        return dict(result)

    worker = _worker(queue, runner, calls)
    await worker.run_download({"download_id": "dl-1", "model_id": MODEL_ID})
    assert calls == expected


@pytest.mark.asyncio
async def test_worker_replace_failure_never_changes_the_result(queue):
    async def runner(payload: Dict[str, Any]) -> Dict[str, Any]:
        return {"success": True}

    async def broken(download_id: str, service: Any) -> None:
        raise RuntimeError("nope")

    worker = _worker(queue, runner, [])
    worker._replace_runner = broken
    assert await worker.run_download({"download_id": "dl-1", "model_id": MODEL_ID}) == {"success": True}


@pytest.mark.asyncio
async def test_worker_recovery_sweeps_unfinished_replaces(library, queue):
    targets = await _validate(library, [str(library["old"])])
    await _queue_completed(queue, targets)
    worker = _worker(queue, None, [])
    await worker.recover_interrupted()
    assert (await _history_row(queue))["replace_status"] == "interrupted"
    assert library["old"].exists()


# ---------------------------------------------------------------------------
# queue/add and the queue / history payloads
# ---------------------------------------------------------------------------


@pytest.fixture
def handler(monkeypatch: pytest.MonkeyPatch, queue: DownloadQueueService, library):
    import logging

    from py.routes.handlers import model_handlers

    async def fake_get_instance(_cls: object = None) -> DownloadQueueService:
        return queue

    monkeypatch.setattr(DownloadQueueService, "get_instance", fake_get_instance)
    monkeypatch.setattr(model_handlers, "wake_download_queue_worker", lambda: None)
    instance = model_handlers.ModelDownloadHandler(
        ws_manager=None,  # type: ignore[arg-type]
        logger=logging.getLogger("test-version-replace"),
        download_use_case=None,  # type: ignore[arg-type]
        download_coordinator=None,  # type: ignore[arg-type]
    )

    async def scanners() -> Dict[str, Any]:
        return {"lora": library["scanner"]}

    instance._replace_scanners = scanners  # type: ignore[method-assign]
    return instance


def _add_request(params: List[tuple]) -> Any:
    return make_mocked_request("GET", f"/api/lm/downloads/queue/add?{urlencode(params)}")


@pytest.mark.asyncio
async def test_queue_add_stores_validated_targets(handler, queue, library):
    response = await handler.add_to_download_queue(
        _add_request(
            [
                ("model_id", MODEL_ID),
                ("model_version_id", NEW_VERSION),
                ("download_id", "dl-r"),
                ("replace_file_path", str(library["old"])),
            ]
        )
    )
    body = json.loads(response.text)
    assert response.status == 200 and body["queued"] is True
    assert body["replace_attached"] is True
    [row] = await queue.get_queue()
    assert row["replace_status"] == "pending"
    assert json.loads(row["replace_targets"])[0]["path"] == library["old"].as_posix()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "params, code",
    [
        ([("model_id", 555), ("model_version_id", NEW_VERSION)], vr.CODE_MODEL_MISMATCH),
        ([("model_id", MODEL_ID), ("model_version_id", OLD_VERSION)], vr.CODE_SAME_VERSION),
        ([("model_id", MODEL_ID)], vr.CODE_REQUIRES_VERSION),
    ],
)
async def test_queue_add_rejects_bad_replace_and_queues_nothing(handler, queue, library, params, code):
    response = await handler.add_to_download_queue(
        _add_request([*params, ("replace_file_path", str(library["old"]))])
    )
    assert response.status == 400
    assert json.loads(response.text)["code"] == code
    assert await queue.get_queue() == []
    assert library["old"].exists()


@pytest.mark.asyncio
async def test_queue_add_rejects_outside_path(handler, queue, library):
    outside = _write(library["tmp"] / "outside.safetensors")
    response = await handler.add_to_download_queue(
        _add_request(
            [("model_id", MODEL_ID), ("model_version_id", NEW_VERSION), ("replace_file_path", str(outside))]
        )
    )
    assert response.status == 400
    assert json.loads(response.text)["code"] == vr.CODE_OUTSIDE_ROOTS
    assert await queue.get_queue() == []


@pytest.mark.asyncio
async def test_queue_add_without_replace_is_unchanged(handler, queue):
    response = await handler.add_to_download_queue(
        _add_request([("model_id", MODEL_ID), ("model_version_id", NEW_VERSION)])
    )
    body = json.loads(response.text)
    assert body["queued"] is True and body["replace_attached"] is False
    [row] = await queue.get_queue()
    assert row["replace_targets"] is None and row["replace_status"] is None


@pytest.mark.asyncio
async def test_queue_and_history_payloads_carry_replace_fields(handler, queue, library):
    targets = await _validate(library, [str(library["old"])])
    await queue.add_to_queue(download_id="q", model_id=MODEL_ID, model_version_id=NEW_VERSION, replace_targets=targets)
    handler._queue_worker_payload = _no_worker  # type: ignore[method-assign]
    queue_body = json.loads((await handler.get_download_queue(make_mocked_request("GET", "/q"))).text)
    assert json.loads(queue_body["queue"][0]["replace_targets"])[0]["file_name"] == "eldreda_v1.safetensors"
    assert queue_body["queue"][0]["replace_status"] == "pending"

    await queue.complete_download("q", status="completed")
    history = json.loads((await handler.get_download_history(make_mocked_request("GET", "/h"))).text)
    assert history["items"][0]["replace_status"] == "pending"
    assert history["items"][0]["replace_targets"]


async def _no_worker() -> Dict[str, Any]:
    return {"queue_worker": True}
