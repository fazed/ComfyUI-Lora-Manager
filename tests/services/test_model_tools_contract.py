"""Contract tests for the model tools the modern UI (`ui/`) ports in phase B1.

They pin, with real files in temp directories, the backend behaviour that
`ui/README.md` documents and the UI's confirm texts rely on:

* replace preview deletes every previous preview of the model (any
  extension), re-encodes images to ``.webp``, keeps GIFs, and always writes
  ``preview_nsfw_level`` into the sidecar;
* ``save-metadata`` (used for NSFW level, favorite and base model, one request
  per model) merges only the sent keys and leaves the model file alone;
* ``verify-duplicates`` re-hashes files and writes a corrected ``sha256``;
* folder create / rename / delete: delete refuses folders that hold a model and
  removes leftover non-model files of an otherwise empty folder;
* move with ``use_default_paths`` joins the download path template below the
  chosen root.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock

import pytest

from py import config as config_module
from py.services.lora_scanner import LoraScanner
from py.services.metadata_sync_service import MetadataSyncService
from py.services.model_cache import ModelCache
from py.services.model_file_service import ModelMoveService
from py.services.model_hash_index import ModelHashIndex
from py.services.preview_asset_service import PreviewAssetService
from py.utils.metadata_manager import MetadataManager
from py.utils.models import LoraMetadata


def _posix(path: Any) -> str:
    return str(path).replace(os.sep, "/")


def _snapshot(directory: Path) -> Dict[str, bytes]:
    return {entry.name: entry.read_bytes() for entry in directory.iterdir() if entry.is_file()}


def _write_model(directory: Path, stem: str, *, preview_ext: str = ".jpeg", extra: Dict[str, Any] | None = None) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    model = directory / f"{stem}.safetensors"
    model.write_bytes(b"weights-" + stem.encode())
    preview = directory / f"{stem}{preview_ext}"
    preview.write_bytes(b"old-preview-" + stem.encode())
    payload = {
        "file_name": stem,
        "model_name": stem,
        "file_path": _posix(model),
        "preview_url": _posix(preview),
        "preview_nsfw_level": 1,
        "sha256": "abc123",
        "base_model": "SDXL 1.0",
        "favorite": False,
        "notes": "keep me",
        "tags": ["style"],
    }
    payload.update(extra or {})
    (directory / f"{stem}.metadata.json").write_text(json.dumps(payload))
    return model


async def _json_loader(path: str) -> Dict[str, Any]:
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


class _SaveMetadata:
    async def save_metadata(self, path: str, metadata):
        await MetadataManager.save_metadata(path, metadata)


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "loras"
    root.mkdir()
    monkeypatch.setattr(config_module.config, "loras_roots", [str(root)])
    monkeypatch.setattr(config_module.config, "extra_loras_roots", [], raising=False)
    return root


# ---------------------------------------------------------------------------
# Replace preview
# ---------------------------------------------------------------------------


class _FakeExif:
    def __init__(self) -> None:
        self.calls: List[Dict[str, Any]] = []

    def optimize_image(self, **kwargs):
        self.calls.append(kwargs)
        return b"webp-bytes", {}


def _preview_service(exif: _FakeExif) -> PreviewAssetService:
    async def _no_downloader():  # pragma: no cover - not used by replace_preview
        raise AssertionError("replace_preview must not download")

    return PreviewAssetService(metadata_manager=_SaveMetadata(), downloader_factory=_no_downloader, exif_utils=exif)


@pytest.mark.asyncio
async def test_replace_preview_deletes_every_old_preview_and_writes_webp(library: Path):
    model = _write_model(library, "tiny", preview_ext=".jpeg")
    # A second, stale preview variant must go too.
    (library / "tiny.preview.png").write_bytes(b"stale")
    model_bytes = model.read_bytes()
    cache_updates: List[tuple] = []

    async def _update_cache(path, preview, level):
        cache_updates.append((path, preview, level))
        return True

    exif = _FakeExif()
    result = await _preview_service(exif).replace_preview(
        model_path=_posix(model),
        preview_data=b"\x89PNG new",
        content_type="image/png",
        original_filename="new.png",
        nsfw_level=4,
        update_preview_in_cache=_update_cache,
        metadata_loader=_json_loader,
    )

    names = set(_snapshot(library))
    assert "tiny.jpeg" not in names
    assert "tiny.preview.png" not in names
    assert "tiny.webp" in names
    assert (library / "tiny.webp").read_bytes() == b"webp-bytes"
    assert exif.calls and exif.calls[0]["format"] == "webp"
    assert model.read_bytes() == model_bytes
    saved = json.loads((library / "tiny.metadata.json").read_text())
    assert saved["preview_url"] == _posix(library / "tiny.webp")
    assert saved["preview_nsfw_level"] == 4
    # Untouched user data
    assert saved["notes"] == "keep me"
    assert saved["sha256"] == "abc123"
    assert result["preview_nsfw_level"] == 4
    assert cache_updates == [(_posix(model), _posix(library / "tiny.webp"), 4)]


@pytest.mark.asyncio
async def test_replace_preview_keeps_gif_bytes_and_extension(library: Path):
    model = _write_model(library, "tiny", preview_ext=".jpeg")

    async def _update_cache(*_args):
        return True

    exif = _FakeExif()
    await _preview_service(exif).replace_preview(
        model_path=_posix(model),
        preview_data=b"GIF89a-animated",
        content_type="image/gif",
        original_filename="anim.gif",
        nsfw_level=0,
        update_preview_in_cache=_update_cache,
        metadata_loader=_json_loader,
    )

    assert (library / "tiny.gif").read_bytes() == b"GIF89a-animated"
    assert not (library / "tiny.jpeg").exists()
    assert exif.calls == []
    saved = json.loads((library / "tiny.metadata.json").read_text())
    assert saved["preview_nsfw_level"] == 0


# ---------------------------------------------------------------------------
# save-metadata (NSFW level, favorite, base model) and verify-duplicates
# ---------------------------------------------------------------------------


def _sync_service() -> MetadataSyncService:
    async def _unused(*_args, **_kwargs):  # pragma: no cover - not used here
        raise AssertionError("no provider calls expected")

    return MetadataSyncService(
        metadata_manager=_SaveMetadata(),
        preview_service=MagicMock(),
        settings=MagicMock(),
        default_metadata_provider_factory=_unused,
        metadata_provider_selector=_unused,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "updates",
    [
        {"preview_nsfw_level": 8},
        {"favorite": True},
        {"base_model": "Illustrious"},
    ],
)
async def test_save_metadata_updates_only_the_sent_key(library: Path, updates: Dict[str, Any]):
    model = _write_model(library, "tiny")
    before = json.loads((library / "tiny.metadata.json").read_text())
    model_bytes = model.read_bytes()
    preview_bytes = (library / "tiny.jpeg").read_bytes()
    cache_calls: List[tuple] = []

    async def _update_cache(old, new, metadata):
        cache_calls.append((old, new, dict(metadata)))
        return True

    await _sync_service().save_metadata_updates(
        file_path=_posix(model), updates=updates, metadata_loader=_json_loader, update_cache=_update_cache
    )

    after = json.loads((library / "tiny.metadata.json").read_text())
    key, value = next(iter(updates.items()))
    assert after[key] == value
    for other in ("file_path", "preview_url", "sha256", "notes", "tags", "model_name"):
        assert after[other] == before[other]
    assert model.read_bytes() == model_bytes
    assert (library / "tiny.jpeg").read_bytes() == preview_bytes
    assert len(cache_calls) == 1 and cache_calls[0][2][key] == value


@pytest.mark.asyncio
async def test_save_metadata_round_trip_restores_the_original_values(library: Path):
    model = _write_model(library, "tiny")
    before = json.loads((library / "tiny.metadata.json").read_text())

    async def _update_cache(*_args):
        return True

    service = _sync_service()
    for updates in ({"preview_nsfw_level": 16, "favorite": True}, {"preview_nsfw_level": 1, "favorite": False}):
        await service.save_metadata_updates(
            file_path=_posix(model), updates=updates, metadata_loader=_json_loader, update_cache=_update_cache
        )

    after = json.loads((library / "tiny.metadata.json").read_text())
    # MetadataManager.save_metadata also stamps the file's `size` and
    # `modified`, so a save-metadata round trip is equal in content except for
    # those two bookkeeping keys (the live UI test restores the sidecar bytes
    # from a backup for that reason).
    stamped = {"size", "modified"}
    assert {k: v for k, v in after.items() if k not in stamped} == before


@pytest.mark.asyncio
async def test_verify_duplicates_writes_the_real_hash_of_a_mismatched_file(library: Path):
    first = _write_model(library / "a", "dup")
    second = _write_model(library / "b", "dup")
    second.write_bytes(b"different-weights")
    real = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (first, second)}

    # Both sidecars claim the first file's hash; the second file differs.
    for model in (first, second):
        meta_path = model.with_suffix(".metadata.json")
        data = json.loads(meta_path.read_text())
        data["sha256"] = real[str(first)]
        meta_path.write_text(json.dumps(data))

    async def _hash(path: str) -> str:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()

    updated: List[str] = []

    async def _update_cache(old, _new, _metadata):
        updated.append(old)
        return True

    result = await _sync_service().verify_duplicate_hashes(
        file_paths=[_posix(first), _posix(second)],
        metadata_loader=_json_loader,
        hash_calculator=_hash,
        update_cache=_update_cache,
    )

    assert result["verified_as_duplicates"] is False
    assert result["mismatched_files"] == [_posix(second)]
    assert result["new_hash_map"] == {_posix(second): real[str(second)]}
    # The corrected hash is persisted (verify is NOT read-only).
    assert json.loads(second.with_suffix(".metadata.json").read_text())["sha256"] == real[str(second)]
    assert updated == [_posix(second)]
    # Model files untouched
    assert first.read_bytes() == b"weights-dup" and second.read_bytes() == b"different-weights"


# ---------------------------------------------------------------------------
# Folder management
# ---------------------------------------------------------------------------


class _FolderScanner:
    def __init__(self, root: Path) -> None:
        self._root = root
        self.known: List[str] = []
        self.removed: List[str] = []
        self.renamed: List[tuple] = []

    def get_model_roots(self) -> List[str]:
        return [_posix(self._root)]

    def get_excluded_models(self) -> List[str]:
        return []

    async def add_known_folder(self, folder: str) -> None:
        self.known.append(folder)

    async def remove_known_folder(self, folder: str, absolute_path: str | None = None) -> None:
        self.removed.append(folder)

    async def rename_known_folder(self, previous: str, current: str, **kwargs) -> None:
        self.renamed.append((previous, current))


@pytest.mark.asyncio
async def test_folder_create_rename_delete_round_trip_of_an_empty_folder(library: Path):
    scanner = _FolderScanner(library)
    service = ModelMoveService(scanner, "lora")
    before = sorted(p.name for p in library.iterdir())

    created = await service.create_folder(_posix(library / "_lm-ui-test-b1"))
    assert created["success"] is True and created["created"] is True
    assert (library / "_lm-ui-test-b1").is_dir()

    renamed = await service.rename_folder(_posix(library / "_lm-ui-test-b1"), "_lm-ui-test-b1-renamed")
    assert renamed["success"] is True
    assert not (library / "_lm-ui-test-b1").exists()
    assert (library / "_lm-ui-test-b1-renamed").is_dir()

    probe = await service.delete_folder(_posix(library / "_lm-ui-test-b1-renamed"), dry_run=True)
    assert probe["success"] is True and probe["model_count"] == 0
    assert (library / "_lm-ui-test-b1-renamed").is_dir()

    deleted = await service.delete_folder(_posix(library / "_lm-ui-test-b1-renamed"))
    assert deleted["success"] is True
    assert sorted(p.name for p in library.iterdir()) == before


@pytest.mark.asyncio
async def test_delete_folder_refuses_a_folder_with_a_model_and_touches_nothing(library: Path):
    model = _write_model(library / "keep", "tiny")
    before = _snapshot(library / "keep")
    service = ModelMoveService(_FolderScanner(library), "lora")

    result = await service.delete_folder(_posix(library / "keep"))

    assert result["success"] is False
    assert result.get("code") == "not_empty"
    assert _snapshot(library / "keep") == before
    assert model.exists()


@pytest.mark.asyncio
async def test_delete_folder_removes_leftover_non_model_files(library: Path):
    folder = library / "leftovers"
    (folder / "nested").mkdir(parents=True)
    (folder / "readme.txt").write_text("x")
    (folder / "nested" / "orphan.jpeg").write_bytes(b"img")
    service = ModelMoveService(_FolderScanner(library), "lora")

    probe = await service.delete_folder(_posix(folder), dry_run=True)
    assert probe["success"] is True
    assert probe["file_count"] == 2
    assert probe["restorable"] is False

    result = await service.delete_folder(_posix(folder))
    assert result["success"] is True
    assert not folder.exists()


@pytest.mark.asyncio
async def test_delete_folder_refuses_the_library_root(library: Path):
    service = ModelMoveService(_FolderScanner(library), "lora")
    result = await service.delete_folder(_posix(library))
    assert result["success"] is False
    assert library.is_dir()


# ---------------------------------------------------------------------------
# Move with the default path template
# ---------------------------------------------------------------------------


def _make_scanner(root: Path, entries: list[dict]) -> LoraScanner:
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


class _TemplateSettings:
    def __init__(self, template: str) -> None:
        self._template = template

    def get_download_path_template(self, _model_type: str) -> str:
        return self._template

    def get(self, key: str, default: Any = None) -> Any:
        return default

    def resolve_priority_tag_for_model(self, tags, _model_type, **_kwargs) -> str:
        return tags[0] if tags else ""


@pytest.mark.asyncio
async def test_move_with_default_paths_applies_the_path_template(library: Path, monkeypatch: pytest.MonkeyPatch):
    import py.services.model_file_service as mfs
    import py.utils.utils as utils_module

    settings = _TemplateSettings("{base_model}")
    monkeypatch.setattr(utils_module, "get_settings_manager", lambda: settings)
    monkeypatch.setattr(mfs, "get_settings_manager", lambda: settings)

    model = _write_model(library / "somewhere", "tiny")
    entry = {
        "file_path": _posix(model),
        "file_name": "tiny",
        "model_name": "tiny",
        "folder": "somewhere",
        "base_model": "Illustrious",
        "sha256": "abc123",
        "tags": ["style"],
    }
    mover = ModelMoveService(_make_scanner(library, [entry]), "lora")

    out = await mover.move_model(_posix(model), _posix(library), use_default_paths=True)

    assert out["success"] is True
    assert out["new_file_path"] == _posix(library / "Illustrious" / "tiny.safetensors")
    assert (library / "Illustrious" / "tiny.safetensors").read_bytes() == b"weights-tiny"
    assert not model.exists()


@pytest.mark.asyncio
async def test_move_with_default_paths_and_flat_template_moves_to_the_root(library: Path, monkeypatch: pytest.MonkeyPatch):
    import py.services.model_file_service as mfs
    import py.utils.utils as utils_module

    settings = _TemplateSettings("")
    monkeypatch.setattr(utils_module, "get_settings_manager", lambda: settings)
    monkeypatch.setattr(mfs, "get_settings_manager", lambda: settings)

    model = _write_model(library / "deep", "tiny")
    entry = {"file_path": _posix(model), "file_name": "tiny", "model_name": "tiny", "folder": "deep", "sha256": "abc123"}
    mover = ModelMoveService(_make_scanner(library, [entry]), "lora")

    out = await mover.move_model(_posix(model), _posix(library), use_default_paths=True)

    assert out["success"] is True
    assert out["new_file_path"] == _posix(library / "tiny.safetensors")
