"""Phase B1: ad-hoc path validators migrated onto ``py.utils.safe_paths``.

Each migration keeps its legitimate behaviour (equivalence tests for normal
inputs) and refuses the shared hostile-payload matrix. Everything that may
touch the filesystem runs inside ``tmp_path``.
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from py.services.model_file_service import (
    ModelFileService,
    ModelMoveService,
    normalize_relative_folder,
)
from py.utils.safe_paths import UnsafePathError

IS_WINDOWS = os.name == "nt"

# Values that must never be accepted where a relative folder/name is expected.
HOSTILE_RELATIVE = [
    "/abs",
    "\\abs",
    "C:/Windows",
    "C:\\Windows",
    "C:evil",
    "\\\\srv\\share\\x",
    "//srv/share/x",
    "\\\\?\\C:\\x",
    "\\\\.\\pipe\\x",
    "..",
    "../outside",
    "a/../../b",
    "a:b",
    "a/file.txt:stream",
    "CON",
    "a/NUL.txt",
    "com1",
    "a./b",
    "a /b",
    "x\x00y",
    "x\x1fy",
    "a/<b>",
    "a/b|c",
]


# ---------------------------------------------------------------------------
# normalize_relative_folder / resolve_folder
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        ("a", "a"),
        ("a/b", "a/b"),
        ("a\\b", "a/b"),
        ("  a/b/  ", "a/b"),
        ("a//b", "a/b"),
        ("./a", "a"),
        ("a/./b", "a/b"),
        ("a/../b", "b"),
        ("a/..", "."),
        ("SDXL 1.0/犬 style", "SDXL 1.0/犬 style"),
        (".hidden/x", ".hidden/x"),
    ],
)
def test_normalize_relative_folder_keeps_legitimate_results(value, expected):
    assert normalize_relative_folder(value) == expected


@pytest.mark.parametrize("value", HOSTILE_RELATIVE + ["", "   "])
def test_normalize_relative_folder_refuses_hostile_values(value):
    with pytest.raises(ValueError):
        normalize_relative_folder(value)


class _Scanner:
    def __init__(self, roots):
        self._roots = [str(root) for root in roots]

    def get_model_roots(self):
        return list(self._roots)

    def get_excluded_models(self):
        return []


@pytest.mark.parametrize("value", HOSTILE_RELATIVE)
def test_resolve_folder_refuses_hostile_values_without_creating_anything(tmp_path, value):
    root = tmp_path / "library"
    root.mkdir()
    before = sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*"))

    result = ModelMoveService(_Scanner([root]), "lora").resolve_folder(value)

    assert result["success"] is False
    assert sorted(p.relative_to(tmp_path) for p in tmp_path.rglob("*")) == before


def test_resolve_folder_does_not_match_a_prefix_sibling(tmp_path):
    root = tmp_path / "loras"
    (tmp_path / "loras_old" / "x").mkdir(parents=True)
    root.mkdir()

    result = ModelMoveService(_Scanner([root]), "lora").resolve_folder("x")

    assert result == {"success": True, "folder": "x", "candidates": []}


# ---------------------------------------------------------------------------
# ModelFileService._find_model_root (finding #15: startswith without separator)
# ---------------------------------------------------------------------------


def test_find_model_root_is_boundary_aware(tmp_path):
    service = ModelFileService.__new__(ModelFileService)
    loras = str(tmp_path / "loras")
    sibling_file = str(tmp_path / "loras_old" / "x.safetensors")

    assert service._find_model_root(sibling_file, [loras]) is None
    assert service._find_model_root(str(tmp_path / "loras" / "a" / "x.safetensors"), [loras]) == loras


def test_find_model_root_keeps_first_match_order(tmp_path):
    service = ModelFileService.__new__(ModelFileService)
    outer = str(tmp_path / "models")
    inner = str(tmp_path / "models" / "loras")
    path = str(tmp_path / "models" / "loras" / "x.safetensors")

    assert service._find_model_root(path, [outer, inner]) == outer
    assert service._find_model_root(path, [inner, outer]) == inner


@pytest.mark.skipif(not IS_WINDOWS, reason="Windows paths are case-insensitive")
def test_find_model_root_is_case_insensitive_on_windows(tmp_path):
    service = ModelFileService.__new__(ModelFileService)
    root = str(tmp_path / "Loras")
    path = str(tmp_path / "loras" / "x.safetensors").upper()

    assert service._find_model_root(path, [root]) == root


# ---------------------------------------------------------------------------
# download queue destination (_parse_queue_destination)
# ---------------------------------------------------------------------------


@pytest.fixture
def queue_roots(monkeypatch, tmp_path):
    from py.routes.handlers import model_handlers

    loras = tmp_path / "loras"
    loras.mkdir()
    fake = SimpleNamespace(
        loras_roots=[str(loras)],
        base_models_roots=[],
        embeddings_roots=[],
        extra_loras_roots=[],
        extra_checkpoints_roots=[],
        extra_unet_roots=[],
        extra_embeddings_roots=[],
    )
    monkeypatch.setattr(model_handlers, "config", fake)
    return loras


def _parse(query):
    from py.routes.handlers.model_handlers import ModelDownloadHandler

    return ModelDownloadHandler._parse_queue_destination(query)


@pytest.mark.parametrize(
    "relative, expected",
    [
        ("a/b", "a/b"),
        ("a\\b", "a/b"),
        ("a//b/", "a/b"),
        (" a/b ", "a/b"),
        ("SDXL 1.0/犬 style", "SDXL 1.0/犬 style"),
    ],
)
def test_queue_destination_keeps_legitimate_relative_paths(queue_roots, relative, expected):
    result = _parse(
        {"model_root": str(queue_roots), "relative_path": relative, "use_default_paths": "false"}
    )
    assert result["relative_path"] == expected
    assert result["model_root"] == os.path.normpath(str(queue_roots)).replace(os.sep, "/")


def test_queue_destination_accepts_root_spelling_variants(queue_roots):
    variant = str(queue_roots).replace(os.sep, "/") + "/"
    if IS_WINDOWS:
        variant = variant.upper()
    result = _parse({"model_root": variant})
    assert result["model_root"] == os.path.normpath(str(queue_roots)).replace(os.sep, "/")


def test_queue_destination_without_root_is_legacy(queue_roots):
    assert _parse({}) is None
    with pytest.raises(ValueError):
        _parse({"relative_path": "a"})


@pytest.mark.parametrize("relative", [v for v in HOSTILE_RELATIVE if v.strip(" /\\")])
def test_queue_destination_refuses_hostile_relative_paths(queue_roots, relative):
    with pytest.raises(ValueError):
        _parse(
            {"model_root": str(queue_roots), "relative_path": relative, "use_default_paths": "false"}
        )


def test_queue_destination_refuses_unconfigured_and_sibling_roots(queue_roots, tmp_path):
    for root in (str(tmp_path / "loras_old"), str(tmp_path), "\\\\srv\\share", "C:\\Windows"):
        with pytest.raises(ValueError):
            _parse({"model_root": root})


def test_queue_destination_ignores_relative_path_with_default_paths(queue_roots):
    result = _parse({"model_root": str(queue_roots), "relative_path": "../../x"})
    assert result["relative_path"] == ""
    assert result["use_default_paths"] is True


# ---------------------------------------------------------------------------
# model_source_handlers._find_matching_root (set_hf_url, case-sensitive before)
# ---------------------------------------------------------------------------


@pytest.fixture
def source_roots(monkeypatch, tmp_path):
    from py.routes.handlers import model_source_handlers

    vae = tmp_path / "models" / "vae"
    models = tmp_path / "models"
    fake = SimpleNamespace(
        loras_roots=[],
        extra_loras_roots=[],
        checkpoints_roots=[str(models)],
        extra_checkpoints_roots=[],
        unet_roots=[],
        extra_unet_roots=[],
        embeddings_roots=[],
        extra_embeddings_roots=[],
        other_roots=[str(vae)],
    )
    monkeypatch.setattr(model_source_handlers, "config", fake)
    return models, vae


def test_find_matching_root_prefers_the_most_specific_root(source_roots):
    from py.routes.handlers.model_source_handlers import _find_matching_root

    models, vae = source_roots
    assert _find_matching_root(str(vae / "sub")) == str(vae).replace(os.sep, "/")
    assert _find_matching_root(str(models / "vae-old")) == str(models).replace(os.sep, "/")


def test_find_matching_root_refuses_outside_paths(source_roots, tmp_path):
    from py.routes.handlers.model_source_handlers import _find_matching_root

    assert _find_matching_root(str(tmp_path / "elsewhere")) is None
    assert _find_matching_root("\\\\srv\\share\\models") is None
    assert _find_matching_root(str(tmp_path / "models_evil")) is None


@pytest.mark.skipif(not IS_WINDOWS, reason="Windows paths are case-insensitive")
def test_find_matching_root_is_case_insensitive_on_windows(source_roots):
    from py.routes.handlers.model_source_handlers import _find_matching_root

    _models, vae = source_roots
    assert _find_matching_root(str(vae).upper()) == str(vae).replace(os.sep, "/")


@pytest.mark.asyncio
async def test_set_hf_url_refuses_outside_path_before_touching_the_filesystem(
    source_roots, monkeypatch
):
    from py.routes.handlers import model_source_handlers

    def boom(*_args, **_kwargs):  # pragma: no cover - must not run
        raise AssertionError("filesystem access before the root check")

    monkeypatch.setattr(model_source_handlers.os.path, "isfile", boom)

    class _Request:
        async def json(self):
            return {
                "file_path": "\\\\attacker\\share\\x.safetensors",
                "source_url": "https://huggingface.co/org/repo",
            }

    response = await model_source_handlers.ModelSourceHandler().set_hf_url(_Request())
    assert response.status == 400


# ---------------------------------------------------------------------------
# sidecar_paths containment helpers
# ---------------------------------------------------------------------------


def test_sidecar_path_contains_is_boundary_aware(tmp_path):
    from py.utils.sidecar_paths import _path_contains

    base = tmp_path / "plugin"
    base.mkdir()
    assert _path_contains(str(base), str(base / "settings.json"))
    assert _path_contains(str(base), str(base))
    assert not _path_contains(str(base), str(tmp_path / "plugin_old" / "x"))


def test_best_root_for_handles_drive_roots_and_siblings():
    from py.utils.sidecar_paths import _best_root_for

    sep = os.sep
    drive_root = "D:" + sep if IS_WINDOWS else sep
    loras = drive_root + "loras"
    assert _best_root_for(loras + sep + "x", (drive_root, loras)) == loras
    assert _best_root_for(drive_root + "other", (drive_root, loras)) == drive_root
    assert _best_root_for(loras + "_old" + sep + "x", (loras,)) is None


def test_is_workflow_artifact_path_is_boundary_aware(monkeypatch, tmp_path):
    from py.utils import sidecar_paths
    import py.config as config_module

    workflows = tmp_path / "workflows"
    monkeypatch.setattr(config_module.config, "workflows_roots", [str(workflows)], raising=False)
    inside = str(workflows / "a.json")
    sibling = str(tmp_path / "workflows_old" / "a.json")
    assert sidecar_paths.is_workflow_artifact_path(inside) is True
    assert sidecar_paths.is_workflow_artifact_path(sibling) is False


# ---------------------------------------------------------------------------
# modern UI static join
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "tail, expected_parts",
    [("assets/index-abc.js", ("assets", "index-abc.js")), ("favicon.svg", ("favicon.svg",))],
)
def test_modern_ui_safe_join_keeps_asset_paths(tmp_path, tail, expected_parts):
    from py.routes.modern_ui_routes import _safe_join

    assert _safe_join(str(tmp_path), tail) == os.path.join(os.path.abspath(tmp_path), *expected_parts)


@pytest.mark.parametrize("tail", HOSTILE_RELATIVE + ["", "."])
def test_modern_ui_safe_join_refuses_hostile_tails(tmp_path, tail):
    from py.routes.modern_ui_routes import _safe_join

    assert _safe_join(str(tmp_path), tail) is None


# ---------------------------------------------------------------------------
# directory picker: new folder name
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("name", ["New folder", "my.folder", ".hidden", "犬", "a-b_c (1)"])
def test_new_directory_name_keeps_legitimate_names(name):
    from py.utils.directory_browser import _validate_new_directory_name

    assert _validate_new_directory_name(name) is None


@pytest.mark.parametrize(
    "name",
    ["..", ".", "a/b", "a\\b", "CON", "con.txt", "Com1", "LPT¹", "foo.", "foo ", "a:b",
     "x\x01", "a?b", "a*b", "a|b", "C:", "\\\\srv", "x" * 256],
)
def test_new_directory_name_refuses_hostile_names(name):
    from py.utils.directory_browser import _validate_new_directory_name

    assert _validate_new_directory_name(name) == "name_invalid"


def test_new_directory_name_required():
    from py.utils.directory_browser import _validate_new_directory_name

    assert _validate_new_directory_name("") == "name_required"


def test_create_directory_refuses_traversal_and_creates_nothing(tmp_path):
    from py.utils.directory_browser import create_directory

    before = list(tmp_path.iterdir())
    for name in ("..", "../escape", "CON", "a:b"):
        payload, status = create_directory(str(tmp_path), name)
        assert status == 400
        assert payload["error_code"] == "name_invalid"
    assert list(tmp_path.iterdir()) == before


# ---------------------------------------------------------------------------
# wildcard archive member names
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        ("a.txt", "a.txt"),
        ("dir/a.txt", "dir/a.txt"),
        ("dir\\a.txt", "dir/a.txt"),
        ("./a.txt", "a.txt"),
        ("dir//a.txt", "dir/a.txt"),
        ("犬/a.yaml", "犬/a.yaml"),
    ],
)
def test_wildcard_member_names_keep_legitimate_values(value, expected):
    from py.services.wildcard_parser import _safe_member_name

    assert _safe_member_name(value) == expected


@pytest.mark.parametrize(
    "value",
    ["/abs.txt", "../x.txt", "a/../../x.txt", "C:/x.txt", "C:x.txt", "\\\\srv\\s\\x.txt",
     "a/CON.txt", "a:b.txt", "", "x\x00.txt"],
)
def test_wildcard_member_names_refuse_hostile_values(value):
    from py.services.wildcard_parser import _safe_member_name

    assert _safe_member_name(value) is None


# ---------------------------------------------------------------------------
# the two _is_within_root helpers
# ---------------------------------------------------------------------------


def test_misc_is_within_root_uses_realpath_and_boundaries(tmp_path):
    from py.routes.handlers.misc_handlers import NodeRegistryHandler

    root = tmp_path / "input"
    root.mkdir()
    assert NodeRegistryHandler._is_within_root(str(root), str(root / "a.png"))
    assert not NodeRegistryHandler._is_within_root(str(root), str(tmp_path / "input_old" / "a.png"))
    assert not NodeRegistryHandler._is_within_root(str(root), str(root / ".." / "x.png"))


def test_example_images_is_within_root_is_boundary_aware(tmp_path):
    from py.utils.example_images_file_manager import _is_within_root

    root = tmp_path / "examples"
    assert _is_within_root(str(root / ("a" * 64)), str(root))
    assert not _is_within_root(str(tmp_path / "examples_old" / "x"), str(root))
    assert not _is_within_root(str(root / ".." / "x"), str(root))


def test_validate_relative_path_error_is_a_value_error():
    # Callers catch ValueError; the shared error must stay a subclass.
    assert issubclass(UnsafePathError, ValueError)
    assert Path  # keep import used
