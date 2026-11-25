"""Shared path-safety helpers for request-supplied paths.

Every helper in this module is a pure string check unless ``resolve=True`` is
passed: nothing touches the filesystem, so a hostile value (a UNC path that
would open an SMB connection, a device path, a path with a NUL byte) is
rejected before any ``open``/``stat`` can act on it.

The validators apply Windows *and* POSIX rules on every OS (``ntpath`` plus
``/``), so a value that is harmless on Linux but dangerous on Windows is
still refused, and the Windows cases are tested on Linux CI too:

* ``validate_relative_path`` accepts only a strictly relative path below a
  root: no leading separator, no drive (``C:``, ``\\\\srv\\share``,
  ``\\\\?\\``, ``\\\\.\\``), no ``:`` anywhere (drive-relative paths and NTFS
  alternate data streams), no control characters or ``<>"|?*``, and no
  segment that is empty, ``.``/``..``, ends in a space or dot, or is a
  reserved device name (``CON``, ``NUL``, ``COM1``, ``LPT¹`` ...).
* ``validate_path_segment`` applies the same rules to a single component
  (folder name, file name, decoded download name).
* ``is_within`` / ``safe_join`` / ``require_within_any`` are the containment
  checks: ``abspath`` (or ``realpath``), ``normcase`` and ``commonpath``.
"""

from __future__ import annotations

import ntpath
import os
import posixpath
from typing import Iterable, Optional

__all__ = [
    "UnsafePathError",
    "validate_relative_path",
    "validate_path_segment",
    "is_within",
    "safe_join",
    "require_within_any",
    "reject_unc_or_device",
    "is_unc_or_device",
    "is_absolute_like",
]


class UnsafePathError(ValueError):
    """Raised when a request-supplied path is not safe to use."""


_INVALID_CHARS = frozenset('<>:"|?*')

_RESERVED_NAMES = frozenset(
    ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"]
    + [f"{prefix}{digit}" for prefix in ("COM", "LPT") for digit in "123456789¹²³"]
)


def _has_control_chars(value: str) -> bool:
    return any(ord(char) < 32 or ord(char) == 127 for char in value)


def _is_reserved_name(segment: str) -> bool:
    # Windows ignores everything after the first dot and trailing spaces of
    # the stem: "con.txt", "CON .txt" and "Com1.tar.gz" all open a device.
    stem = segment.split(".", 1)[0].rstrip(" ").upper()
    return stem in _RESERVED_NAMES


def _check_segment(segment: str, original: str) -> None:
    if not segment:
        raise UnsafePathError(f"Path contains an empty segment: {original!r}")
    if segment in (".", ".."):
        raise UnsafePathError(f"Path must not contain '.' or '..': {original!r}")
    if _has_control_chars(segment):
        raise UnsafePathError(f"Path contains control characters: {original!r}")
    if any(char in _INVALID_CHARS for char in segment):
        raise UnsafePathError(f"Path contains invalid characters: {original!r}")
    if segment.rstrip(" .") != segment:
        raise UnsafePathError(
            f"Path segment must not end with a space or dot: {original!r}"
        )
    if _is_reserved_name(segment):
        raise UnsafePathError(f"Path uses a reserved device name: {original!r}")


def validate_relative_path(value: object, *, allow_empty: bool = False) -> str:
    """Return *value* as a normalized ``"a/b"`` relative path or raise.

    ``\\`` and ``/`` are treated alike. A single trailing separator is
    tolerated (``"a/b/"`` -> ``"a/b"``); everything else that is not a plain
    relative path below a root raises :class:`UnsafePathError`.
    """

    if not isinstance(value, str):
        raise UnsafePathError("Path must be a string")
    if value == "":
        if allow_empty:
            return ""
        raise UnsafePathError("Path must not be empty")
    if _has_control_chars(value):
        raise UnsafePathError(f"Path contains control characters: {value!r}")

    unified = value.replace("\\", "/")
    if unified.startswith("/"):
        raise UnsafePathError(f"Path must be relative: {value!r}")
    if ntpath.splitdrive(value)[0] or ntpath.splitdrive(unified)[0]:
        raise UnsafePathError(f"Path must not contain a drive: {value!r}")
    if ":" in unified:
        raise UnsafePathError(f"Path must not contain ':': {value!r}")

    trimmed = unified[:-1] if unified.endswith("/") else unified
    if trimmed == "":
        raise UnsafePathError(f"Path must not be empty: {value!r}")
    segments = trimmed.split("/")
    for segment in segments:
        _check_segment(segment, value)
    return "/".join(segments)


def validate_path_segment(name: object) -> str:
    """Return *name* if it is a single safe path component, else raise."""

    if not isinstance(name, str):
        raise UnsafePathError("Name must be a string")
    if name == "":
        raise UnsafePathError("Name must not be empty")
    if "/" in name or "\\" in name:
        raise UnsafePathError(f"Name must not contain a path separator: {name!r}")
    _check_segment(name, name)
    return name


def _normalize(path: str, pathmod, resolve: bool) -> str:
    if resolve:
        absolute = os.path.realpath(path) if pathmod is os.path else pathmod.realpath(path)
    else:
        absolute = pathmod.abspath(path)
    return pathmod.normcase(absolute)


