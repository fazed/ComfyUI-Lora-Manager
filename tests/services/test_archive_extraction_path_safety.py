"""Phase B1: archive members are validated per segment before extraction.

Hostile member names (traversal, drives, UNC, NTFS streams, reserved device
names) must be skipped, and nothing may be written outside the sandbox.
"""

from __future__ import annotations

import asyncio
import os
import zipfile
from pathlib import Path

import pytest

from py.services import download_manager as download_manager_module
from py.services.download_manager import DownloadManager
from py.services.metadata_archive_manager import MetadataArchiveManager

HOSTILE_MEMBERS = [
    "../escape.safetensors",
    "..\\escape2.safetensors",
    "../../outside/escape3.safetensors",
    "/abs/escape4.safetensors",
    "C:/Windows/escape5.safetensors",
    "C:escape6.safetensors",
    "\\\\srv\\share\\escape7.safetensors",
    "CON.safetensors",
    "dir/NUL.safetensors",
    "dir/lpt1.safetensors",
    "evil.safetensors:stream",
    "trailing.safetensors.",
]


def _snapshot(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob("*")}


def _write_zip(path: Path, members: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in members.items():
            # ZipInfo keeps the raw name; writestr(str) would normalise some.
            archive.writestr(zipfile.ZipInfo(name), data)


class _ImmediateLoop:
    async def run_in_executor(self, _executor, func, *args):
        return func(*args)


@pytest.mark.asyncio
async def test_model_archive_extraction_skips_hostile_member_names(tmp_path, monkeypatch):
    sandbox = tmp_path / "sandbox"
    target = sandbox / "loras" / "downloads"
    target.mkdir(parents=True)
    archive_path = target / "bundle.zip"
    members = {name: b"evil" for name in HOSTILE_MEMBERS}
    members["inner/good.safetensors"] = b"good"
    members["second.safetensors"] = b"good2"
    _write_zip(archive_path, members)
    outside_before = _snapshot(tmp_path) - {
        p for p in _snapshot(tmp_path) if p.startswith("sandbox")
    }

    monkeypatch.setattr(
        download_manager_module.asyncio, "get_running_loop", lambda: _ImmediateLoop()
    )
    manager = DownloadManager()
    extracted = await manager._extract_model_files_from_archive(
        str(archive_path), {".safetensors"}
    )

    # Directory parts are dropped (members are flattened into the target);
    # a last component that is not one safe segment is skipped: a drive
    # prefix ("C:escape6"), reserved device names (CON, NUL, LPT1).
    expected = sorted(
        [
            "escape.safetensors",
            "escape2.safetensors",
            "escape3.safetensors",
            "escape4.safetensors",
            "escape5.safetensors",
            "escape7.safetensors",
            "good.safetensors",
            "second.safetensors",
        ]
    )
    names = sorted(os.path.basename(p) for p in extracted)
    assert names == expected
    for path in extracted:
        assert Path(path).parent == target
    # Nothing was created next to the target or above the sandbox.
    assert sorted(p.name for p in target.iterdir()) == sorted(expected + ["bundle.zip"])
    outside_after = _snapshot(tmp_path) - {
        p for p in _snapshot(tmp_path) if p.startswith("sandbox")
    }
    assert outside_after == outside_before
    assert sorted(p.name for p in sandbox.iterdir()) == ["loras"]


@pytest.mark.asyncio
async def test_model_archive_extraction_keeps_legitimate_members(tmp_path, monkeypatch):
    archive_path = tmp_path / "bundle.zip"
    _write_zip(
        archive_path,
        {"nested/dir/model.safetensors": b"m", "readme.txt": b"r", "犬 style.safetensors": b"d"},
    )
    monkeypatch.setattr(
        download_manager_module.asyncio, "get_running_loop", lambda: _ImmediateLoop()
    )

    extracted = await DownloadManager()._extract_model_files_from_archive(
        str(archive_path), {".safetensors"}
    )

    assert sorted(os.path.basename(p) for p in extracted) == [
        "model.safetensors",
        "犬 style.safetensors",
    ]


def test_metadata_archive_extraction_skips_hostile_members(tmp_path):
    sandbox = tmp_path / "sandbox"
    base = sandbox / "metadata"
    base.mkdir(parents=True)
    manager = MetadataArchiveManager(str(base))
    members = {
        "civitai/": b"",
        "civitai/civitai.sqlite": b"db",
        "../escape.txt": b"x",
        "..\\escape2.txt": b"x",
        "civitai/../../escape3.txt": b"x",
        "/abs.txt": b"x",
        "C:/Windows/escape4.txt": b"x",
        "C:escape5.txt": b"x",
        "\\\\srv\\share\\escape6.txt": b"x",
        "civitai/CON": b"x",
        "civitai/x.sqlite:stream": b"x",
    }
    _write_zip(Path(manager.archive_path), members)

    manager._extract_zip_sync()

    assert (base / "civitai" / "civitai.sqlite").read_bytes() == b"db"
    assert sorted(_snapshot(base)) == sorted(
        ["civitai", os.path.join("civitai", "civitai.sqlite"), "civitai.zip"]
    )
    assert sorted(p.name for p in sandbox.iterdir()) == ["metadata"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["sandbox"]


def test_metadata_archive_extraction_keeps_the_real_layout(tmp_path):
    base = tmp_path / "metadata"
    base.mkdir()
    manager = MetadataArchiveManager(str(base))
    _write_zip(Path(manager.archive_path), {"civitai/civitai.sqlite": b"db"})

    manager._extract_zip_sync()

    assert manager.is_database_available()
    assert asyncio  # keep import used
