"""In-memory stale-while-revalidate cache for remote model version lists.

Backs ``GET /api/lm/model-versions-status``. Only the *remote* part of that
response (the CivitAI version list, model name and type) is cached here; the
local parts (``inLibrary`` / ``hasBeenDownloaded``) are recomputed by the
handler on every call, so a finished download shows up immediately.

Policy:

- **Fresh** (age <= ``fresh_ttl``): served from memory, no upstream call.
- **Stale** (age <= ``stale_ttl``): served from memory immediately while a
  single background refresh runs.
- **Expired / missing**: the caller waits for an upstream fetch. Concurrent
  callers for the same model id share one in-flight fetch.
- **Failures are never remembered**: only successful lookups are stored, so
  the next request after a failure goes upstream again. A failed refresh
  still serves a usable stale copy (without recording the failure), except a
  confirmed "not found", which drops the stale copy.
- **Rate-limit cooldown**: while the shared :class:`RateLimitCoordinator`
  reports a CivitAI cooldown, no upstream call is started. Stale data is
  served when available, then the library's update-tracking database, and
  otherwise a ``rate_limited`` failure.
- **Bounded**: at most ``max_entries`` model ids are kept (LRU eviction).
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Optional

from .errors import RateLimitError, ResourceNotFoundError

logger = logging.getLogger(__name__)

DEFAULT_FRESH_TTL_SECONDS = 5 * 60
DEFAULT_STALE_TTL_SECONDS = 60 * 60
DEFAULT_MAX_ENTRIES = 500

# Hosts whose rate-limit cooldown blocks CivitAI version lookups. Mirrors
# ``download_manager.DOWNLOAD_PREFLIGHT_HOSTS``; the API client talks to
# civitai.red, downloads may use civitai.com.
CIVITAI_COOLDOWN_HOSTS = ("civitai.com", "civitai.red")

# Failure kinds surfaced to the handler.
FAILURE_NOT_FOUND = "not_found"
FAILURE_RATE_LIMITED = "rate_limited"
FAILURE_UNAVAILABLE = "unavailable"  # provider returned nothing usable
FAILURE_ERROR = "error"  # unexpected exception

SOURCE_REMOTE = "remote"
SOURCE_LIBRARY = "library"

Payload = Dict[str, Any]
Fetcher = Callable[[], Awaitable[Optional[Payload]]]
CooldownProbe = Callable[[], Awaitable[float]]
LibraryFallback = Callable[[int], Awaitable[Optional[Payload]]]


@dataclass
class VersionsFailure:
    kind: str
    message: str = ""
    retry_after: Optional[float] = None


@dataclass
class VersionsLookup:
    """Result of :meth:`ModelVersionsStatusCache.get`.

    Exactly one of ``payload`` / ``failure`` is set.
    """

    payload: Optional[Payload] = None
    failure: Optional[VersionsFailure] = None
    cached: bool = False
    stale: bool = False
    source: str = SOURCE_REMOTE


@dataclass
class _Entry:
    payload: Payload
    fetched_at: float


def slim_versions_payload(response: Payload) -> Payload:
    """Keep only the fields the versions-status endpoint reads.

    Full CivitAI model payloads carry files, image metadata and descriptions
    for every version; storing those for hundreds of models would waste a
    lot of memory.
    """

    versions = []
    for version in response.get("modelVersions") or []:
        if not isinstance(version, dict):
            continue
        images = version.get("images")
        first_url = None
        if isinstance(images, list) and images and isinstance(images[0], dict):
            first_url = images[0].get("url")
        versions.append(
            {
                "id": version.get("id"),
                "name": version.get("name", ""),
                "images": [{"url": first_url}] if first_url else [],
            }
        )
    return {
        "modelVersions": versions,
        "type": response.get("type", "") or "",
        "name": response.get("name", "") or "",
    }


async def civitai_cooldown_remaining() -> float:
    """Remaining CivitAI cooldown (seconds) from the shared rate limiter."""

    from .rate_limit_coordinator import RateLimitCoordinator

    coordinator = await RateLimitCoordinator.get_instance()
    return max(
        (coordinator.remaining_seconds(host) for host in CIVITAI_COOLDOWN_HOSTS),
        default=0.0,
    )


async def load_versions_from_update_db(model_id: int) -> Optional[Payload]:
    """Build a versions payload from the model-update tracking database.

    That database already stores CivitAI version lists for models in the
    library (it powers ``/updates/versions/{model_id}``). It has no model name
    and stores the normalized model type, so it is only used as a degraded
    fallback when CivitAI cannot be reached.
    """

    from .service_registry import ServiceRegistry

    service = await ServiceRegistry.get_model_update_service()
    # ``get_record`` does not filter by type; the stored type is returned.
    record = await service.get_record("lora", model_id)
    if record is None or not record.versions:
        return None
    return {
        "modelVersions": [
            {
                "id": version.version_id,
                "name": version.name or "",
                "images": [{"url": version.preview_url}] if version.preview_url else [],
            }
            for version in record.versions
        ],
        "type": record.model_type or "",
        "name": "",
    }


class ModelVersionsStatusCache:
    """Per-model-id SWR cache of successful lookups with in-flight dedupe.

    Failures are never cached.
    """

    def __init__(
        self,
        *,
        fresh_ttl: float = DEFAULT_FRESH_TTL_SECONDS,
        stale_ttl: float = DEFAULT_STALE_TTL_SECONDS,
        max_entries: int = DEFAULT_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
        cooldown_probe: Optional[CooldownProbe] = civitai_cooldown_remaining,
        library_fallback: Optional[LibraryFallback] = load_versions_from_update_db,
    ) -> None:
        self._fresh_ttl = max(0.0, float(fresh_ttl))
        self._stale_ttl = max(self._fresh_ttl, float(stale_ttl))
        self._max_entries = max(1, int(max_entries))
        self._clock = clock
        self._cooldown_probe = cooldown_probe
        self._library_fallback = library_fallback
        self._entries: "OrderedDict[int, _Entry]" = OrderedDict()
        self._inflight: Dict[int, "asyncio.Task[Optional[VersionsFailure]]"] = {}

    # ------------------------------------------------------------------
    # Introspection helpers (tests / diagnostics)

    def __len__(self) -> int:
        return len(self._entries)

    def __contains__(self, model_id: object) -> bool:
        return model_id in self._entries

    def clear(self) -> None:
        self._entries.clear()

    def invalidate(self, model_id: int) -> None:
        self._entries.pop(model_id, None)

    async def wait_for_refreshes(self) -> None:
        """Await all in-flight fetches (test seam)."""
        tasks = list(self._inflight.values())
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------------
    # Public API

    async def get(
        self,
        model_id: int,
        fetcher: Fetcher,
        *,
        force_refresh: bool = False,
    ) -> VersionsLookup:
        now = self._clock()
        entry = self._entries.get(model_id)
        if entry is not None:
            self._entries.move_to_end(model_id)

        if entry is not None and now - entry.fetched_at > self._stale_ttl:
            # Too old to serve even as stale.
            self._entries.pop(model_id, None)
            entry = None

        if entry is not None and not force_refresh:
            if now - entry.fetched_at <= self._fresh_ttl:
                return VersionsLookup(payload=entry.payload, cached=True)
            # Stale: serve now, revalidate in the background unless the shared
            # rate-limit cooldown says upstream must not be called.
            if await self._cooldown_remaining() <= 0:
                self._start_fetch(model_id, fetcher)
            return VersionsLookup(payload=entry.payload, cached=True, stale=True)

        cooldown = await self._cooldown_remaining()
        if cooldown > 0:
            if entry is not None:
                return VersionsLookup(payload=entry.payload, cached=True, stale=True)
            failure = VersionsFailure(
                FAILURE_RATE_LIMITED,
                "CivitAI is rate limiting requests; try again later",
                retry_after=cooldown,
            )
            return await self._fallback_or_failure(model_id, failure)

        failure = await asyncio.shield(self._start_fetch(model_id, fetcher))
        entry = self._entries.get(model_id)
        if failure is None and entry is not None:
            return VersionsLookup(payload=entry.payload, cached=False)
        if entry is not None:
            # Refresh failed but a stale copy survived; the failure itself is
            # not remembered.
            return VersionsLookup(payload=entry.payload, cached=True, stale=True)
        return await self._fallback_or_failure(
            model_id, failure or VersionsFailure(FAILURE_UNAVAILABLE, "Model not found")
        )

    # ------------------------------------------------------------------
    # Internals

    async def _cooldown_remaining(self) -> float:
        if self._cooldown_probe is None:
            return 0.0
        try:
            return float(await self._cooldown_probe())
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("Cooldown probe failed: %s", exc)
            return 0.0

    async def _fallback_or_failure(
        self, model_id: int, failure: VersionsFailure
    ) -> VersionsLookup:
        if failure.kind != FAILURE_NOT_FOUND and self._library_fallback is not None:
            try:
                payload = await self._library_fallback(model_id)
            except Exception as exc:
                logger.debug(
                    "Library fallback for model %s failed: %s", model_id, exc
                )
                payload = None
            if payload and payload.get("modelVersions"):
                return VersionsLookup(
                    payload=payload, cached=True, stale=True, source=SOURCE_LIBRARY
                )
        return VersionsLookup(failure=failure, cached=False)

    def _start_fetch(
        self, model_id: int, fetcher: Fetcher
    ) -> "asyncio.Task[Optional[VersionsFailure]]":
        task = self._inflight.get(model_id)
        if task is None:
            task = asyncio.ensure_future(self._run_fetch(model_id, fetcher))
            self._inflight[model_id] = task

            def _done(finished: "asyncio.Task[Any]", key: int = model_id) -> None:
                if self._inflight.get(key) is finished:
                    self._inflight.pop(key, None)

            task.add_done_callback(_done)
        return task

    async def _run_fetch(
        self, model_id: int, fetcher: Fetcher
    ) -> Optional[VersionsFailure]:
        """Fetch upstream and store a successful result. Never raises.

        Failures are returned to the waiting callers but never stored. Only a
        confirmed "not found" touches the cache, by dropping the stale copy.
        """

        try:
            response = await fetcher()
        except ResourceNotFoundError as exc:
            self._entries.pop(model_id, None)
            return VersionsFailure(FAILURE_NOT_FOUND, str(exc) or "Model not found")
        except RateLimitError as exc:
            return VersionsFailure(
                FAILURE_RATE_LIMITED,
                str(exc) or "Rate limited",
                retry_after=exc.retry_after,
            )
        except Exception as exc:
            logger.warning("Model versions lookup for %s failed: %s", model_id, exc)
            return VersionsFailure(FAILURE_ERROR, str(exc) or exc.__class__.__name__)

        if not response or not response.get("modelVersions"):
            # Providers return None for offline, transient, rate-limited and
            # not-found alike. Report a cooldown if one is now armed.
            cooldown = await self._cooldown_remaining()
            if cooldown > 0:
                return VersionsFailure(
                    FAILURE_RATE_LIMITED,
                    "CivitAI is rate limiting requests; try again later",
                    retry_after=cooldown,
                )
            return VersionsFailure(FAILURE_UNAVAILABLE, "Model not found")

        self._store(model_id, _Entry(payload=slim_versions_payload(response),
                                     fetched_at=self._clock()))
        return None

    def _store(self, model_id: int, entry: _Entry) -> None:
        self._entries[model_id] = entry
        self._entries.move_to_end(model_id)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)
