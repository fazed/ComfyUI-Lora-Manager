"""Path-safety regression tests for BackupService.restore_snapshot.

An uploaded backup ZIP carries ``archive_path`` member names in its
manifest. ``Path('/x').is_absolute()`` is False on Windows, so rooted,
drive-relative and UNC names used to escape the extraction directory and
write anywhere. Every test runs with ``tempfile.tempdir`` pointed into
``tmp_path`` and asserts nothing is written outside the sandbox.
"""

import hashlib
import json
import os
import tempfile
import uuid
import zipfile
from pathlib import Path

import pytest

import py.services.backup_service as backup_service
from py.utils.cache_paths import CacheType


class DummySettings:
    def __init__(self, settings_file: Path):
        self.settings_file = str(settings_file)

    def get(self, key, default=None):
        return default


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    settings_dir = tmp_path / "settings"
    cache_dir = settings_dir / "cache"
    temp_root = tmp_path / "tmp"
    temp_root.mkdir()
    monkeypatch.setattr(tempfile, "tempdir", str(temp_root))

    def fake_get_settings_dir(create: bool = True):
        if create:
            settings_dir.mkdir(parents=True, exist_ok=True)
        return str(settings_dir)

    def fake_get_cache_base_dir(create: bool = True):
        if create:
            cache_dir.mkdir(parents=True, exist_ok=True)
        return str(cache_dir)

    def fake_get_cache_file_path(cache_type, library_name=None, create_dir=True):
        if cache_type == CacheType.SYMLINK:
            path = cache_dir / "symlink" / "symlink_map.json"
        elif cache_type == CacheType.MODEL_UPDATE:
            path = cache_dir / "model_update" / f"{library_name or 'default'}.sqlite"
        else:  # pragma: no cover
            raise AssertionError(cache_type)
        if create_dir:
            path.parent.mkdir(parents=True, exist_ok=True)
        return str(path)

    monkeypatch.setattr(backup_service, "get_settings_dir", fake_get_settings_dir)
    monkeypatch.setattr(backup_service, "get_cache_base_dir", fake_get_cache_base_dir)
    monkeypatch.setattr(backup_service, "get_cache_file_path", fake_get_cache_file_path)

    settings_dir.mkdir(parents=True)
    settings_file = settings_dir / "settings.json"
    settings_file.write_text('{"original": true}', encoding="utf-8")
    service = backup_service.BackupService(
        settings_manager=DummySettings(settings_file),
        backup_dir=str(tmp_path / "backups"),
    )
    return tmp_path, service, settings_file, temp_root


def _write_backup(path: Path, files: list[dict], members: dict[str, bytes]) -> None:
    manifest = {"manifest_version": 1, "snapshot_type": "manual", "files": files}
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        for name, data in members.items():
            info = zipfile.ZipInfo(name)
            # ZipInfo folds os.sep to "/"; keep the raw name for the probe.
            info.filename = name
            zf.writestr(info, data)


