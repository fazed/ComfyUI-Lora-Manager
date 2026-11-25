"""Phase B1 (finding #9): UNC/device paths on GET routes never reach the OS.

``/api/lm/previews?path=\\\\host\\share\\x`` used to run ``Path.resolve()``
(and the deep-symlink walk) before the root check, which on Windows opens an
SMB connection and sends NTLM credentials to that host. A UNC/device path is
now decided as a string: refused, unless it lies lexically under a preview
root that is itself a UNC share (a library on a NAS), and never resolved
first.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from py import config as config_module

UNC_PAYLOADS = [
    "\\\\attacker\\share\\x.png",
    "//attacker/share/x.png",
    "\\\\?\\UNC\\attacker\\share\\x.png",
    "\\\\.\\pipe\\x",
    "\\\\?\\C:\\Windows\\win.ini",
    "/\\attacker\\share\\x.png",
]


def _make_config(roots):
    cfg = config_module.Config.__new__(config_module.Config)
    cfg._path_mappings = {}
    cfg._preview_root_paths = {Path(root) for root in roots}
    return cfg


@pytest.fixture
def no_filesystem(monkeypatch):
    calls: list[str] = []

    def _boom(name):
        def _inner(*_args, **_kwargs):
            calls.append(name)
            raise AssertionError(f"filesystem call: {name}")

        return _inner

    monkeypatch.setattr(Path, "resolve", _boom("Path.resolve"))
    monkeypatch.setattr(Path, "expanduser", _boom("Path.expanduser"))
    monkeypatch.setattr(os.path, "realpath", _boom("os.path.realpath"))
    monkeypatch.setattr(os.path, "islink", _boom("os.path.islink"))
    monkeypatch.setattr(os.path, "exists", _boom("os.path.exists"))
    monkeypatch.setattr(os.path, "isfile", _boom("os.path.isfile"))
    # os.stat/lstat are left alone: pytest needs them to report a failure.
    monkeypatch.setattr(config_module.Config, "_is_link", _boom("Config._is_link"), raising=False)
    return calls


@pytest.mark.parametrize("payload", UNC_PAYLOADS)
def test_unc_preview_path_is_refused_without_filesystem_calls(tmp_path, payload, no_filesystem):
    cfg = _make_config([str(tmp_path / "loras")])

    assert cfg.is_preview_path_allowed(payload) is False
    assert no_filesystem == []


@pytest.mark.parametrize("payload", ["x\x00y.png", "C:\\a\x01.png"])
def test_control_characters_are_refused_without_filesystem_calls(payload, no_filesystem):
    cfg = _make_config(["C:\\models"])

    assert cfg.is_preview_path_allowed(payload) is False
    assert no_filesystem == []


def test_unc_preview_path_under_a_unc_library_root_is_allowed_lexically(no_filesystem):
    cfg = _make_config(["\\\\nas\\models\\loras"])

    assert cfg.is_preview_path_allowed("\\\\nas\\models\\loras\\a\\x.png") is True
    assert cfg.is_preview_path_allowed("//nas/models/loras/a/x.png") is True
    assert cfg.is_preview_path_allowed("\\\\nas\\models\\loras_old\\x.png") is False
    assert cfg.is_preview_path_allowed("\\\\nas\\models\\loras\\..\\..\\x.png") is False
    assert cfg.is_preview_path_allowed("\\\\other\\models\\loras\\x.png") is False
    assert no_filesystem == []


def test_local_preview_paths_still_resolve_against_roots(tmp_path):
    root = tmp_path / "loras"
    (root / "a").mkdir(parents=True)
    image = root / "a" / "x.png"
    image.write_bytes(b"x")
    cfg = _make_config([str(root)])

    assert cfg.is_preview_path_allowed(str(image)) is True
    assert cfg.is_preview_path_allowed(str(image).replace("\\", "/")) is True
    assert cfg.is_preview_path_allowed(str(tmp_path / "loras_old" / "x.png")) is False
    assert cfg.is_preview_path_allowed(str(root / ".." / "x.png")) is False


@pytest.mark.skipif(os.name != "nt", reason="drive roots are a Windows layout")
def test_a_drive_root_library_contains_its_files(tmp_path):
    # The old "root + os.sep" prefix check never matched a drive root.
    anchor = Path(tmp_path).anchor
    cfg = _make_config([anchor])
    assert cfg._is_path_in_allowed_roots(anchor + "lm-test-nonexistent\\x.png") is True


# ---------------------------------------------------------------------------
# send-image local path (_resolve_allowed_local_path)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("payload", UNC_PAYLOADS)
def test_send_image_local_path_refuses_unc_without_filesystem_calls(
    monkeypatch, payload, no_filesystem
):
    from py.routes.handlers import misc_handlers

    handler = misc_handlers.NodeRegistryHandler.__new__(misc_handlers.NodeRegistryHandler)
    monkeypatch.setattr(misc_handlers, "config", _make_config(["C:\\models"]))
    monkeypatch.setattr(
        misc_handlers.NodeRegistryHandler,
        "_input_directory",
        staticmethod(lambda: (_ for _ in ()).throw(AssertionError("input dir looked up"))),
    )

    with pytest.raises(ValueError):
        handler._resolve_allowed_local_path(payload)
    assert no_filesystem == []


def test_send_image_local_path_still_accepts_the_input_directory(monkeypatch, tmp_path):
    from py.routes.handlers import misc_handlers

    input_dir = tmp_path / "input"
    input_dir.mkdir()
    image = input_dir / "a.png"
    image.write_bytes(b"x")
    handler = misc_handlers.NodeRegistryHandler.__new__(misc_handlers.NodeRegistryHandler)
    monkeypatch.setattr(
        misc_handlers.NodeRegistryHandler,
        "_input_directory",
        staticmethod(lambda: os.path.realpath(str(input_dir))),
    )

    assert handler._resolve_allowed_local_path(str(image)) == os.path.realpath(str(image))
    with pytest.raises(ValueError):
        handler._resolve_allowed_local_path(str(tmp_path / "input_old" / "a.png"))
