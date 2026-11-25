"""Replace an older version of a model after its newer version downloaded.

Fork-only. The modern UI's "Replace it" choice on an update sends the old
file(s) with ``downloads/queue/add`` (``replace_file_path``, repeatable). The
paths are validated when the item is queued (:func:`validate_replace_targets`)
and stored on the queue row as ``replace_targets`` (JSON) with
``replace_status = 'pending'``. When the download finished, the queue worker
calls :func:`run_replace_for_download`, which re-verifies everything and only
then stages the old file for deletion through the SAME service as the
user-facing delete (``ModelLifecycleService.delete_model`` ->
``PendingDeleteService``), with a longer undo window and without the hard
delete fallback.

Safety rules (all of them must hold, otherwise the old file is kept and the
reason is recorded on the history row; nothing else is ever touched):

At queue time (HTTP 400 with a ``code``, nothing queued):
* the path is a plain absolute path (no ``..`` segment, no drive-relative
  ``C:x``, no control characters) inside the library roots of the scanner
  whose cache holds it, is a regular file and not a symlink;
* the scanner cache (lora / checkpoint / embedding) knows the file, its
  Civitai ``modelId`` equals the ``model_id`` being downloaded and its
  version id differs from the new ``model_version_id``;
* its version is not itself in the queue, and no queued item already wants
  to replace the same file.

At completion time (per target):
* the download finished as ``completed`` (not failed, canceled, skipped or
  paused) - enforced by the compare-and-set claim on the history row;
* the scanner now owns the new version (same model id + version id) through
  at least one file that exists, is larger than zero bytes and is not the
  old file;
* the old file is still inside the roots, still a regular non-symlink file,
  still in the scanner cache and still maps to the same model and to the
  version recorded at queue time.

A failure never fails or rolls back the download; a missing old file is
recorded as ``already_gone``. The claim makes the whole thing run at most
once per download (a retry, a second hook or a restart never runs it again;
a restart marks an unfinished replace ``interrupted`` and deletes nothing).
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, Optional, Sequence

from ..utils.safe_paths import UnsafePathError, is_absolute_like, require_within_any

logger = logging.getLogger(__name__)

# Undo window of a background replace. The user-facing delete keeps its
# 20 s window (a toast with Undo is on screen). A replace happens whenever a
# download finishes, usually while nobody is looking, so 20 s would make
# its undo meaningless; ten minutes keeps the staged copy restorable from
# the Downloads / Updates page for a while, then the normal purge runs.
REPLACE_UNDO_TTL_SECONDS = 600
MAX_REPLACE_TARGETS = 8
REPLACE_MODEL_TYPES = ("lora", "checkpoint", "embedding")

# Error codes returned by queue/add (400).
CODE_REQUIRES_VERSION = "replace_requires_version"
CODE_TOO_MANY = "replace_too_many"
CODE_INVALID_PATH = "replace_path_invalid"
CODE_OUTSIDE_ROOTS = "replace_path_outside_roots"
CODE_NOT_IN_LIBRARY = "replace_not_in_library"
CODE_MODEL_MISMATCH = "replace_model_mismatch"
CODE_SAME_VERSION = "replace_same_version"
CODE_TARGET_QUEUED = "replace_target_queued"
CODE_TARGET_PENDING = "replace_target_pending"

# Per-target outcomes recorded on the history row.
STATUS_REPLACED = "replaced"
STATUS_KEPT = "kept"
STATUS_ALREADY_GONE = "already_gone"

ScannerMap = Dict[str, Any]
ScannerProvider = Callable[[], Awaitable[ScannerMap]]
LifecycleFactory = Callable[[Any], Awaitable[Any]]


class ReplaceValidationError(ValueError):
    """A ``replace_file_path`` that must not be accepted."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _norm(path: str) -> str:
    return os.path.normcase(os.path.abspath(path))


def _to_int(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def entry_ids(entry: Any) -> tuple[Optional[int], Optional[int]]:
    """Civitai ``(modelId, versionId)`` of a scanner cache entry."""
    if not isinstance(entry, Mapping):
        return None, None
    civitai = entry.get("civitai")
    if not isinstance(civitai, Mapping):
        return None, None
    return _to_int(civitai.get("modelId")), _to_int(civitai.get("id"))


def check_path_shape(raw: Any) -> str:
    """Reject anything that is not a plain absolute path (string checks only).

    Runs before any filesystem access, so a hostile value (UNC host, device
    path, ``..``, drive-relative ``C:x``) never reaches ``stat``.
    """
    if not isinstance(raw, str) or not raw.strip():
        raise ReplaceValidationError(CODE_INVALID_PATH, "replace_file_path is empty")
    path = raw.strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in path):
        raise ReplaceValidationError(CODE_INVALID_PATH, "replace_file_path contains control characters")
    if not is_absolute_like(path):
        raise ReplaceValidationError(CODE_INVALID_PATH, "replace_file_path must be an absolute path")
    segments = path.replace("\\", "/").split("/")
    if any(segment in ("..", ".") for segment in segments):
        raise ReplaceValidationError(CODE_INVALID_PATH, "replace_file_path must not contain '.' or '..' segments")
    return path


