"""Tests for the shared path-safety helpers.

The validators apply Windows rules on every OS, so every Windows payload
below is exercised on Linux CI too. Containment checks that need real
Windows semantics use the ``ntpath`` variant or are skipped off Windows.
"""

import os
from urllib.parse import unquote

import pytest

from py.utils.safe_paths import (
    UnsafePathError,
    _is_within_ntpath,
    _is_within_posixpath,
    is_within,
    reject_unc_or_device,
    require_within_any,
    safe_join,
    validate_path_segment,
    validate_relative_path,
)

UNSAFE_RELATIVE = [
    "/abs",
    "\\abs",
    "C:evil",
    "C:\\abs",
    "C:/abs",
    "\\\\srv\\share\\x",
    "//srv/share",
    "\\\\?\\C:\\x",
    "\\\\.\\NUL",
    "..",
    "../x",
    "a/../b",
    "a\\..\\b",
    "a/./b",
    "a//b",
    "a:stream",
    "file.txt:ads",
    "CON",
    "con.txt",
    "sub/Con.tar.gz",
    "CON .txt",
    "COM1",
    "COM¹",
    "lpt²",
    "LPT9.log",
    "CONIN$",
    "conout$",
    "AUX",
    "nul",
    "PRN.json",
    "foo.",
    "foo ",
    ".. ",
    ". ",
    "a/foo./b",
    "a\x00b",
    "a\nb",
    "a\x1fb",
    "a<b",
    "a>b",
    'a"b',
    "a|b",
    "a?b",
    "a*b",
    "",
    "/",
    "\\",
    unquote("%E2%80%A6%5C..%5C..%5Cevil"),
    unquote("..%2F..%2Fsettings.json"),
    unquote("..%5C..%5Cx.json"),
]

SAFE_RELATIVE = [
    ("a", "a"),
    ("a/b", "a/b"),
    ("a\\b", "a/b"),
    ("SDXL 1.0/utility", "SDXL 1.0/utility"),
    ("a/b/", "a/b"),
    ("…", "…"),
    ("characters/犬", "characters/犬"),
    ("v1.5", "v1.5"),
    ("console", "console"),
    ("COM10", "COM10"),
    ("COM0", "COM0"),
    (".hidden", ".hidden"),
    ("..foo", "..foo"),
    ("100%cool", "100%cool"),
    ("a%5Cb", "a%5Cb"),
]


@pytest.mark.parametrize("value", UNSAFE_RELATIVE)
def test_validate_relative_path_rejects(value):
    with pytest.raises(UnsafePathError):
        validate_relative_path(value)


def test_unsafe_path_error_is_value_error():
    with pytest.raises(ValueError):
        validate_relative_path("/abs")


@pytest.mark.parametrize("value, expected", SAFE_RELATIVE)
def test_validate_relative_path_accepts(value, expected):
    assert validate_relative_path(value) == expected


def test_validate_relative_path_empty_handling():
    assert validate_relative_path("", allow_empty=True) == ""
    with pytest.raises(UnsafePathError):
        validate_relative_path("")
    with pytest.raises(UnsafePathError):
        validate_relative_path(None)  # type: ignore[arg-type]
    with pytest.raises(UnsafePathError):
        validate_relative_path(["a"])  # type: ignore[arg-type]


UNSAFE_SEGMENTS = [
    s for s in UNSAFE_RELATIVE
] + ["a/b", "a\\b", "x.safetensors/"]


@pytest.mark.parametrize("value", UNSAFE_SEGMENTS)
def test_validate_path_segment_rejects(value):
    with pytest.raises(UnsafePathError):
        validate_path_segment(value)


@pytest.mark.parametrize(
    "value",
    ["model.safetensors", "犬 v2.safetensors", "…model.safetensors", "a b", "COM10.bin", "x%2Fy"],
)
def test_validate_path_segment_accepts(value):
    assert validate_path_segment(value) == value


# --- containment --------------------------------------------------------


@pytest.mark.parametrize(
    "root, path, expected",
    [
        ("C:\\models\\loras", "C:\\models\\loras", True),
        ("C:\\models\\loras", "C:\\models\\loras\\a\\b.safetensors", True),
        ("C:\\models\\loras", "c:\\MODELS\\Loras\\x", True),
        ("C:/models/loras", "C:\\models\\loras\\x", True),
        ("C:\\models\\loras", "C:\\models\\loras_evil\\x", False),
        ("C:\\models\\loras", "C:\\models\\lora", False),
        ("C:\\models\\loras", "C:\\models\\loras\\..\\x", False),
        ("C:\\models\\loras", "D:\\models\\loras\\x", False),
        ("C:\\", "C:\\anything\\x", True),
        ("C:\\", "D:\\x", False),
        ("\\\\nas\\share\\loras", "\\\\nas\\share\\loras\\x", True),
        ("\\\\nas\\share\\loras", "\\\\nas\\other\\loras\\x", False),
        ("C:\\models\\loras", "\\\\?\\C:\\models\\loras\\x", False),
        ("", "C:\\x", False),
        ("C:\\models", "", False),
    ],
)
def test_is_within_windows_semantics(root, path, expected):
    assert _is_within_ntpath(root, path) is expected


