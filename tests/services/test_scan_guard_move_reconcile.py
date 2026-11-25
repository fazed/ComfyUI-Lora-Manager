"""Fork: upstream's move-aware reconcile (issue #1224) runs inside the scan guard.

Upstream's ``_reconcile_cache`` relinks centralized sidecars of externally
moved models. The fork routes every forced cache build through the per-scanner
scan guard (``scan_library``). These tests run a real reconcile against a real
centralized-sidecar library and check that the move is reconciled through the
guarded entry points, that the guard is held while it happens, and that
overlapping identical scans still coalesce into one reconcile (so the sidecar is
moved exactly once).
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
from pathlib import Path

import pytest

from py.config import config
from py.services.lora_scanner import LoraScanner
from py.services.model_cache import ModelCache
from py.services.model_scanner import ModelScanner
from py.services.persistent_model_cache import PersistentModelCache
from py.services.settings_manager import get_settings_manager
from py.utils.sidecar_paths import get_metadata_path, reset_root_map_cache


def _normalize(path: Path | str) -> str:
    return str(path).replace(os.sep, "/")


@pytest.fixture(autouse=True)
def _reset_scanner_state():
    ModelScanner._instances.clear()
    ModelScanner._locks.clear()
    reset_root_map_cache()
    yield
    ModelScanner._instances.clear()
    ModelScanner._locks.clear()
    reset_root_map_cache()


def _configure_root(root: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    for attr in (
        "base_models_roots",
        "checkpoints_roots",
        "embeddings_roots",
        "other_roots",
        "workflows_roots",
        "wildcards_roots",
        "extra_loras_roots",
        "extra_checkpoints_roots",
        "extra_unet_roots",
        "extra_embeddings_roots",
    ):
        monkeypatch.setattr(config, attr, [], raising=False)
    monkeypatch.setattr(config, "loras_roots", [_normalize(root)], raising=False)


async def _prepare_moved_model(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    root = tmp_path / "library" / "loras"
    root.mkdir(parents=True)
    _configure_root(root, monkeypatch)
    settings = get_settings_manager()
    settings.set("sidecar_storage_mode", "centralized")
    settings.set("sidecar_storage_path", str(tmp_path / "sidecars"))
    reset_root_map_cache()

    model = root / "model.safetensors"
    model.write_bytes(b"weights")
    scanner = LoraScanner()
    await scanner._process_model_file(_normalize(model), _normalize(root))

    sidecar = Path(get_metadata_path(_normalize(model)))
    payload = json.loads(sidecar.read_text(encoding="utf-8"))
    payload.update({"notes": "keep me", "custom_field": "preserve"})
    sidecar.write_text(json.dumps(payload), encoding="utf-8")

    entry = scanner._build_cache_entry(payload, folder="")
    scanner._cache = ModelCache(raw_data=[entry], folders=[""], all_folders=[])
    scanner._persistent_cache = PersistentModelCache(
        library_name="test",
        db_path=str(tmp_path / "models.sqlite"),
    )
    scanner._hash_index.add_entry(entry["sha256"], entry["file_path"])

    target = root / "organized" / "renamed.safetensors"
    target.parent.mkdir()
    shutil.move(str(model), str(target))
    return scanner, sidecar, target


def _assert_reconciled(scanner: ModelScanner, old_sidecar: Path, target: Path) -> None:
    new_sidecar = Path(get_metadata_path(_normalize(target)))
    payload = json.loads(new_sidecar.read_text(encoding="utf-8"))
    assert payload["file_path"] == _normalize(target)
    assert payload["notes"] == "keep me"
    assert payload["custom_field"] == "preserve"
    assert not old_sidecar.exists()
    assert len(scanner._cache.raw_data) == 1
    assert scanner._cache.raw_data[0]["file_path"] == _normalize(target)
    assert scanner._cache.raw_data[0]["notes"] == "keep me"


def _record_guard_state(scanner: ModelScanner, monkeypatch: pytest.MonkeyPatch):
    """Wrap the real reconcile and record whether the scan lock was held."""
    held: list[bool] = []
    real_reconcile = scanner._reconcile_cache

    async def recording(*args, **kwargs):
        lock = getattr(scanner, "_scan_lock", None)
        held.append(bool(lock is not None and lock.locked()))
        return await real_reconcile(*args, **kwargs)

    monkeypatch.setattr(scanner, "_reconcile_cache", recording)
    return held


@pytest.mark.asyncio
async def test_guarded_quick_scan_reconciles_an_external_move(tmp_path, monkeypatch):
    scanner, old_sidecar, target = await _prepare_moved_model(tmp_path, monkeypatch)
    held = _record_guard_state(scanner, monkeypatch)

    summary, joined = await scanner.scan_library()

    assert joined is False
    assert held == [True]
    assert summary["added"] == 1
    assert summary["removed"] == 1
    _assert_reconciled(scanner, old_sidecar, target)
    assert not scanner.is_scanning()


@pytest.mark.asyncio
async def test_force_refresh_reconciles_an_external_move_through_the_guard(
    tmp_path, monkeypatch
):
    scanner, old_sidecar, target = await _prepare_moved_model(tmp_path, monkeypatch)
    held = _record_guard_state(scanner, monkeypatch)

    await scanner.get_cached_data(force_refresh=True)

    assert held == [True]
    assert scanner.last_reconcile_summary["added"] == 1
    _assert_reconciled(scanner, old_sidecar, target)


@pytest.mark.asyncio
async def test_overlapping_scans_relocate_the_moved_sidecar_once(tmp_path, monkeypatch):
    scanner, old_sidecar, target = await _prepare_moved_model(tmp_path, monkeypatch)
    held = _record_guard_state(scanner, monkeypatch)

    first = asyncio.create_task(scanner.scan_library())
    await asyncio.sleep(0)
    second = asyncio.create_task(scanner.scan_library())
    (summary_a, joined_a), (summary_b, joined_b) = await asyncio.gather(first, second)

    assert held == [True]
    assert (joined_a, joined_b) == (False, True)
    assert summary_a == summary_b
    _assert_reconciled(scanner, old_sidecar, target)
