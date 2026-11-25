"""Phase B1 (finding #8): ``model_hash`` must be a hash before it is a path.

The example-image GET endpoints join ``model_hash`` onto the example images
root. A request value such as ``C:\\Users\\u\\Pictures``, ``/Users/x``,
``..\\..`` or a UNC path must be refused as a string, before any filesystem
call (no listing, no ``makedirs``, no SMB connection).
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any, Dict

import pytest

from py.services.settings_manager import get_settings_manager
from py.utils import example_images_paths
from py.utils.example_images_file_manager import ExampleImagesFileManager
from py.utils.example_images_paths import get_model_folder

HOSTILE_HASHES = [
    "C:\\Users\\u\\Pictures",
    "C:/Users/u/Pictures",
    "/Users/x",
    "..\\..",
    "../..",
    "..",
    "\\\\attacker\\share",
    "//attacker/share",
    "a" * 63,
    "a" * 65,
    "g" * 64,
    ("a" * 64) + "/..",
    ("a" * 32) + "/" + ("a" * 31),
]


class _Request:
    def __init__(self, query: Dict[str, str] | None = None, payload: Dict[str, Any] | None = None):
        self.query = query or {}
        self._payload = payload or {}

    async def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _restore_settings():
    manager = get_settings_manager()
    original = copy.deepcopy(manager.settings)
    try:
        yield
    finally:
        manager.settings.clear()
        manager.settings.update(original)


@pytest.fixture
def no_filesystem(monkeypatch):
    calls: list[str] = []

    def _boom(name):
        def _inner(*_args, **_kwargs):
            calls.append(name)
            raise AssertionError(f"filesystem call: {name}")

        return _inner

    for name in ("exists", "isdir", "isfile"):
        monkeypatch.setattr(os.path, name, _boom(f"os.path.{name}"))
    # os.stat itself is left alone: pytest needs it to report a failure.
    for name in ("listdir", "makedirs", "startfile"):
        monkeypatch.setattr(os, name, _boom(f"os.{name}"), raising=False)
    return calls


def _json(response) -> Dict[str, Any]:
    return json.loads(response.text)


@pytest.mark.parametrize("model_hash", HOSTILE_HASHES)
def test_get_model_folder_refuses_non_hash_values(tmp_path, model_hash, no_filesystem):
    get_settings_manager().settings["example_images_path"] = str(tmp_path)

    assert get_model_folder(model_hash) == ""
    assert no_filesystem == []


def test_get_model_folder_keeps_real_hashes(tmp_path):
    get_settings_manager().settings["example_images_path"] = str(tmp_path)
    upper = "ABCDEF" + "0" * 58

    assert get_model_folder("a" * 64) == os.path.join(str(tmp_path), "a" * 64)
    assert get_model_folder(upper) == os.path.join(str(tmp_path), upper.lower())


@pytest.mark.asyncio
@pytest.mark.parametrize("model_hash", HOSTILE_HASHES)
async def test_get_files_rejects_non_hash_values_before_filesystem_access(
    tmp_path, model_hash, no_filesystem
):
    get_settings_manager().settings["example_images_path"] = str(tmp_path)

    response = await ExampleImagesFileManager.get_files(_Request({"model_hash": model_hash}))

    assert response.status == 400
    assert _json(response)["success"] is False
    assert no_filesystem == []


@pytest.mark.asyncio
@pytest.mark.parametrize("model_hash", HOSTILE_HASHES)
async def test_has_images_rejects_non_hash_values_before_filesystem_access(
    tmp_path, model_hash, no_filesystem
):
    get_settings_manager().settings["example_images_path"] = str(tmp_path)

    response = await ExampleImagesFileManager.has_images(_Request({"model_hash": model_hash}))

    assert response.status == 400
    assert _json(response)["has_images"] is False
    assert no_filesystem == []


@pytest.mark.asyncio
@pytest.mark.parametrize("model_hash", HOSTILE_HASHES[:4])
async def test_open_folder_rejects_non_hash_values_before_filesystem_access(
    tmp_path, model_hash, no_filesystem
):
    get_settings_manager().settings["example_images_path"] = str(tmp_path)

    response = await ExampleImagesFileManager.open_folder(
        _Request(payload={"model_hash": model_hash})
    )

    assert response.status == 400
    assert no_filesystem == []


@pytest.mark.asyncio
async def test_get_files_lists_a_real_hash_folder(tmp_path):
    get_settings_manager().settings["example_images_path"] = str(tmp_path)
    model_hash = "b" * 64
    folder = tmp_path / model_hash
    folder.mkdir()
    (folder / "image.png").write_bytes(b"x")

    response = await ExampleImagesFileManager.get_files(_Request({"model_hash": model_hash}))
    payload = _json(response)

    assert response.status == 200
    assert [entry["name"] for entry in payload["files"]] == ["image.png"]
    has = await ExampleImagesFileManager.has_images(_Request({"model_hash": model_hash}))
    assert _json(has)["has_images"] is True


def test_example_images_paths_module_exposes_is_hash_folder():
    assert example_images_paths.is_hash_folder("c" * 64)
    assert not example_images_paths.is_hash_folder("../" + "c" * 61)
