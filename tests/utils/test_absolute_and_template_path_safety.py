"""Phase B1: Python 3.13 ``isabs`` regressions (item 6) and template-derived
paths (finding #13).

* ``is_absolute_like`` restores the pre-3.13 meaning of "absolute" for rooted
  Windows paths, checked against ``ntpath.splitroot`` for arbitrary strings.
* ``batch_import`` accepts intentionally absolute local paths (including
  rooted ``/x``), refuses relative ones, ``..`` segments and UNC paths outside
  the library.
* ``calculate_relative_path_for_model`` neutralizes ``{base_model}`` and
  ``{author}`` values that would add drives, separators or ``..``.
"""

from __future__ import annotations

import logging
import ntpath
import os
import posixpath

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from py.services.batch_import_service import BatchImportService
from py.services.settings_manager import SettingsManager, get_settings_manager
from py.utils.safe_paths import is_absolute_like, validate_relative_path
from py.utils.utils import calculate_relative_path_for_model

# ---------------------------------------------------------------------------
# is_absolute_like vs a simulated ntpath / posixpath
# ---------------------------------------------------------------------------


def _ntpath_rooted(value: str) -> bool:
    """Pre-3.13 Windows meaning: a root after the drive, or a UNC drive."""

    drive, root, _tail = ntpath.splitroot(value)
    unified = drive.replace("/", "\\")
    return bool(root) or unified.startswith("\\\\")


@settings(max_examples=400, deadline=None)
@given(st.text(alphabet="C:/\\x. ", max_size=8))
def test_is_absolute_like_matches_simulated_ntpath(value):
    assert is_absolute_like(value) == _ntpath_rooted(value)


@settings(max_examples=200, deadline=None)
@given(st.text(alphabet="/ax.", min_size=1, max_size=8))
def test_is_absolute_like_covers_every_posix_absolute_path(value):
    if posixpath.isabs(value):
        assert is_absolute_like(value)


def test_is_absolute_like_on_the_real_platform(tmp_path):
    assert is_absolute_like(str(tmp_path))
    assert is_absolute_like(os.path.abspath("x"))
    assert not is_absolute_like(os.path.join("a", "b"))


# ---------------------------------------------------------------------------
# batch import local paths
# ---------------------------------------------------------------------------


class _Ws:
    async def broadcast(self, *_a, **_k):
        return None


@pytest.fixture
def batch_service():
    return BatchImportService(
        analysis_service=object(),  # type: ignore[arg-type]
        persistence_service=object(),  # type: ignore[arg-type]
        ws_manager=_Ws(),
        logger=logging.getLogger("test"),
    )


@pytest.mark.parametrize(
    "value",
    [
        "C:\\Users\\u\\Pictures\\a.png",
        "C:/Users/u/Pictures/a.png",
        "/home/u/pictures/a.png",
        "\\Users\\u\\a.png",
        "D:\\imports\\my..image.png",
        "D:\\imports\\犬\\a.png",
    ],
)
def test_batch_import_accepts_intentionally_absolute_paths(batch_service, value):
    assert batch_service._validate_local_path(value) is True


@pytest.mark.parametrize(
    "value",
    [
        "",
        "   ",
        "relative/a.png",
        "C:relative.png",
        "../etc/passwd",
        "C:\\imports\\..\\..\\Windows\\win.ini",
        "/home/u/../../etc/passwd",
        "\\\\attacker\\share\\a.png",
        "//attacker/share/a.png",
        "\\\\?\\C:\\a.png",
        "C:\\a\x00.png",
        None,
    ],
)
def test_batch_import_refuses_unsafe_paths(batch_service, monkeypatch, value):
    monkeypatch.setattr(
        "py.utils.library_roots.configured_download_roots", lambda *_a, **_k: []
    )
    assert batch_service._validate_local_path(value) is False


def test_batch_import_allows_unc_inside_a_unc_library_root(batch_service, monkeypatch):
    monkeypatch.setattr(
        "py.utils.library_roots.configured_download_roots",
        lambda *_a, **_k: ["\\\\nas\\models\\loras"],
    )
    assert batch_service._validate_local_path("\\\\nas\\models\\loras\\recipes\\a.png") is True
    assert batch_service._validate_local_path("\\\\nas\\other\\a.png") is False


