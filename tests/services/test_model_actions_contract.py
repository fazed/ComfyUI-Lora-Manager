"""Contract tests for the model actions the modern UI (`ui/`) relies on.

The modern UI ports delete (with undo), rename and move (single + bulk) from
the classic UI. These tests pin the on-disk behaviour it documents in
`ui/README.md`, with real files in temp directories:

* which companion files travel with a model on rename / move / delete;
* that `.civitai.info` (a third-party file LoRA Manager never writes) is left
  alone by rename and delete but travels with a move (it shares the base name);
* delete -> undo restores every staged file byte-identically;
* rename -> rename back and move -> move back are lossless round trips;
* bulk move reports per-file results and auto-renames on a name conflict.
"""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Dict
from unittest.mock import MagicMock

import pytest

from py import config as config_module
from py.services.lora_scanner import LoraScanner
from py.services.model_cache import ModelCache
from py.services.model_file_service import ModelMoveService
from py.services.model_hash_index import ModelHashIndex
from py.services.model_lifecycle_service import ModelLifecycleService
from py.services.pending_delete_service import (
    PENDING_DELETE_DIR_NAME,
    PENDING_DELETE_TTL_SECONDS,
    _reset_pending_delete_service,
    get_pending_delete_service,
)
from py.utils.metadata_manager import MetadataManager
from py.utils.models import LoraMetadata


def _posix(path: Any) -> str:
    return str(path).replace(os.sep, "/")


def _snapshot(directory: Path) -> Dict[str, bytes]:
    """Every regular file directly inside ``directory`` -> its bytes."""
    return {entry.name: entry.read_bytes() for entry in directory.iterdir() if entry.is_file()}


def _write_model(directory: Path, stem: str, *, sha: str = "abc123") -> Path:
    """A model with the full companion set the UI documents."""
    model = directory / f"{stem}.safetensors"
    model.write_bytes(b"weights-" + stem.encode())
    (directory / f"{stem}.preview.png").write_bytes(b"png-" + stem.encode())
    (directory / f"{stem}.civitai.info").write_text(json.dumps({"third_party": True}))
    (directory / f"{stem}.metadata.json").write_text(
        json.dumps(
            {
                "file_name": stem,
                "model_name": stem,
                "file_path": _posix(model),
                "preview_url": _posix(directory / f"{stem}.preview.png"),
                "sha256": sha,
                "hash_status": "completed",
                "tags": ["style"],
            }
        )
    )
    return model