@pytest.mark.parametrize(
    "root, path, expected",
    [
        ("/models/loras", "/models/loras", True),
        ("/models/loras", "/models/loras/a/b", True),
        ("/models/loras/", "/models/loras/a", True),
        ("/models/loras", "/models/loras_evil/x", False),
        ("/models/loras", "/models/loras/../x", False),
        ("/", "/etc/passwd", True),
        ("/models/loras", "/MODELS/loras/x", False),
    ],
)
def test_is_within_posix_semantics(root, path, expected):
    assert _is_within_posixpath(root, path) is expected


def test_is_within_native(tmp_path):
    root = tmp_path / "loras"
    root.mkdir()
    assert is_within(str(root), str(root / "a" / "b.safetensors"))
    assert not is_within(str(root), str(tmp_path / "loras_evil" / "x"))
    assert not is_within(str(root), str(root) + "\x00")
    assert not is_within(None, str(root))  # type: ignore[arg-type]


@pytest.mark.skipif(os.name != "nt", reason="Windows case folding")
def test_is_within_native_case_insensitive_on_windows(tmp_path):
    root = tmp_path / "Loras"
    root.mkdir()
    assert is_within(str(root).lower(), str(root).upper() + "\\x")


@pytest.mark.requires_symlinks
def test_is_within_resolve_follows_links(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    link = root / "link"
    link.symlink_to(outside, target_is_directory=True)

    assert is_within(str(root), str(link / "x"))
    assert not is_within(str(root), str(link / "x"), resolve=True)


@pytest.mark.skipif(os.name != "nt", reason="junctions are Windows only")
def test_is_within_resolve_follows_junction(tmp_path):
    import subprocess

    root = tmp_path / "root"
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    junction = root / "junction"
    result = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(junction), str(outside)],
        capture_output=True,
    )
    if result.returncode != 0:
        pytest.skip("cannot create junction")
    assert is_within(str(root), str(junction / "x"))
    assert not is_within(str(root), str(junction / "x"), resolve=True)


def test_safe_join(tmp_path):
    root = str(tmp_path)
    assert safe_join(root, "a/b") == os.path.join(root, "a", "b")
    assert safe_join(root, "a\\b") == os.path.join(root, "a", "b")
    assert safe_join(root, "") == root
    for bad in ["/abs", "\\abs", "C:evil", "..", "a/../../x", "\\\\srv\\s\\x"]:
        with pytest.raises(UnsafePathError):
            safe_join(root, bad)


def test_require_within_any(tmp_path):
    root = str(tmp_path / "loras")
    require_within_any(os.path.join(root, "x.safetensors"), [root], label="File path")
    with pytest.raises(UnsafePathError, match="outside configured library"):
        require_within_any(str(tmp_path / "other" / "x"), [root], label="File path")
    with pytest.raises(UnsafePathError, match="no library directories"):
        require_within_any(os.path.join(root, "x"), [], label="File path")
    with pytest.raises(UnsafePathError):
        require_within_any(os.path.join(root, "x"), None)
    require_within_any(os.path.join(root, "x"), [], allow_empty_roots=True)
    with pytest.raises(UnsafePathError):
        require_within_any("", [root])
    with pytest.raises(UnsafePathError):
        require_within_any(str(tmp_path / "loras_evil" / "x"), [root])


@pytest.mark.parametrize(
    "value",
    [
        "\\\\srv\\share\\x.json",
        "//srv/share/x.json",
        "\\\\?\\C:\\x",
        "\\\\.\\NUL",
        "\\/srv/share",
        "C:\\models\\NUL",
        "C:\\models\\con.txt",
        "x\x00y",
        "",
    ],
)
def test_reject_unc_or_device_rejects(value):
    with pytest.raises(UnsafePathError):
        reject_unc_or_device(value)


@pytest.mark.parametrize(
    "value",
    ["C:\\models\\loras\\a.safetensors", "/home/u/models/a.safetensors", "relative/x"],
)
def test_reject_unc_or_device_accepts(value):
    assert reject_unc_or_device(value) == value
