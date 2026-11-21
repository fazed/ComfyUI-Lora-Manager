"""Contract tests for the recipe endpoints the modern UI (`ui/`) relies on.

Phase B2a ports the recipe library, detail drawer and import flow from the
classic UI. These tests pin the behaviour documented in `ui/README.md`
("Phase B2a discovery") with the REAL route stack, persistence service,
ExifUtils and RecipeScanner on temp directories (only the LoRA library and the
Civitai client are doubles):

* save writes `<id>.webp` + `<id>.recipe.json` into the recipes root, the
  list/detail enrich LoRAs with `inLibrary`;
* analyze answers HTTP 200 with an `error` payload for an image without
  metadata, and parses A1111 parameters without network;
* update writes only the sent keys (and refuses a body without an allowed
  key); favorite/title/tags round trip;
* move to a subfolder and back is lossless (bytes of the JSON may change,
  the image bytes travel unchanged);
* reconnect points a missing LoRA at a library LoRA and restore puts the
  original entry back;
* delete stages the files, undo restores them byte-identically and re-lists
  the recipe; bulk delete returns one merged batch id;
* syntax lists only LoRAs that are in the library.
"""

from __future__ import annotations

import io
import json
import os
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Dict

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image, PngImagePlugin

from py.config import config
from py.routes.pending_delete_routes import PendingDeleteRoutes
from py.routes.recipe_routes import RecipeRoutes
from py.services import settings_manager as settings_manager_module
from py.services.model_scanner import ModelScanner
from py.services.pending_delete_service import _reset_pending_delete_service
from py.services.recipe_scanner import RecipeScanner
from py.services.service_registry import ServiceRegistry

LIB_HASH = "a" * 64
LIB_HASH_2 = "b" * 64
MISSING_HASH = "c" * 64


class _HashIndex:
    def __init__(self) -> None:
        self.paths: dict[str, str] = {}

    def get_path(self, hash_value: str) -> str | None:
        return self.paths.get(hash_value.lower())


class LibraryLoraScanner:
    """In-memory LoRA library with the surface RecipeScanner uses."""

    def __init__(self, root: Path) -> None:
        self._hash_index = _HashIndex()
        self._cache = SimpleNamespace(raw_data=[], version_index={})
        self.root = root

    def add(self, stem: str, sha: str, *, folder: str = "", base_model: str = "SDXL 1.0", version_id: int | None = None) -> str:
        directory = self.root / folder if folder else self.root
        directory.mkdir(parents=True, exist_ok=True)
        path = (directory / f"{stem}.safetensors").as_posix()
        entry = {
            "file_name": stem,
            "file_path": path,
            "folder": folder,
            "model_name": stem.replace("_", " ").title(),
            "base_model": base_model,
            "sha256": sha,
            "preview_url": "",
            "civitai": {"id": version_id, "modelId": 1000 + (version_id or 0), "name": "v1"} if version_id else {},
        }
        self._cache.raw_data.append(entry)
        self._hash_index.paths[sha] = path
        if version_id:
            self._cache.version_index[version_id] = entry
        return path

    async def get_cached_data(self) -> Any:
        return self._cache

    def has_hash(self, hash_value: str) -> bool:
        return hash_value.lower() in self._hash_index.paths

    def get_path_by_hash(self, hash_value: str) -> str | None:
        return self._hash_index.get_path(hash_value)

    def get_preview_url_by_hash(self, hash_value: str) -> str:
        return ""

    async def find_models_by_name(self, name: str, *, base_model: str | None = None) -> list[dict]:
        return ModelScanner.find_matching_models(self._cache.raw_data, name, base_model=base_model, extensions={".safetensors"})

    async def get_model_info_by_name(self, name: str, **_kwargs: Any) -> dict | None:
        matches = await self.find_models_by_name(name)
        return matches[0] if matches else None


class NoNetworkCivitai:
    """Any Civitai call is a test failure: the UI flows under test are offline."""

    def __getattr__(self, name: str) -> Any:
        async def _fail(*_args: Any, **_kwargs: Any) -> Any:
            raise AssertionError(f"unexpected Civitai call: {name}")

        return _fail