@pytest.fixture(autouse=True)
def _isolated_pending_delete(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Fresh pending-delete singleton; no real scanners during purge sweeps."""
    from py.services.service_registry import ServiceRegistry

    async def _none(*_args: Any, **_kwargs: Any) -> None:
        return None

    for getter in ("get_lora_scanner", "get_checkpoint_scanner", "get_embedding_scanner"):
        monkeypatch.setattr(ServiceRegistry, getter, _none)
    _reset_pending_delete_service()
    yield
    _reset_pending_delete_service()


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "loras"
    root.mkdir()
    monkeypatch.setattr(config_module.config, "loras_roots", [str(root)])
    monkeypatch.setattr(config_module.config, "extra_loras_roots", [], raising=False)
    return root


def _make_scanner(root: Path, entries: list[dict]) -> LoraScanner:
    """A LoraScanner wired for file operations without async init."""
    scanner = object.__new__(LoraScanner)
    scanner.model_type = "lora"
    scanner.model_class = LoraMetadata
    scanner.file_extensions = {".safetensors"}
    scanner._cache = ModelCache(raw_data=entries, folders=[""])
    scanner._cache_version = 0
    scanner._hash_index = ModelHashIndex()
    scanner._tags_count = {}
    scanner._excluded_models = []
    scanner._is_initializing = False
    scanner._persistent_cache = MagicMock()
    scanner._name_display_mode = "model_name"
    scanner._cancel_requested = False
    scanner._move_locks = {}
    scanner._all_folders_backfill_running = False
    scanner.get_model_roots = lambda: [_posix(root)]
    return scanner


def _entry(model: Path) -> dict:
    stem = model.stem
    return {
        "file_path": _posix(model),
        "file_name": stem,
        "model_name": stem,
        "folder": "",
        "sha256": "abc123",
        "tags": ["style"],
    }


async def _json_loader(path: str) -> Dict[str, object]:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


class _RecordingCacheScanner:
    """Minimal scanner for rename: records cache updates."""

    model_type = "checkpoint"  # skips the recipe re-pointing branch

    def __init__(self, root: Path) -> None:
        self._root = root
        self.calls: list[tuple[str, str]] = []

    def get_model_roots(self) -> list[str]:
        return [_posix(self._root)]

    async def update_single_model_cache(self, old_path, new_path, metadata):
        self.calls.append((old_path, new_path))


class _SaveMetadata:
    async def save_metadata(self, path: str, metadata):
        await MetadataManager.save_metadata(path, metadata)


# ---------------------------------------------------------------------------
# Rename
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_rename_moves_model_metadata_and_preview_but_not_civitai_info(library: Path):
    model = _write_model(library, "tiny")
    before = _snapshot(library)
    scanner = _RecordingCacheScanner(library)
    service = ModelLifecycleService(
        scanner=scanner, metadata_manager=_SaveMetadata(), metadata_loader=_json_loader
    )

    result = await service.rename_model(file_path=_posix(model), new_file_name="tiny__lmui-test")

    assert result["success"] is True
    assert result["new_file_path"] == _posix(library / "tiny__lmui-test.safetensors")
    names = set(_snapshot(library))
    assert {"tiny__lmui-test.safetensors", "tiny__lmui-test.preview.png", "tiny__lmui-test.metadata.json"} <= names
    # .civitai.info is not a LoRA Manager sidecar: rename leaves it untouched.
    assert "tiny.civitai.info" in names
    assert "tiny__lmui-test.civitai.info" not in names
    assert (library / "tiny__lmui-test.safetensors").read_bytes() == before["tiny.safetensors"]
    saved = json.loads((library / "tiny__lmui-test.metadata.json").read_text())
    assert saved["file_path"] == _posix(library / "tiny__lmui-test.safetensors")
    assert saved["file_name"] == "tiny__lmui-test"
    assert scanner.calls == [(_posix(model), _posix(library / "tiny__lmui-test.safetensors"))]


@pytest.mark.asyncio
async def test_rename_round_trip_restores_names_and_bytes(library: Path):
    model = _write_model(library, "tiny")
    before = _snapshot(library)
    service = ModelLifecycleService(
        scanner=_RecordingCacheScanner(library), metadata_manager=_SaveMetadata(), metadata_loader=_json_loader
    )

    first = await service.rename_model(file_path=_posix(model), new_file_name="tiny__tmp")
    await service.rename_model(file_path=str(first["new_file_path"]), new_file_name="tiny")

    after = _snapshot(library)
    assert set(after) == set(before)
    for name in ("tiny.safetensors", "tiny.preview.png", "tiny.civitai.info"):
        assert after[name] == before[name]
    # The metadata JSON is rewritten (paths, original_file_name) but points home again.
    saved = json.loads(after["tiny.metadata.json"])
    assert saved["file_path"] == _posix(model)
    assert saved["original_file_name"] == "tiny"


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["a/b", "a\\b", "a:b", "a*b", "a?b", 'a"b', "a<b", "a>b", "a|b"])
async def test_rename_rejects_each_illegal_character(library: Path, bad: str):
    model = _write_model(library, "tiny")
    service = ModelLifecycleService(
        scanner=_RecordingCacheScanner(library), metadata_manager=_SaveMetadata(), metadata_loader=_json_loader
    )
    with pytest.raises(ValueError, match="Invalid characters"):
        await service.rename_model(file_path=_posix(model), new_file_name=bad)
    assert model.exists()


@pytest.mark.asyncio
async def test_rename_conflict_leaves_both_models_untouched(library: Path):
    model = _write_model(library, "tiny")
    other = _write_model(library, "other")
    before = _snapshot(library)
    service = ModelLifecycleService(
        scanner=_RecordingCacheScanner(library), metadata_manager=_SaveMetadata(), metadata_loader=_json_loader
    )
    with pytest.raises(ValueError, match="already exists"):
        await service.rename_model(file_path=_posix(model), new_file_name=other.stem)
    assert _snapshot(library) == before


# ---------------------------------------------------------------------------
# Delete + undo
# ---------------------------------------------------------------------------


class _DeleteScanner:
    model_type = "lora"

    def __init__(self, root: Path, raw: list[dict]) -> None:
        self._root = root
        self.cache = ModelCache(raw_data=raw, folders=[""])
        self._hash_index = ModelHashIndex()

    def get_model_roots(self) -> list[str]:
        return [_posix(self._root)]

    async def get_cached_data(self):
        return self.cache

    def bump_cache_version(self) -> None:
        pass


class _NoMetadata:
    async def load_metadata_payload(self, file_path: str):
        return {}


@pytest.mark.asyncio
async def test_delete_stages_sidecars_keeps_civitai_info_and_undo_restores_bytes(library: Path):
    model = _write_model(library, "tiny")
    before = _snapshot(library)
    scanner = _DeleteScanner(library, [_entry(model)])
    service = ModelLifecycleService(
        scanner=scanner, metadata_manager=_NoMetadata(), metadata_loader=_json_loader
    )

    result = await service.delete_model(_posix(model))

    batch_id = result["batch_id"]
    assert result["success"] is True and isinstance(batch_id, str)
    remaining = set(_snapshot(library))
    # Only the third-party .civitai.info stays next to the (gone) model.
    assert remaining == {"tiny.civitai.info"}
    staged = library / PENDING_DELETE_DIR_NAME / batch_id
    assert {"tiny.safetensors", "tiny.preview.png", "tiny.metadata.json"} <= set(_snapshot(staged))
    manifest = json.loads((staged / "manifest.json").read_text())
    assert manifest["model_type"] == "loras"
    # The undo window the UI shows: expires_at = staging time + TTL.
    remaining_window = manifest["expires_at"] - time.time()
    assert 0 < remaining_window <= PENDING_DELETE_TTL_SECONDS + 1
    assert scanner.cache.raw_data == []

    service_pd = await get_pending_delete_service()
    undo = await service_pd.undo(batch_id)

    assert undo["kind"] == "model"
    assert _snapshot(library) == before
    # The staging container is cleaned up after a full restore.
    assert not (library / PENDING_DELETE_DIR_NAME).exists()


@pytest.mark.asyncio
async def test_undo_after_window_is_refused_and_files_stay_staged(library: Path, monkeypatch: pytest.MonkeyPatch):
    model = _write_model(library, "tiny")
    scanner = _DeleteScanner(library, [_entry(model)])
    service = ModelLifecycleService(
        scanner=scanner, metadata_manager=_NoMetadata(), metadata_loader=_json_loader
    )
    result = await service.delete_model(_posix(model))
    batch_id = str(result["batch_id"])

    import py.services.pending_delete_service as pds

    real_time = pds.time.time
    monkeypatch.setattr(pds.time, "time", lambda: real_time() + PENDING_DELETE_TTL_SECONDS + 5)
    # Keep the opportunistic purge from deleting the batch before undo looks at it.
    service_pd = await get_pending_delete_service()

    async def _no_purge() -> None:
        return None

    monkeypatch.setattr(service_pd, "_opportunistic_purge", _no_purge)
    with pytest.raises(ValueError, match="expired"):
        await service_pd.undo(batch_id)
    assert not model.exists()


@pytest.mark.asyncio
async def test_undo_refuses_when_original_path_was_reoccupied(library: Path):
    model = _write_model(library, "tiny")
    scanner = _DeleteScanner(library, [_entry(model)])
    service = ModelLifecycleService(
        scanner=scanner, metadata_manager=_NoMetadata(), metadata_loader=_json_loader
    )
    result = await service.delete_model(_posix(model))
    model.write_bytes(b"a new file took the name")

    service_pd = await get_pending_delete_service()
    with pytest.raises(ValueError, match="occupied"):
        await service_pd.undo(str(result["batch_id"]))
    assert model.read_bytes() == b"a new file took the name"


# ---------------------------------------------------------------------------
# Move (single + bulk)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_move_round_trip_carries_every_same_stem_file(library: Path):
    model = _write_model(library, "tiny")
    before = _snapshot(library)
    scanner = _make_scanner(library, [_entry(model)])
    mover = ModelMoveService(scanner, "lora")
    target = library / "_lm-ui-test"

    out = await mover.move_model(_posix(model), _posix(target))

    assert out["success"] is True
    assert out["new_file_path"] == _posix(target / "tiny.safetensors")
    # The target folder is created; every file sharing the stem travels,
    # including the third-party .civitai.info.
    assert set(_snapshot(target)) == set(before)
    assert _snapshot(library) == {}

    back = await mover.move_model(str(out["new_file_path"]), _posix(library))
    assert back["success"] is True
    after = _snapshot(library)
    assert set(after) == set(before)
    for name in ("tiny.safetensors", "tiny.preview.png", "tiny.civitai.info"):
        assert after[name] == before[name]
    assert json.loads(after["tiny.metadata.json"])["file_path"] == _posix(model)
    assert target.is_dir() and not any(target.iterdir())
    cache = await scanner.get_cached_data()
    assert [item["file_path"] for item in cache.raw_data] == [_posix(model)]


@pytest.mark.asyncio
async def test_move_to_same_folder_is_a_successful_no_op(library: Path):
    model = _write_model(library, "tiny")
    before = _snapshot(library)
    mover = ModelMoveService(_make_scanner(library, [_entry(model)]), "lora")

    out = await mover.move_model(_posix(model), _posix(library))

    assert out["success"] is True
    assert out["new_file_path"] == _posix(model)
    assert _snapshot(library) == before


@pytest.mark.asyncio
async def test_move_outside_library_roots_fails_without_touching_files(library: Path, tmp_path: Path):
    model = _write_model(library, "tiny")
    before = _snapshot(library)
    mover = ModelMoveService(_make_scanner(library, [_entry(model)]), "lora")

    out = await mover.move_model(_posix(model), _posix(tmp_path / "elsewhere"))

    assert out["success"] is False
    assert "outside configured library" in str(out["error"])
    assert _snapshot(library) == before
    assert not (tmp_path / "elsewhere").exists()


@pytest.mark.asyncio
async def test_bulk_move_reports_per_file_results_and_renames_on_conflict(library: Path):
    first = _write_model(library, "alpha", sha="a" * 64)
    second = _write_model(library, "beta", sha="b" * 64)
    target = library / "dest"
    target.mkdir()
    # A different file already called beta.safetensors sits in the target.
    (target / "beta.safetensors").write_bytes(b"someone else")
    scanner = _make_scanner(library, [_entry(first), _entry(second)])
    scanner._hash_index.add_entry("a" * 64, _posix(first))
    scanner._hash_index.add_entry("b" * 64, _posix(second))
    mover = ModelMoveService(scanner, "lora")
    missing = _posix(library / "ghost.safetensors")

    out = await mover.move_models_bulk([_posix(first), _posix(second), missing], _posix(target))

    assert out["success"] is True
    assert out["success_count"] == 2
    assert out["failure_count"] == 1
    by_source = {entry["original_file_path"]: entry for entry in out["results"]}
    assert by_source[_posix(first)]["new_file_path"] == _posix(target / "alpha.safetensors")
    renamed = by_source[_posix(second)]["new_file_path"]
    assert renamed != _posix(target / "beta.safetensors")
    assert renamed.startswith(_posix(target / "beta"))
    assert (target / "beta.safetensors").read_bytes() == b"someone else"
    assert by_source[missing]["success"] is False