def _is_within(root: object, path: object, *, pathmod=os.path, resolve: bool = False) -> bool:
    try:
        root_str = os.fspath(root)  # type: ignore[arg-type]
        path_str = os.fspath(path)  # type: ignore[arg-type]
        if not isinstance(root_str, str) or not isinstance(path_str, str):
            return False
        if not root_str or not path_str:
            return False
        if "\x00" in root_str or "\x00" in path_str:
            return False
        normalized_root = _normalize(root_str, pathmod, resolve)
        normalized_path = _normalize(path_str, pathmod, resolve)
        return pathmod.commonpath([normalized_root, normalized_path]) == normalized_root
    except (TypeError, ValueError, OSError):
        return False


def is_within(root: object, path: object, *, resolve: bool = False) -> bool:
    """Return whether *path* is *root* itself or lies below it.

    Uses ``abspath`` (business-path space, symlinks kept) by default or
    ``realpath`` with ``resolve=True``; compares with ``normcase`` so case
    differences on Windows do not matter, and with ``commonpath`` so a
    sibling sharing a prefix (``loras`` vs ``loras_evil``) is not inside.
    Paths on different drives, empty values and values that cannot be
    normalized return ``False``.
    """

    return _is_within(root, path, pathmod=os.path, resolve=resolve)


def safe_join(root: str, relative: object, *, resolve: bool = False) -> str:
    """Join a validated relative path onto *root* and verify containment."""

    normalized = validate_relative_path(relative, allow_empty=True)
    joined = os.path.join(root, *normalized.split("/")) if normalized else root
    if not is_within(root, joined, resolve=resolve):
        raise UnsafePathError(f"Path escapes its root: {relative!r}")
    return joined


def require_within_any(
    path: object,
    roots: Optional[Iterable[object]],
    *,
    label: str = "path",
    allow_empty_roots: bool = False,
) -> None:
    """Raise unless *path* is inside one of *roots*.

    Fails closed when no root is configured unless ``allow_empty_roots`` is
    passed explicitly. The comparison is case-insensitive on Windows and
    never touches the filesystem.
    """

    valid_roots = [root for root in (roots or []) if isinstance(root, str) and root]
    if not valid_roots:
        if allow_empty_roots:
            return
        raise UnsafePathError(
            f"{label} '{path}' cannot be used: no library directories are configured"
        )
    if not isinstance(path, str) or not path:
        raise UnsafePathError(f"{label} is required")
    for root in valid_roots:
        if is_within(root, path):
            return
    raise UnsafePathError(f"{label} '{path}' is outside configured library directories")


def reject_unc_or_device(path: object) -> str:
    """Reject UNC, device-namespace and NUL/control-character paths.

    Call this before any filesystem access on a value from a GET request:
    ``\\\\host\\share`` (also spelled ``//host/share``) makes Windows open an
    SMB connection and leak NTLM credentials, ``\\\\?\\`` / ``\\\\.\\`` reach
    the device namespace, and a reserved name such as ``NUL`` or ``CON``
    opens a device. Returns *path* unchanged when it is acceptable.
    """

    if not isinstance(path, str) or not path:
        raise UnsafePathError("Path is required")
    if _has_control_chars(path):
        raise UnsafePathError(f"Path contains control characters: {path!r}")
    unified = path.replace("/", "\\")
    if unified.startswith("\\\\"):
        raise UnsafePathError(f"UNC and device paths are not allowed: {path!r}")
    _drive, rest = ntpath.splitdrive(unified)
    for segment in rest.split("\\"):
        if segment and segment not in (".", "..") and _is_reserved_name(segment):
            raise UnsafePathError(f"Path uses a reserved device name: {path!r}")
    return path


def is_unc_or_device(path: object) -> bool:
    r"""Return whether *path* is a UNC or device-namespace path (string check).

    ``\\host\share``, ``//host/share``, ``\\?\C:\x`` and
    ``\\.\pipe\x`` (with either separator) are UNC/device paths;
    anything else, including non-strings, is not. Never touches the
    filesystem.
    """

    if not isinstance(path, str):
        return False
    return path.replace("/", "\\").startswith("\\\\")


def is_absolute_like(path: object) -> bool:
    r"""Return whether *path* is meant as an absolute path, on any OS.

    Python 3.13 made ``os.path.isabs('/x')`` return ``False`` on Windows,
    which silently turned rooted business paths into relative ones. This
    helper applies one rule everywhere: a drive path with a root
    (``C:\x``, ``C:/x``), a UNC or device path (``\\srv\share``,
    ``//srv/share``, ``\\?\...``) and a rooted path (``/x``,
    ``\x``) are absolute-like; a drive-relative path (``C:x``), a bare
    name and ``""`` are not. Pure string check.
    """

    if not isinstance(path, str) or not path:
        return False
    if path[0] in ("/", "\\"):
        return True
    drive, rest = ntpath.splitdrive(path)
    if not drive:
        return False
    return rest[:1] in ("/", "\\")


# Exposed for tests that exercise Windows and POSIX semantics on any OS.
def _is_within_ntpath(root: str, path: str) -> bool:
    return _is_within(root, path, pathmod=ntpath)


def _is_within_posixpath(root: str, path: str) -> bool:
    return _is_within(root, path, pathmod=posixpath)