@pytest.fixture(autouse=True)
def _isolated_services(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    async def _none(*_args: Any, **_kwargs: Any) -> None:
        return None

    for getter in ("get_lora_scanner", "get_checkpoint_scanner", "get_embedding_scanner"):
        monkeypatch.setattr(ServiceRegistry, getter, _none)
    RecipeScanner._instance = None
    settings_manager_module.reset_settings_manager()
    _reset_pending_delete_service()
    yield
    _reset_pending_delete_service()
    RecipeScanner._instance = None
    settings_manager_module.reset_settings_manager()


@asynccontextmanager
async def ui_backend(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> AsyncIterator[SimpleNamespace]:
    lora_root = tmp_path / "loras"
    lora_root.mkdir()
    monkeypatch.setattr(config, "loras_roots", [str(lora_root)])
    monkeypatch.setattr(config, "extra_loras_roots", [], raising=False)
    library = LibraryLoraScanner(lora_root)
    library.add("film_grain", LIB_HASH, version_id=111)
    library.add("detail_tweaker", LIB_HASH_2, folder="style", version_id=222)

    scanner = RecipeScanner(lora_scanner=library)  # type: ignore[arg-type]
    await scanner.refresh_cache(force=True)
    if scanner._fts_index_task:
        await scanner._fts_index_task

    async def get_scanner() -> RecipeScanner:
        return scanner

    async def get_civitai() -> NoNetworkCivitai:
        return NoNetworkCivitai()

    monkeypatch.setattr(ServiceRegistry, "get_recipe_scanner", get_scanner)
    monkeypatch.setattr(ServiceRegistry, "get_civitai_client", get_civitai)

    app = web.Application()
    RecipeRoutes.setup_routes(app)
    PendingDeleteRoutes.setup_routes(app)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield SimpleNamespace(client=client, scanner=scanner, recipes_dir=Path(scanner.recipes_dir), library=library)
    finally:
        await client.close()


def _png(parameters: str | None = None, color: tuple[int, int, int] = (200, 40, 40)) -> bytes:
    image = Image.new("RGB", (64, 48), color)
    buffer = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    if parameters:
        info.add_text("parameters", parameters)
    image.save(buffer, format="PNG", pnginfo=info)
    return buffer.getvalue()


RECIPE_METADATA: Dict[str, Any] = {
    "base_model": "SDXL 1.0",
    "loras": [
        {"name": "Film Grain", "file_name": "film_grain", "hash": LIB_HASH, "weight": 0.8, "id": 111, "version": "v1"},
        {"name": "Ghost LoRA", "file_name": "ghost_lora", "hash": MISSING_HASH, "weight": 0.5, "id": 999, "version": "v3"},
    ],
    "gen_params": {"prompt": "a red square", "negative_prompt": "blurry", "steps": 20, "sampler": "Euler a", "cfg_scale": 7, "seed": 42},
    "checkpoint": {"type": "checkpoint", "name": "Base XL", "modelVersionId": 5},
}


async def _save(client: TestClient, name: str = "Contract recipe", tags: list[str] | None = None) -> dict:
    form = FormData()
    form.add_field("image", _png(), filename="tiny.png", content_type="image/png")
    form.add_field("name", name)
    form.add_field("tags", json.dumps(tags if tags is not None else ["contract", "test"]))
    form.add_field("metadata", json.dumps(RECIPE_METADATA))
    response = await client.post("/api/lm/recipes/save", data=form)
    assert response.status == 200, await response.text()
    body = await response.json()
    assert body["success"] is True
    return body


def _files(directory: Path) -> Dict[str, bytes]:
    return {
        path.relative_to(directory).as_posix(): path.read_bytes()
        for path in directory.rglob("*")
        if path.is_file()
    }


async def test_save_writes_image_and_json_into_root_and_lists_enriched_loras(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        body = await _save(backend.client)
        recipe_id = body["recipe_id"]

        assert sorted(_files(backend.recipes_dir)) == sorted([f"{recipe_id}.webp", f"{recipe_id}.recipe.json"])
        stored = json.loads((backend.recipes_dir / f"{recipe_id}.recipe.json").read_text(encoding="utf-8"))
        assert stored["title"] == "Contract recipe"
        assert stored["tags"] == ["contract", "test"]
        assert stored["folder"] == ""
        assert [lora["file_name"] for lora in stored["loras"]] == ["film_grain", "ghost_lora"]
        assert stored["loras"][0]["strength"] == 0.8
        assert stored["gen_params"]["prompt"] == "a red square"

        listing = await (await backend.client.get("/api/lm/recipes", params={"page": "1", "page_size": "20"})).json()
        assert listing["total"] == 1
        item = listing["items"][0]
        assert item["id"] == recipe_id
        assert item["file_url"].startswith("/api/lm/previews?path=")
        assert [lora["inLibrary"] for lora in item["loras"]] == [True, False]

        detail = await (await backend.client.get(f"/api/lm/recipe/{recipe_id}")).json()
        assert detail["loras"][0]["localPath"].endswith("film_grain.safetensors")
        assert detail["recipe_json_path"].endswith(f"{recipe_id}.recipe.json")


async def test_save_requires_name_and_metadata(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        form = FormData()
        form.add_field("image", _png(), filename="tiny.png", content_type="image/png")
        form.add_field("metadata", json.dumps(RECIPE_METADATA))
        response = await backend.client.post("/api/lm/recipes/save", data=form)
        assert response.status == 400
        assert "name" in (await response.json())["error"]
        assert _files(backend.recipes_dir) == {}


async def test_analyze_without_metadata_is_http_200_with_error(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        form = FormData()
        form.add_field("image", _png(), filename="plain.png", content_type="image/png")
        response = await backend.client.post("/api/lm/recipes/analyze-image", data=form)
        assert response.status == 200
        body = await response.json()
        assert body["error"] == "No metadata found in this image"
        assert body["loras"] == []
        assert _files(backend.recipes_dir) == {}


async def test_analyze_a1111_parameters_offline(monkeypatch, tmp_path: Path) -> None:
    params = "a red square, masterpiece\nNegative prompt: blurry\nSteps: 20, Sampler: Euler a, CFG scale: 7, Seed: 42, Size: 64x48"
    async with ui_backend(monkeypatch, tmp_path) as backend:
        form = FormData()
        form.add_field("image", _png(params), filename="params.png", content_type="image/png")
        response = await backend.client.post("/api/lm/recipes/analyze-image", data=form)
        assert response.status == 200
        body = await response.json()
        assert "error" not in body or not body["error"]
        assert body["gen_params"]["prompt"].startswith("a red square")
        assert body["gen_params"]["negative_prompt"] == "blurry"
        assert body["loras"] == []
        assert _files(backend.recipes_dir) == {}


async def test_update_round_trip_and_rejects_unknown_only_body(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        recipe_id = (await _save(backend.client))["recipe_id"]
        json_path = backend.recipes_dir / f"{recipe_id}.recipe.json"
        before = json.loads(json_path.read_text(encoding="utf-8"))

        response = await backend.client.put(
            f"/api/lm/recipe/{recipe_id}/update",
            json={"title": "Renamed", "tags": ["edited"], "favorite": True},
        )
        assert response.status == 200, await response.text()
        after = json.loads(json_path.read_text(encoding="utf-8"))
        assert after["title"] == "Renamed"
        assert after["tags"] == ["edited"]
        assert after["favorite"] is True
        changed = {key for key in set(before) | set(after) if before.get(key) != after.get(key)}
        assert changed == {"title", "tags", "favorite"}

        refused = await backend.client.put(f"/api/lm/recipe/{recipe_id}/update", json={"notes": "x"})
        assert refused.status == 400
        assert "notes" not in json.loads(json_path.read_text(encoding="utf-8"))

        detail = await (await backend.client.get(f"/api/lm/recipe/{recipe_id}")).json()
        assert detail["title"] == "Renamed"
        assert detail["favorite"] is True

        missing = await backend.client.put("/api/lm/recipe/does-not-exist/update", json={"title": "x"})
        assert missing.status == 404


async def test_move_to_subfolder_and_back(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        recipe_id = (await _save(backend.client))["recipe_id"]
        image_bytes = (backend.recipes_dir / f"{recipe_id}.webp").read_bytes()

        moved = await backend.client.post("/api/lm/recipe/move", json={"recipe_id": recipe_id, "target_path": "portraits/new"})
        assert moved.status == 200, await moved.text()
        body = await moved.json()
        assert body["folder"] == "portraits/new"
        assert sorted(_files(backend.recipes_dir)) == sorted(
            [f"portraits/new/{recipe_id}.webp", f"portraits/new/{recipe_id}.recipe.json"]
        )
        assert (backend.recipes_dir / "portraits" / "new" / f"{recipe_id}.webp").read_bytes() == image_bytes

        listing = await (await backend.client.get("/api/lm/recipes", params={"folder": "portraits"})).json()
        assert [item["id"] for item in listing["items"]] == [recipe_id]

        outside = await backend.client.post("/api/lm/recipe/move", json={"recipe_id": recipe_id, "target_path": str(tmp_path)})
        assert outside.status == 400

        back = await backend.client.post(
            "/api/lm/recipe/move", json={"recipe_id": recipe_id, "target_path": str(backend.recipes_dir)}
        )
        assert back.status == 200
        assert (await back.json())["folder"] == ""
        assert (backend.recipes_dir / f"{recipe_id}.webp").read_bytes() == image_bytes


async def test_reconnect_missing_lora_and_restore(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        recipe_id = (await _save(backend.client))["recipe_id"]
        json_path = backend.recipes_dir / f"{recipe_id}.recipe.json"
        original_entry = json.loads(json_path.read_text(encoding="utf-8"))["loras"][1]

        suggestions = await backend.client.get(
            f"/api/lm/recipe/{recipe_id}/lora/1/reconnect-suggestions", params={"query": "detail"}
        )
        assert suggestions.status == 200
        names = [entry["target_name"] for entry in (await suggestions.json())["suggestions"]]
        assert "detail_tweaker" in names

        unknown = await backend.client.post(
            "/api/lm/recipe/lora/reconnect", json={"recipe_id": recipe_id, "lora_index": 1, "target_name": "nope"}
        )
        assert unknown.status == 404

        response = await backend.client.post(
            "/api/lm/recipe/lora/reconnect",
            json={"recipe_id": recipe_id, "lora_index": 1, "target_name": "detail_tweaker"},
        )
        assert response.status == 200, await response.text()
        updated = (await response.json())["updated_lora"]
        assert updated["file_name"] == "detail_tweaker"
        assert updated["hash"] == LIB_HASH_2
        assert updated["inLibrary"] is True
        stored = json.loads(json_path.read_text(encoding="utf-8"))["loras"][1]
        assert stored["reconnectSnapshot"]["file_name"] == "ghost_lora"

        restored = await backend.client.post("/api/lm/recipe/lora/restore", json={"recipe_id": recipe_id, "lora_index": 1})
        assert restored.status == 200
        assert json.loads(json_path.read_text(encoding="utf-8"))["loras"][1] == original_entry


async def test_syntax_resolves_library_loras_and_keeps_missing_ones(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        recipe_id = (await _save(backend.client))["recipe_id"]
        body = await (await backend.client.get(f"/api/lm/recipe/{recipe_id}/syntax")).json()
        # A missing (not deleted) LoRA keeps its stored file name; only
        # isDeleted / hashInvalid entries are skipped.
        assert body["syntax"] == "<lora:film_grain:0.8> <lora:ghost_lora:0.5>"

        await backend.client.post(
            "/api/lm/recipe/lora/mark-hash-invalid", json={"recipe_id": recipe_id, "lora_index": 1}
        )
        body = await (await backend.client.get(f"/api/lm/recipe/{recipe_id}/syntax")).json()
        assert body["syntax"] == "<lora:film_grain:0.8>"


async def test_delete_then_undo_restores_files_byte_identically(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        recipe_id = (await _save(backend.client))["recipe_id"]
        before = _files(backend.recipes_dir)

        deleted = await backend.client.delete(f"/api/lm/recipe/{recipe_id}")
        assert deleted.status == 200
        batch_id = (await deleted.json())["batch_id"]
        assert isinstance(batch_id, str) and len(batch_id) == 32
        assert _files(backend.recipes_dir) == {}
        listing = await (await backend.client.get("/api/lm/recipes")).json()
        assert listing["total"] == 0

        undo = await backend.client.post("/api/lm/undo-delete", json={"batch_id": batch_id})
        assert undo.status == 200, await undo.text()
        assert (await undo.json())["kind"] == "recipe"
        assert _files(backend.recipes_dir) == before
        listing = await (await backend.client.get("/api/lm/recipes")).json()
        assert [item["id"] for item in listing["items"]] == [recipe_id]

        again = await backend.client.post("/api/lm/undo-delete", json={"batch_id": batch_id})
        assert again.status == 404


async def test_bulk_delete_merges_into_one_batch(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        first = (await _save(backend.client, "One"))["recipe_id"]
        second = (await _save(backend.client, "Two"))["recipe_id"]
        response = await backend.client.post("/api/lm/recipes/bulk-delete", json={"recipe_ids": [first, second, "missing"]})
        assert response.status == 200
        body = await response.json()
        assert sorted(body["deleted"]) == sorted([first, second])
        assert body["failed"] == [{"id": "missing", "reason": "Recipe not found"}]
        assert isinstance(body["batch_id"], str)
        assert _files(backend.recipes_dir) == {}

        undo = await backend.client.post("/api/lm/undo-delete", json={"batch_id": body["batch_id"]})
        assert undo.status == 200
        assert len(_files(backend.recipes_dir)) == 4


async def test_delete_unknown_recipe_is_404(monkeypatch, tmp_path: Path) -> None:
    async with ui_backend(monkeypatch, tmp_path) as backend:
        response = await backend.client.delete("/api/lm/recipe/unknown-id")
        assert response.status == 404
        assert os.listdir(backend.recipes_dir) == []
