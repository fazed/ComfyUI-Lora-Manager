"""Phase B1 (finding #16): a planted pending-delete manifest cannot make undo
write outside the library or pull an arbitrary file in.

The manifest is a file on disk. Undo now requires every pending entry's
``original`` to be inside a library root (fail closed) and its ``staged`` to
be inside a ``.lm-pending-delete`` folder, as plain string checks before any
file is moved. ``batch_id`` stays regex-checked by the route.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

import pytest

from py.services.pending_delete_service import (
    MANIFEST_FILE_NAME,
    PENDING_DELETE_DIR_NAME,
    PendingDeleteService,
    _reset_pending_delete_service,
)


class _Scanner:
    def __init__(self, roots: Sequence[Path]) -> None:
        self._roots = [os.path.abspath(str(r)) for r in roots]
        self.model_type = "lora"

    def get_model_roots(self) -> List[str]:
        return list(self._roots)


@pytest.fixture(autouse=True)
def _reset() -> Iterator[None]:
    _reset_pending_delete_service()
    yield
    _reset_pending_delete_service()


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    from py.services.service_registry import ServiceRegistry

    library = tmp_path / "loras"
    library.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()

    async def _lora(*_a: Any, **_k: Any) -> Optional[_Scanner]:
        return _Scanner([library])

    async def _none(*_a: Any, **_k: Any) -> None:
        return None

    monkeypatch.setattr(ServiceRegistry, "get_lora_scanner", _lora)
    monkeypatch.setattr(ServiceRegistry, "get_checkpoint_scanner", _none)
    monkeypatch.setattr(ServiceRegistry, "get_embedding_scanner", _none)
    monkeypatch.setattr(ServiceRegistry, "get_other_scanner", _none, raising=False)
    monkeypatch.setattr(
        "py.utils.library_roots.configured_download_roots", lambda *_a, **_k: []
    )
    monkeypatch.setattr("py.utils.recipes_paths.get_effective_recipes_dir", lambda: "")
    monkeypatch.setattr(
        "py.utils.sidecar_paths.get_configured_sidecar_root",
        lambda: str(tmp_path / "sidecars"),
    )
    return tmp_path, library, outside


def _plant_batch(library: Path, entries: List[Dict[str, Any]]) -> tuple[str, Path]:
    batch_id = uuid.uuid4().hex
    batch_dir = library / PENDING_DELETE_DIR_NAME / batch_id
    batch_dir.mkdir(parents=True)
    manifest = {
        "batch_id": batch_id,
        "kind": "model",
        "model_type": "lora",
        "state": "staged",
        "expires_at": int(time.time()) + 600,
        "entries": entries,
        "model_snapshot": None,
        "recipe_snapshot": None,
    }
    (batch_dir / MANIFEST_FILE_NAME).write_text(json.dumps(manifest), encoding="utf-8")
    return batch_id, batch_dir


def _tree(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "original_template",
    [
        "{outside}/evil.safetensors",
        "{library}/../outside/evil.safetensors",
        "{root}/loras_old/evil.safetensors",
        "\\\\attacker\\share\\evil.safetensors",
        "C:\\Windows\\System32\\evil.dll",
    ],
)
async def test_undo_refuses_a_manifest_original_outside_the_library(
    sandbox, original_template
):
    root, library, outside = sandbox
    batch_id, batch_dir = _plant_batch(library, [])
    staged = batch_dir / "evil.safetensors"
    staged.write_bytes(b"payload")
    original = original_template.format(outside=outside, library=library, root=root)
    manifest_path = batch_dir / MANIFEST_FILE_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entries"] = [{"staged": str(staged), "original": original, "restored": False}]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    before = _tree(root)

    service = await PendingDeleteService.get_instance()
    with pytest.raises(ValueError):
        await service.undo(batch_id)

    assert _tree(root) == before
    assert staged.read_bytes() == b"payload"
    assert list(outside.iterdir()) == []


@pytest.mark.asyncio
async def test_undo_refuses_a_staged_source_outside_the_staging_folder(sandbox):
    root, library, outside = sandbox
    secret = outside / "secret.txt"
    secret.write_bytes(b"secret")
    batch_id, _batch_dir = _plant_batch(
        library,
        [
            {
                "staged": str(secret),
                "original": str(library / "stolen.txt"),
                "restored": False,
            }
        ],
    )

    service = await PendingDeleteService.get_instance()
    with pytest.raises(ValueError):
        await service.undo(batch_id)

    assert secret.read_bytes() == b"secret"
    assert not (library / "stolen.txt").exists()


@pytest.mark.asyncio
async def test_undo_refuses_everything_when_one_entry_is_hostile(sandbox):
    root, library, outside = sandbox
    batch_id, batch_dir = _plant_batch(library, [])
    good = batch_dir / "good.safetensors"
    good.write_bytes(b"good")
    evil = batch_dir / "evil.safetensors"
    evil.write_bytes(b"evil")
    manifest_path = batch_dir / MANIFEST_FILE_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entries"] = [
        {"staged": str(good), "original": str(library / "good.safetensors"), "restored": False},
        {"staged": str(evil), "original": str(outside / "evil.safetensors"), "restored": False},
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    service = await PendingDeleteService.get_instance()
    with pytest.raises(ValueError):
        await service.undo(batch_id)

    assert not (library / "good.safetensors").exists()
    assert good.exists() and evil.exists()


@pytest.mark.asyncio
async def test_undo_still_restores_a_legitimate_batch(sandbox):
    _root, library, _outside = sandbox
    sub = library / "sub"
    sub.mkdir()
    batch_id, batch_dir = _plant_batch(sub, [])
    staged = batch_dir / "model.safetensors"
    staged.write_bytes(b"model")
    manifest_path = batch_dir / MANIFEST_FILE_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entries"] = [
        {"staged": str(staged), "original": str(sub / "model.safetensors"), "restored": False}
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    service = await PendingDeleteService.get_instance()
    await service.undo(batch_id)

    assert (sub / "model.safetensors").read_bytes() == b"model"


@pytest.mark.asyncio
async def test_undo_restores_centralized_sidecars_under_the_sidecar_root(sandbox):
    root, library, _outside = sandbox
    sidecar_dir = root / "sidecars" / "mirror"
    sidecar_dir.mkdir(parents=True)
    batch_id, batch_dir = _plant_batch(library, [])
    staged = batch_dir / "model.metadata.json"
    staged.write_text("{}", encoding="utf-8")
    manifest_path = batch_dir / MANIFEST_FILE_NAME
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["entries"] = [
        {"staged": str(staged), "original": str(sidecar_dir / "model.metadata.json"), "restored": False}
    ]
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

    service = await PendingDeleteService.get_instance()
    await service.undo(batch_id)

    assert (sidecar_dir / "model.metadata.json").exists()


def test_undo_route_keeps_the_batch_id_regex():
    from py.routes.handlers.pending_delete_handler import _BATCH_ID_RE

    assert _BATCH_ID_RE.fullmatch(uuid.uuid4().hex)
    for hostile in ("../x", "..\\x", "a/b", "", "C:\\x"):
        assert not _BATCH_ID_RE.fullmatch(hostile)