@pytest.mark.asyncio
async def test_batch_import_directory_refuses_unc_before_isdir(batch_service, monkeypatch):
    from py.services import batch_import_service
    from py.services.recipes import RecipeValidationError

    def boom(*_a, **_k):  # pragma: no cover - must not run
        raise AssertionError("filesystem access")

    monkeypatch.setattr(batch_import_service.os.path, "isdir", boom)
    monkeypatch.setattr(
        "py.utils.library_roots.configured_download_roots", lambda *_a, **_k: []
    )
    with pytest.raises(RecipeValidationError):
        await batch_service._discover_images("\\\\attacker\\share", recursive=False)


# ---------------------------------------------------------------------------
# recipe preview URL rewrite (rooted paths on Windows / 3.13)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("value", ["/mnt/recipes/a.webp", "C:/recipes/a.webp", "\\recipes\\a.webp"])
def test_recipe_preview_url_rewrites_absolute_like_paths(monkeypatch, value):
    from py.services import recipe_scanner as recipe_scanner_module
    from py.services.recipe_scanner import RecipeScanner

    seen = []
    monkeypatch.setattr(
        recipe_scanner_module.config,
        "get_preview_static_url",
        lambda path: seen.append(path) or "/api/lm/previews?path=x",
    )
    scanner = RecipeScanner.__new__(RecipeScanner)

    assert scanner._normalize_preview_url(value) == "/api/lm/previews?path=x"
    assert seen == [value]
    assert scanner._normalize_preview_url("relative/a.webp") == "relative/a.webp"
    assert scanner._normalize_preview_url("/api/lm/previews?path=y") == "/api/lm/previews?path=y"


# ---------------------------------------------------------------------------
# calculate_relative_path_for_model: {base_model} / {author}
# ---------------------------------------------------------------------------


@pytest.fixture
def isolated_settings(monkeypatch):
    manager = get_settings_manager()
    defaults = manager._get_default_settings()
    defaults.update(
        {
            "download_path_templates": {"lora": "{base_model}/{author}"},
            "base_model_path_mappings": {},
        }
    )
    monkeypatch.setattr(manager, "settings", defaults)
    monkeypatch.setattr(SettingsManager, "_save_settings", lambda self: None)
    return defaults


def _model(base_model, author="Creator"):
    return {
        "base_model": base_model,
        "tags": [],
        "civitai": {"id": 1, "creator": {"username": author}},
    }


@pytest.mark.parametrize(
    "base_model, author",
    [
        ("..\\..\\Temp", "Creator"),
        ("../../Temp", "Creator"),
        ("\\Windows\\Temp", "Creator"),
        ("/etc", "Creator"),
        ("C:evil", "Creator"),
        ("C:\\Windows", "Creator"),
        ("\\\\srv\\share", "Creator"),
        ("SDXL", "..\\..\\Temp"),
        ("SDXL", "C:evil"),
        ("SDXL", "../x"),
        ("SDXL", "a/b"),
        ("CON", "NUL"),
    ],
)
def test_template_values_cannot_escape_the_root(isolated_settings, base_model, author):
    result = calculate_relative_path_for_model(_model(base_model, author), "lora")

    normalized = validate_relative_path(result)  # raises on any unsafe shape
    assert ".." not in normalized.split("/")
    assert ":" not in normalized
    root = os.path.abspath("library-root")
    assert os.path.commonpath([root, os.path.abspath(os.path.join(root, normalized))]) == root


@pytest.mark.parametrize(
    "base_model, mapping, author, expected",
    [
        ("SDXL 1.0", {}, "Creator", "SDXL 1.0/Creator"),
        ("Flux.1 D", {}, "some_user-1", "Flux.1 D/some_user-1"),
        ("SDXL", {"SDXL": "XL/base"}, "Creator", "XL/base/Creator"),
        ("Pony", {"Pony": "Pony\\v6"}, "Creator", "Pony/v6/Creator"),
        ("", {}, "Creator", "Creator"),
    ],
)
def test_template_keeps_legitimate_values(isolated_settings, base_model, mapping, author, expected):
    isolated_settings["base_model_path_mappings"] = mapping

    assert calculate_relative_path_for_model(_model(base_model, author), "lora") == expected

