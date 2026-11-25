"""Configured library roots that request-supplied destinations must match."""

from __future__ import annotations

import os
from typing import Iterable, List, Optional

from .safe_paths import UnsafePathError

# Every root list a download dialog can offer: LoRA, checkpoint/unet
# (base_models_roots is their union), embedding, other-model, wildcard and
# workflow roots, plus the extra (LoRA Manager-only) roots.
_DOWNLOAD_ROOT_ATTRS = (
    "loras_roots",
    "extra_loras_roots",
    "checkpoints_roots",
    "unet_roots",
    "base_models_roots",
    "extra_checkpoints_roots",
    "extra_unet_roots",
    "embeddings_roots",
    "extra_embeddings_roots",
    "other_roots",
    "wildcards_roots",
    "workflows_roots",
)


def configured_download_roots(config_obj=None) -> List[str]:
    """Return every configured library root, de-duplicated, in config order."""

    if config_obj is None:
        from ..config import config as config_obj  # lazy: config is heavy

    roots: List[str] = []
    seen: set[str] = set()
    for attr in _DOWNLOAD_ROOT_ATTRS:
        for root in getattr(config_obj, attr, None) or []:
            if not isinstance(root, str) or not root:
                continue
            key = _root_key(root)
            if key in seen:
                continue
            seen.add(key)
            roots.append(root)
    return roots


def _root_key(path: str) -> str:
    return os.path.normcase(os.path.normpath(path))


def match_configured_root(
    value: object, roots: Optional[Iterable[str]] = None, *, label: str = "model_root"
) -> str:
    """Return the configured root equal to *value*, or raise.

    The comparison folds separators, a trailing separator and (on Windows)
    case, so ``d:\\Models\\Loras\\`` matches the configured ``D:/models/loras``.
    The configured spelling is returned. Fails closed when no roots are
    configured. Never touches the filesystem.
    """

    if not isinstance(value, str) or not value.strip():
        raise UnsafePathError(f"{label} is required")
    candidate = value.strip()
    if "\x00" in candidate:
        raise UnsafePathError(f"{label} contains invalid characters")
    available = list(roots) if roots is not None else configured_download_roots()
    if not available:
        raise UnsafePathError(
            f"{label} cannot be used: no library directories are configured"
        )
    key = _root_key(candidate)
    for root in available:
        if root and _root_key(root) == key:
            return root
    raise UnsafePathError(f"{label} is not a configured library root: {candidate}")