def _model_roots(scanner: Any) -> List[str]:
    getter = getattr(scanner, "get_model_roots", None)
    if not callable(getter):
        return []
    try:
        return [root for root in (getter() or []) if isinstance(root, str) and root]
    except NotImplementedError:
        return []


async def _cache_items(scanner: Any) -> List[Mapping[str, Any]]:
    cache = await scanner.get_cached_data()
    return [item for item in (getattr(cache, "raw_data", None) or []) if isinstance(item, Mapping)]


def _find_entry(items: Iterable[Mapping[str, Any]], path: str) -> Optional[Mapping[str, Any]]:
    wanted = _norm(path)
    for item in items:
        file_path = item.get("file_path")
        if isinstance(file_path, str) and file_path and _norm(file_path) == wanted:
            return item
    return None


def _is_regular_file(path: str) -> bool:
    return os.path.isfile(path) and not os.path.islink(path)


def _parse_targets(raw: Any) -> List[Dict[str, Any]]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    if not isinstance(raw, list):
        return []
    return [dict(item) for item in raw if isinstance(item, Mapping) and isinstance(item.get("path"), str)]


def _queued_paths(queue_rows: Sequence[Mapping[str, Any]]) -> set[str]:
    paths: set[str] = set()
    for row in queue_rows:
        for target in _parse_targets(row.get("replace_targets")):
            paths.add(_norm(target["path"]))
    return paths


# ---------------------------------------------------------------------------
# Services (overridable in tests)
# ---------------------------------------------------------------------------


async def default_scanners() -> ScannerMap:
    """lora / checkpoint / embedding scanners from the service registry."""
    from .service_registry import ServiceRegistry

    getters = {
        "lora": ServiceRegistry.get_lora_scanner,
        "checkpoint": ServiceRegistry.get_checkpoint_scanner,
        "embedding": ServiceRegistry.get_embedding_scanner,
    }
    scanners: ScannerMap = {}
    for model_type, getter in getters.items():
        try:
            scanner = await getter()
        except Exception:  # pragma: no cover - defensive
            logger.debug("Replace: %s scanner unavailable", model_type, exc_info=True)
            continue
        if scanner is not None:
            scanners[model_type] = scanner
    return scanners


async def default_lifecycle_factory(scanner: Any) -> Any:
    """The same lifecycle service the delete route uses, for one scanner."""
    from .model_lifecycle_service import ModelLifecycleService, load_local_metadata
    from .service_registry import ServiceRegistry
    from ..utils.metadata_manager import MetadataManager

    update_service = None
    try:
        update_service = await ServiceRegistry.get_model_update_service()
    except Exception:  # pragma: no cover - defensive
        update_service = None
    return ModelLifecycleService(
        scanner=scanner,
        metadata_manager=MetadataManager,
        metadata_loader=load_local_metadata,
        recipe_scanner_factory=ServiceRegistry.get_recipe_scanner,
        update_service=update_service,
    )


# ---------------------------------------------------------------------------
# Queue time
# ---------------------------------------------------------------------------


