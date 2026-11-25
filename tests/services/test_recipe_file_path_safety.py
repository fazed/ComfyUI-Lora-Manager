"""Phase B1 (finding #7): a recipe's ``file_path`` / ``folder`` are untrusted.

They come from the editable ``.recipe.json``. Delete, move, EXIF rewrites,
the JSON lookup and the re-import target must stay inside the recipes folder
(also after ``realpath``, so a junction inside the folder cannot escape).
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from collections.abc import Iterator
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from py.services.pending_delete_service import _reset_pending_delete_service
from py.services.recipes.errors import RecipeValidationError
from py.services.recipes.persistence_service import RecipePersistenceService
from py.utils.recipes_paths import is_inside_recipes_dir


@pytest.fixture(autouse=True)
def _reset_service_singleton() -> Iterator[None]:
    _reset_pending_delete_service()
    yield
    _reset_pending_delete_service()


@pytest.fixture(autouse=True)
def _stub_scanner_registry(monkeypatch) -> None:
    from py.services.service_registry import ServiceRegistry

    async def _none(*_args: Any, **_kwargs: Any) -> None:
        return None

    for name in ("get_lora_scanner", "get_checkpoint_scanner", "get_embedding_scanner"):
        monkeypatch.setattr(ServiceRegistry, name, _none)


class _Exif:
    def __init__(self) -> None:
        self.appended: List[str] = []

    def append_recipe_metadata(self, image_path, recipe_data, **_kwargs):
        self.appended.append(image_path)


class _Scanner:
    def __init__(self, recipes_dir: Path) -> None:
        self.recipes_dir = str(recipes_dir)
        self._json: Dict[str, str] = {}
        self._data: Dict[str, Dict[str, Any]] = {}
        self.updates: List[Dict[str, Any]] = []
        self.removed: List[str] = []

    def register(self, recipe_id: str, json_path: Path, data: Dict[str, Any]) -> None:
        self._json[recipe_id] = str(json_path)
        self._data[recipe_id] = data

    async def get_recipe_json_path(self, recipe_id: str) -> Optional[str]:
        return self._json.get(recipe_id)

    async def get_recipe_by_id(self, recipe_id: str):
        return self._data.get(recipe_id)

    async def update_recipe_metadata(self, recipe_id: str, updates: Dict[str, Any]) -> bool:
        self.updates.append(updates)
        return True

    async def remove_recipe(self, recipe_id: str) -> bool:
        self.removed.append(recipe_id)
        return True

    async def bulk_remove(self, recipe_ids) -> int:
        self.removed.extend(recipe_ids)
        return len(list(recipe_ids))


def _service(exif: _Exif | None = None) -> RecipePersistenceService:
    return RecipePersistenceService(
        exif_utils=exif or _Exif(), card_preview_width=512, logger=logging.getLogger("test")
    )


def _sandbox(tmp_path: Path):
    recipes = tmp_path / "recipes"
    recipes.mkdir()
    victim_dir = tmp_path / "victim"
    victim_dir.mkdir()
    victim = victim_dir / "important.png"
    victim.write_bytes(b"do not touch")
    return recipes, victim


def _plant_recipe(recipes: Path, recipe_id: str, file_path: str, **extra) -> tuple[Path, dict]:
    data = {"id": recipe_id, "title": "t", "file_path": file_path, "loras": [], **extra}
    json_path = recipes / f"{recipe_id}.recipe.json"
    json_path.write_text(json.dumps(data), encoding="utf-8")
    return json_path, data


HOSTILE_IMAGE_PATHS = [
    "{victim}",
    "{recipes}/../victim/important.png",
    "\\\\attacker\\share\\x.png",
    "C:\\Windows\\win.ini",
]


def _expand(template: str, recipes: Path, victim: Path) -> str:
    return template.format(victim=str(victim), recipes=str(recipes))


@pytest.mark.asyncio
@pytest.mark.parametrize("template", HOSTILE_IMAGE_PATHS)
async def test_delete_recipe_never_deletes_an_image_outside_the_recipes_folder(
    tmp_path, monkeypatch, template
):
    monkeypatch.setattr(
        "py.services.recipes.persistence_service.os.remove",
        _guarded_remove(tmp_path / "recipes"),
    )
    recipes, victim = _sandbox(tmp_path)
    scanner = _Scanner(recipes)
    json_path, data = _plant_recipe(recipes, "r1", _expand(template, recipes, victim))
    scanner.register("r1", json_path, data)

    result = await _service().delete_recipe(recipe_scanner=scanner, recipe_id="r1")

    assert result.payload["success"] is True
    assert not json_path.exists()
    assert victim.read_bytes() == b"do not touch"


def _guarded_remove(recipes: Path):
    real_remove = os.remove

    def _remove(path, *args, **kwargs):
        assert is_inside_recipes_dir(str(path), str(recipes)), f"removed outside: {path}"
        return real_remove(path, *args, **kwargs)

    return _remove


@pytest.mark.asyncio
async def test_delete_recipe_still_deletes_its_own_image(tmp_path):
    recipes, _victim = _sandbox(tmp_path)
    image = recipes / "r1.webp"
    image.write_bytes(b"img")
    scanner = _Scanner(recipes)
    json_path, data = _plant_recipe(recipes, "r1", str(image))
    scanner.register("r1", json_path, data)

    await _service().delete_recipe(recipe_scanner=scanner, recipe_id="r1")

    assert not image.exists()
    assert not json_path.exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("template", HOSTILE_IMAGE_PATHS[:2])
async def test_bulk_delete_never_deletes_an_image_outside_the_recipes_folder(
    tmp_path, template
):
    recipes, victim = _sandbox(tmp_path)
    scanner = _Scanner(recipes)
    json_path, data = _plant_recipe(recipes, "r1", _expand(template, recipes, victim))
    scanner.register("r1", json_path, data)

    await _service().bulk_delete(recipe_scanner=scanner, recipe_ids=["r1"])

    assert not json_path.exists()
    assert victim.read_bytes() == b"do not touch"


@pytest.mark.asyncio
@pytest.mark.parametrize("template", HOSTILE_IMAGE_PATHS[:2])
async def test_move_recipe_never_moves_an_image_from_outside(tmp_path, template):
    recipes, victim = _sandbox(tmp_path)
    (recipes / "dest").mkdir()
    scanner = _Scanner(recipes)
    hostile = _expand(template, recipes, victim)
    json_path, data = _plant_recipe(recipes, "r1", hostile)
    scanner.register("r1", json_path, data)

    result = await _service().move_recipe(
        recipe_scanner=scanner, recipe_id="r1", target_path=str(recipes / "dest")
    )

    assert result.payload["success"] is True
    assert victim.read_bytes() == b"do not touch"
    assert not (recipes / "dest" / "important.png").exists()
    assert (recipes / "dest" / "r1.recipe.json").exists()
    # The reference is kept (normalized as before), the file is not moved.
    assert scanner.updates[-1]["file_path"] == os.path.normpath(hostile)


@pytest.mark.asyncio
async def test_move_recipe_moves_its_own_image(tmp_path):
    recipes, _victim = _sandbox(tmp_path)
    image = recipes / "r1.webp"
    image.write_bytes(b"img")
    scanner = _Scanner(recipes)
    json_path, data = _plant_recipe(recipes, "r1", str(image))
    scanner.register("r1", json_path, data)

    await _service().move_recipe(recipe_scanner=scanner, recipe_id="r1", target_path="sub")

    assert (recipes / "sub" / "r1.webp").read_bytes() == b"img"
    assert scanner.updates[-1]["folder"] == "sub"


@pytest.mark.parametrize(
    "target", ["../victim", "..\\victim", "/elsewhere", "\\\\srv\\share", "C:\\Windows"]
)
def test_move_target_must_stay_inside_the_recipes_folder(tmp_path, target):
    recipes, _victim = _sandbox(tmp_path)

    with pytest.raises(RecipeValidationError):
        _service()._normalize_target_path(_Scanner(recipes), target)


def test_move_target_accepts_relative_and_absolute_folders_inside(tmp_path):
    recipes, _victim = _sandbox(tmp_path)
    scanner = _Scanner(recipes)

    target, root = _service()._normalize_target_path(scanner, "a/b")
    assert target == os.path.normpath(str(recipes / "a" / "b"))
    target, _ = _service()._normalize_target_path(scanner, str(recipes / "c"))
    assert target == os.path.normpath(str(recipes / "c"))
    assert root == os.path.normpath(str(recipes))


def _make_junction(link: Path, target: Path) -> bool:
    try:
        if os.name == "nt":
            result = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(link), str(target)],
                capture_output=True,
            )
            return result.returncode == 0
        link.symlink_to(target, target_is_directory=True)
        return True
    except OSError:
        return False


def test_move_target_through_a_junction_inside_the_recipes_folder_is_refused(tmp_path):
    recipes, victim = _sandbox(tmp_path)
    if not _make_junction(recipes / "link", victim.parent):
        pytest.skip("cannot create a junction/symlink here")

    with pytest.raises(RecipeValidationError):
        _service()._normalize_target_path(_Scanner(recipes), "link")
    assert not is_inside_recipes_dir(str(recipes / "link" / "important.png"), str(recipes))


@pytest.mark.asyncio
@pytest.mark.parametrize("template", HOSTILE_IMAGE_PATHS[:2])
async def test_reconnect_style_exif_writes_skip_outside_images(tmp_path, template):
    # restore_lora is one of four EXIF rewrite sites sharing the guard.
    recipes, victim = _sandbox(tmp_path)
    scanner = _Scanner(recipes)
    hostile = _expand(template, recipes, victim)

    async def restore_lora_entry(recipe_id, lora_index):
        return {"id": recipe_id, "file_path": hostile}, {}

    async def find_recipes_by_fingerprint(_fingerprint):
        return []

    scanner.restore_lora_entry = restore_lora_entry  # type: ignore[attr-defined]
    scanner.find_recipes_by_fingerprint = find_recipes_by_fingerprint  # type: ignore[attr-defined]
    exif = _Exif()

    await _service(exif).restore_lora(recipe_scanner=scanner, recipe_id="r1", lora_index=0)

    assert exif.appended == []
    assert victim.read_bytes() == b"do not touch"


# ---------------------------------------------------------------------------
# RecipeScanner: EXIF rewrite and JSON lookup
# ---------------------------------------------------------------------------


@pytest.fixture
def recipe_scanner(tmp_path, monkeypatch):
    from py.services.recipe_scanner import RecipeScanner

    recipes = tmp_path / "recipes"
    recipes.mkdir()
    scanner = RecipeScanner.__new__(RecipeScanner)
    scanner._cache = None
    scanner._persistent_cache = None
    scanner._json_path_map = {}
    monkeypatch.setattr(RecipeScanner, "recipes_dir", property(lambda _self: str(recipes)))
    return scanner, recipes


@pytest.mark.asyncio
async def test_update_recipe_metadata_skips_exif_for_outside_image(
    tmp_path, monkeypatch, recipe_scanner
):
    scanner, recipes = recipe_scanner
    _recipes, victim = tmp_path / "recipes", tmp_path / "victim" / "important.png"
    victim.parent.mkdir()
    victim.write_bytes(b"do not touch")
    json_path, _data = _plant_recipe(recipes, "r1", str(victim))

    async def json_path_for(_rid):
        return str(json_path)

    calls: List[str] = []
    monkeypatch.setattr(scanner, "get_recipe_json_path", json_path_for)
    monkeypatch.setattr(scanner, "_update_fts_index_for_recipe", lambda *_a, **_k: None, raising=False)
    monkeypatch.setattr(
        "py.utils.exif_utils.ExifUtils.append_recipe_metadata",
        lambda path, _data: calls.append(path),
    )

    assert await scanner.update_recipe_metadata("r1", {"title": "new"}) is True
    assert calls == []
    assert victim.read_bytes() == b"do not touch"

    inside = recipes / "r1.webp"
    inside.write_bytes(b"img")
    _plant_recipe(recipes, "r1", str(inside))
    assert await scanner.update_recipe_metadata("r1", {"title": "again"}) is True
    assert calls == [str(inside)]


@pytest.mark.asyncio
async def test_get_recipe_json_path_ignores_a_folder_that_escapes(
    tmp_path, monkeypatch, recipe_scanner
):
    scanner, recipes = recipe_scanner
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "r1.recipe.json").write_text("{}", encoding="utf-8")

    class _Cache:
        raw_data = [{"id": "r1", "folder": "../outside"}]

    async def cached(*_a, **_k):
        return _Cache()

    monkeypatch.setattr(scanner, "get_cached_data", cached)

    assert await scanner.get_recipe_json_path("r1") is None
    inside = recipes / "r1.recipe.json"
    inside.write_text("{}", encoding="utf-8")
    assert await scanner.get_recipe_json_path("r1") == str(inside)


def test_is_inside_recipes_dir_rules(tmp_path):
    recipes = tmp_path / "recipes"
    recipes.mkdir()
    assert is_inside_recipes_dir(str(recipes / "a.png"), str(recipes))
    assert is_inside_recipes_dir(str(recipes / "sub" / "a.png"), str(recipes))
    assert not is_inside_recipes_dir(str(tmp_path / "recipes_old" / "a.png"), str(recipes))
    assert not is_inside_recipes_dir(str(recipes / ".." / "a.png"), str(recipes))
    assert not is_inside_recipes_dir("\\\\srv\\share\\a.png", str(recipes))
    assert not is_inside_recipes_dir("", str(recipes))
    assert not is_inside_recipes_dir(None, str(recipes))
    assert not is_inside_recipes_dir(str(recipes / "a.png"), "")