def _snapshot_tree(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


def _hostile_members(token: str) -> list[str]:
    return [
        f"/lm-canary-{token}.txt",
        f"\\lm-canary-{token}.txt",
        f"/Users/Public/lm-canary-{token}.bat",
        f"C:\\lm-canary-{token}.txt",
        f"C:lm-canary-{token}.txt",
        f"D:lm-canary-{token}.txt",
        f"\\\\srv\\share\\lm-canary-{token}.txt",
        f"//srv/share/lm-canary-{token}.txt",
        f"\\\\?\\C:\\lm-canary-{token}.txt",
        f"../lm-canary-{token}.txt",
        f"..\\..\\lm-canary-{token}.txt",
        f"settings/../../lm-canary-{token}.txt",
        f"settings/lm-canary-{token}.txt:ads",
        f"settings/CON",
        f"settings/lm-canary-{token}.txt.",
    ]


def _assert_no_canary(tmp_path: Path, token: str) -> None:
    drive_roots = {Path(Path.cwd().anchor), Path(tmp_path.anchor)}
    for candidate_root in [*drive_roots, tmp_path.parent, tmp_path.parent.parent, Path.cwd()]:
        assert not (candidate_root / f"lm-canary-{token}.txt").exists()
    assert not Path(f"/Users/Public/lm-canary-{token}.bat").exists()
    assert not list(tmp_path.rglob(f"lm-canary-{token}*"))


@pytest.mark.parametrize("index", range(len(_hostile_members("x"))))
async def test_restore_rejects_hostile_member_names(sandbox, index):
    tmp_path, service, settings_file, temp_root = sandbox
    token = uuid.uuid4().hex
    member = _hostile_members(token)[index]
    before = _snapshot_tree(tmp_path)

    archive = tmp_path / "evil.zip"
    _write_backup(
        archive,
        [{"kind": "settings", "archive_path": member}],
        {member: b"@echo pwned"},
    )
    before = _snapshot_tree(tmp_path)

    with pytest.raises(ValueError, match="Invalid archive member path"):
        await service.restore_snapshot(str(archive))

    assert settings_file.read_text(encoding="utf-8") == '{"original": true}'
    _assert_no_canary(tmp_path, token)
    # Nothing new in the sandbox either (the extraction dir is cleaned up).
    assert _snapshot_tree(tmp_path) == before
    assert list(temp_root.iterdir()) == []


async def test_restore_hostile_member_after_valid_one_restores_nothing(sandbox):
    tmp_path, service, settings_file, temp_root = sandbox
    token = uuid.uuid4().hex
    good = b'{"restored": true}'
    archive = tmp_path / "mixed.zip"
    _write_backup(
        archive,
        [
            {
                "kind": "settings",
                "archive_path": "settings/settings.json",
                "sha256": hashlib.sha256(good).hexdigest(),
            },
            {"kind": "usage_stats", "archive_path": f"..\\lm-canary-{token}.txt"},
        ],
        {"settings/settings.json": good, f"..\\lm-canary-{token}.txt": b"x"},
    )

    with pytest.raises(ValueError):
        await service.restore_snapshot(str(archive))

    assert settings_file.read_text(encoding="utf-8") == '{"original": true}'
    _assert_no_canary(tmp_path, token)
    assert list(temp_root.iterdir()) == []


async def test_restore_checksum_mismatch_leaves_nothing_behind(sandbox):
    tmp_path, service, settings_file, temp_root = sandbox
    archive = tmp_path / "bad-hash.zip"
    _write_backup(
        archive,
        [{"kind": "settings", "archive_path": "settings/settings.json", "sha256": "00"}],
        {"settings/settings.json": b'{"tampered": true}'},
    )
    before = _snapshot_tree(tmp_path)

    with pytest.raises(ValueError, match="Checksum mismatch"):
        await service.restore_snapshot(str(archive))

    assert settings_file.read_text(encoding="utf-8") == '{"original": true}'
    assert list(temp_root.iterdir()) == []
    assert _snapshot_tree(tmp_path) == before


async def test_restore_model_update_member_must_be_a_sqlite_file_name(sandbox):
    tmp_path, service, settings_file, temp_root = sandbox
    archive = tmp_path / "model-update.zip"
    _write_backup(
        archive,
        [{"kind": "model_update", "archive_path": "cache/model_update/evil.bat"}],
        {"cache/model_update/evil.bat": b"x"},
    )

    with pytest.raises(ValueError):
        await service.restore_snapshot(str(archive))
    assert not list(tmp_path.rglob("evil.bat"))
    assert list(temp_root.iterdir()) == []


async def test_restore_accepts_legitimate_nested_members(sandbox):
    tmp_path, service, settings_file, temp_root = sandbox
    settings_data = b'{"restored": true}'
    model_update = b"model-update"
    archive = tmp_path / "good.zip"
    _write_backup(
        archive,
        [
            {
                "kind": "settings",
                "archive_path": "settings/settings.json",
                "sha256": hashlib.sha256(settings_data).hexdigest(),
            },
            {
                "kind": "model_update",
                "archive_path": "cache/model_update/main.sqlite",
                "sha256": hashlib.sha256(model_update).hexdigest(),
            },
        ],
        {
            "settings/settings.json": settings_data,
            "cache/model_update/main.sqlite": model_update,
        },
    )

    result = await service.restore_snapshot(str(archive))

    assert result == {"success": True, "restored_files": 2, "snapshot_type": "manual"}
    assert settings_file.read_bytes() == settings_data
    restored = tmp_path / "settings" / "cache" / "model_update" / "main.sqlite"
    assert restored.read_bytes() == model_update
    assert list(temp_root.iterdir()) == []