async def validate_replace_targets(
    raw_paths: Sequence[Any],
    *,
    model_id: Optional[int],
    model_version_id: Optional[int],
    queue_rows: Sequence[Mapping[str, Any]],
    scanners: ScannerMap,
) -> List[Dict[str, Any]]:
    """Validate ``replace_file_path`` values of ``queue/add``.

    Returns the targets to store on the queue row (canonical cache spelling
    of the path plus what the UI shows), or raises
    :class:`ReplaceValidationError`. Never touches a file.
    """
    values = [value for value in raw_paths if isinstance(value, str) and value.strip()]
    if not values:
        return []
    if model_id is None or model_version_id is None:
        raise ReplaceValidationError(
            CODE_REQUIRES_VERSION,
            "Replacing needs the model id and the version id of the new download",
        )

    unique: List[str] = []
    seen: set[str] = set()
    for value in values:
        path = check_path_shape(value)
        key = _norm(path)
        if key not in seen:
            seen.add(key)
            unique.append(path)
    if len(unique) > MAX_REPLACE_TARGETS:
        raise ReplaceValidationError(CODE_TOO_MANY, f"At most {MAX_REPLACE_TARGETS} files can be replaced at once")

    queued_versions = {
        _to_int(row.get("model_version_id"))
        for row in queue_rows
        if _to_int(row.get("model_version_id")) is not None
    }
    pending_paths = _queued_paths(queue_rows)

    all_roots: List[str] = []
    for model_type in REPLACE_MODEL_TYPES:
        scanner = scanners.get(model_type)
        if scanner is not None:
            all_roots.extend(_model_roots(scanner))

    items_by_type: Dict[str, List[Mapping[str, Any]]] = {}
    targets: List[Dict[str, Any]] = []
    for path in unique:
        # String check against every library root first (no file access).
        try:
            require_within_any(path, all_roots, label="replace_file_path")
        except UnsafePathError as exc:
            raise ReplaceValidationError(CODE_OUTSIDE_ROOTS, str(exc)) from exc
        located: Optional[tuple[str, Any, Mapping[str, Any]]] = None
        for model_type in REPLACE_MODEL_TYPES:
            scanner = scanners.get(model_type)
            if scanner is None:
                continue
            if model_type not in items_by_type:
                items_by_type[model_type] = await _cache_items(scanner)
            entry = _find_entry(items_by_type[model_type], path)
            if entry is not None:
                located = (model_type, scanner, entry)
                break
        if located is None:
            raise ReplaceValidationError(CODE_NOT_IN_LIBRARY, "The file to replace is not in the library")
        model_type, scanner, entry = located
        cache_path = str(entry.get("file_path"))
        try:
            require_within_any(cache_path, _model_roots(scanner), label="replace_file_path")
            require_within_any(path, _model_roots(scanner), label="replace_file_path")
        except UnsafePathError as exc:
            raise ReplaceValidationError(CODE_OUTSIDE_ROOTS, str(exc)) from exc
        if os.path.islink(cache_path):
            raise ReplaceValidationError(CODE_INVALID_PATH, "The file to replace is a symbolic link")
        if not _is_regular_file(cache_path):
            raise ReplaceValidationError(CODE_NOT_IN_LIBRARY, "The file to replace does not exist")

        old_model_id, old_version_id = entry_ids(entry)
        if old_model_id is None or old_model_id != model_id:
            raise ReplaceValidationError(
                CODE_MODEL_MISMATCH, "Only another version of the same Civitai model can be replaced"
            )
        if old_version_id is None or old_version_id == model_version_id:
            raise ReplaceValidationError(
                CODE_SAME_VERSION, "The file to replace is the version being downloaded"
            )
        if old_version_id in queued_versions:
            raise ReplaceValidationError(
                CODE_TARGET_QUEUED, "The version to replace is itself in the download queue"
            )
        if _norm(cache_path) in pending_paths:
            raise ReplaceValidationError(
                CODE_TARGET_PENDING, "Another queued download already replaces this file"
            )

        civitai = entry.get("civitai") if isinstance(entry.get("civitai"), Mapping) else {}
        targets.append(
            {
                "path": cache_path,
                "file_name": os.path.basename(cache_path),
                "model_type": model_type,
                "version_id": old_version_id,
                "version_name": civitai.get("name") if isinstance(civitai.get("name"), str) else None,
                "size": _to_int(entry.get("size")),
            }
        )
    return targets


# ---------------------------------------------------------------------------
# Completion time
# ---------------------------------------------------------------------------


def _kept(target: Dict[str, Any], note: str) -> Dict[str, Any]:
    return {**target, "status": STATUS_KEPT, "note": note}


