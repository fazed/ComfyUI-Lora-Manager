"""Phase B1 (item 9): open-location endpoints act only inside library folders.

``open-file-location`` reveals files the UI shows (models, recipe images,
example images); ``open-model-sidecar-location`` only models. Both check the
path as a string before ``isfile`` (no SMB connection for a UNC payload) and
before anything is launched. The settings-UI directory picker (browse,
create, validate) is intentionally not restricted: choosing a new library
root means browsing outside the current ones.
"""

from __future__ import annotations

import json
import os
import subprocess
from types import SimpleNamespace

import pytest

from py.routes.handlers import misc_handlers
from py.routes.handlers.misc_handlers import FileSystemHandler


class _Request:
    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    library = tmp_path / "loras"
    library.mkdir()
    recipes = tmp_path / "recipes"
    recipes.mkdir()
    examples = tmp_path / "examples"
    examples.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    monkeypatch.setattr(
        misc_handlers.library_roots, "configured_download_roots", lambda *_a, **_k: [str(library)]
    )
    monkeypatch.setattr(
        "py.utils.recipes_paths.get_effective_recipes_dir", lambda: str(recipes)
    )
    launched: list = []
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: launched.append(a))
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: launched.append(a))
    monkeypatch.setattr(os, "startfile", lambda *a, **k: launched.append(a), raising=False)
    handler = FileSystemHandler(
        settings_service=SimpleNamespace(get=lambda key, default=None: str(examples) if key == "example_images_path" else default)
    )
    return SimpleNamespace(
        handler=handler, library=library, recipes=recipes, examples=examples,
        outside=outside, launched=launched,
    )


def _no_isfile(monkeypatch):
    def boom(*_a, **_k):  # pragma: no cover - must not run
        raise AssertionError("isfile called before the root check")

    monkeypatch.setattr(misc_handlers.os.path, "isfile", boom)


HOSTILE = [
    "{outside}/x.safetensors",
    "{library}/../outside/x.safetensors",
    "{library}_old/x.safetensors",
    "\\\\attacker\\share\\x.safetensors",
    "//attacker/share/x.safetensors",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("template", HOSTILE)
async def test_open_file_location_refuses_paths_outside_library_folders(
    sandbox, monkeypatch, template
):
    _no_isfile(monkeypatch)
    path = template.format(outside=sandbox.outside, library=sandbox.library)

    response = await sandbox.handler.open_file_location(_Request({"file_path": path}))

    assert response.status == 400
    assert json.loads(response.text)["success"] is False
    assert sandbox.launched == []


@pytest.mark.asyncio
@pytest.mark.parametrize("template", HOSTILE)
async def test_open_model_sidecar_location_refuses_paths_outside_the_library(
    sandbox, monkeypatch, template
):
    _no_isfile(monkeypatch)
    path = template.format(outside=sandbox.outside, library=sandbox.library)

    response = await sandbox.handler.open_model_sidecar_location(_Request({"file_path": path}))

    assert response.status == 400
    assert sandbox.launched == []


@pytest.mark.asyncio
async def test_open_model_sidecar_location_refuses_recipe_images(sandbox):
    image = sandbox.recipes / "r.webp"
    image.write_bytes(b"x")

    response = await sandbox.handler.open_model_sidecar_location(
        _Request({"file_path": str(image)})
    )

    assert response.status == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("folder", ["library", "recipes", "examples"])
async def test_open_file_location_accepts_files_in_library_folders(sandbox, folder):
    target = getattr(sandbox, folder) / "a.png"
    target.write_bytes(b"x")

    response = await sandbox.handler.open_file_location(_Request({"file_path": str(target)}))

    assert response.status == 200
    assert len(sandbox.launched) == 1


@pytest.mark.asyncio
async def test_open_file_location_missing_file_inside_is_still_404(sandbox):
    response = await sandbox.handler.open_file_location(
        _Request({"file_path": str(sandbox.library / "missing.safetensors")})
    )

    assert response.status == 404


@pytest.mark.asyncio
async def test_open_file_location_fails_closed_without_roots(sandbox, monkeypatch):
    monkeypatch.setattr(
        misc_handlers.library_roots, "configured_download_roots", lambda *_a, **_k: []
    )
    monkeypatch.setattr("py.utils.recipes_paths.get_effective_recipes_dir", lambda: "")
    handler = FileSystemHandler(settings_service=SimpleNamespace(get=lambda *_a, **_k: None))
    target = sandbox.library / "a.png"
    target.write_bytes(b"x")

    response = await handler.open_file_location(_Request({"file_path": str(target)}))

    assert response.status == 400