async def _replace_one(
    target: Dict[str, Any],
    *,
    model_id: Optional[int],
    model_version_id: Optional[int],
    new_download_path: Optional[str],
    scanners: ScannerMap,
    lifecycle_factory: LifecycleFactory,
    ttl_seconds: int,
    clock: Callable[[], float],
) -> Dict[str, Any]:
    path = target.get("path")
    model_type = target.get("model_type")
    scanner = scanners.get(model_type) if isinstance(model_type, str) else None
    if scanner is None:
        return _kept(target, "scanner_unavailable")
    if model_id is None or model_version_id is None:
        return _kept(target, "new_version_unknown")
    try:
        path = check_path_shape(path)
        require_within_any(path, _model_roots(scanner), label="replace_file_path")
    except (ReplaceValidationError, UnsafePathError):
        return _kept(target, "unsafe_path")

    items = await _cache_items(scanner)

    # The new version must now be owned, by a real file that is not the old one.
    old_key = _norm(path)
    new_ok = False
    for item in items:
        if entry_ids(item) != (model_id, model_version_id):
            continue
        file_path = item.get("file_path")
        if not isinstance(file_path, str) or _norm(file_path) == old_key:
            continue
        try:
            if _is_regular_file(file_path) and os.path.getsize(file_path) > 0:
                new_ok = True
                break
        except OSError:
            continue
    if new_download_path and _norm(new_download_path) == old_key:
        new_ok = False
    if not new_ok:
        return _kept(target, "new_file_not_verified")

    if not os.path.lexists(path):
        return {**target, "status": STATUS_ALREADY_GONE, "note": "old_file_missing"}
    entry = _find_entry(items, path)
    if entry is None:
        return _kept(target, "not_in_library")
    if os.path.islink(path) or not _is_regular_file(path):
        return _kept(target, "not_a_regular_file")
    old_model_id, old_version_id = entry_ids(entry)
    if old_model_id != model_id:
        return _kept(target, "model_mismatch")
    if old_version_id is None or old_version_id == model_version_id:
        return _kept(target, "same_version")
    expected = _to_int(target.get("version_id"))
    if expected is not None and old_version_id != expected:
        return _kept(target, "version_changed")

    cache_path = str(entry.get("file_path"))
    try:
        lifecycle = await lifecycle_factory(scanner)
        result = await lifecycle.delete_model(
            cache_path, undo_ttl_seconds=ttl_seconds, allow_hard_delete=False
        )
    except Exception as exc:
        logger.warning("Replace: could not stage %s for deletion: %s", cache_path, exc)
        return _kept(target, f"delete_failed: {exc}"[:300])

    batch_id = result.get("batch_id") if isinstance(result, Mapping) else None
    if not (isinstance(result, Mapping) and result.get("success") and batch_id):
        return _kept(target, "staging_failed")
    return {
        **target,
        "status": STATUS_REPLACED,
        "note": None,
        "batch_id": str(batch_id),
        "undo_until": int(clock()) + int(ttl_seconds),
    }


async def run_replace_for_download(
    download_id: str,
    *,
    queue_service: Any,
    scanners_provider: ScannerProvider = default_scanners,
    lifecycle_factory: LifecycleFactory = default_lifecycle_factory,
    ttl_seconds: int = REPLACE_UNDO_TTL_SECONDS,
    clock: Callable[[], float] = time.time,
) -> Optional[List[Dict[str, Any]]]:
    """Run the pending replace of a completed download (at most once).

    Returns the recorded targets, or ``None`` when nothing was claimed. Never
    raises: every problem becomes a ``kept`` outcome with a note.
    """
    row = await queue_service.claim_replace(download_id)
    if not row:
        return None
    targets = _parse_targets(row.get("replace_targets"))
    model_id = _to_int(row.get("model_id"))
    model_version_id = _to_int(row.get("model_version_id"))
    new_path = row.get("file_path") if isinstance(row.get("file_path"), str) else None

    outcome: List[Dict[str, Any]] = []
    try:
        scanners = await scanners_provider()
        for target in targets:
            try:
                result = await _replace_one(
                    target,
                    model_id=model_id,
                    model_version_id=model_version_id,
                    new_download_path=new_path,
                    scanners=scanners,
                    lifecycle_factory=lifecycle_factory,
                    ttl_seconds=ttl_seconds,
                    clock=clock,
                )
            except Exception as exc:  # defensive: one target never stops the rest
                logger.warning("Replace: target %s failed: %s", target.get("path"), exc, exc_info=True)
                result = _kept(target, f"error: {exc}"[:300])
            outcome.append(result)
            if result.get("status") == STATUS_REPLACED:
                logger.info(
                    "Replace after download %s: staged old file %s for deletion "
                    "(new version %s of model %s; undo batch %s for %ss)",
                    download_id,
                    target.get("path"),
                    model_version_id,
                    model_id,
                    result.get("batch_id"),
                    ttl_seconds,
                )
            else:
                logger.info(
                    "Replace after download %s: kept %s (%s)",
                    download_id,
                    target.get("path"),
                    result.get("note") or result.get("status"),
                )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Replace after download %s failed: %s", download_id, exc, exc_info=True)
    finally:
        recorded = len(outcome)
        for target in targets[recorded:]:
            outcome.append(_kept(target, "not_processed"))
        try:
            await queue_service.finish_replace(download_id, outcome)
        except Exception:  # pragma: no cover - defensive
            logger.warning("Replace: could not record the outcome of %s", download_id, exc_info=True)
    return outcome
