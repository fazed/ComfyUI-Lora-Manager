"""Short-lived, opt-in cache for CivitAI model/version lookups.

Queueing several versions of one model (browser extension, batch download)
resolves every item through ``get_model_version`` at ``queue/add`` time, and
the download worker resolves it again when the item starts. Every CivitAI
request passes the shared per-host pacing gate, so without a cache N versions
of one model cost ~4N gated requests.

The cache is **opt-in per call site**: it is only consulted inside a
:func:`civitai_lookup_cache` block. The download paths enable it; every other
caller (metadata refresh, relink, update checks) keeps reading fresh data.

Rules:

* entries live :data:`LOOKUP_CACHE_TTL_SECONDS` and the cache is LRU-bounded;
* only successful (non-``None``) results are stored, exceptions never are;
* simultaneous lookups of one key share a single in-flight fetch;
* callers always receive a deep copy, so mutating a result never leaks into
  the cache or into another caller's result.
"""

from __future__ import annotations

import asyncio
import contextlib
import copy
import time
from collections import OrderedDict
from contextvars import ContextVar
from typing import Any, Awaitable, Callable, Dict, Hashable, Iterator, Optional, Tuple

# Long enough to cover "add N versions, then the worker starts them", short
# enough that nothing user-visible depends on the cached copy.
LOOKUP_CACHE_TTL_SECONDS = 60.0
# Model payloads (``/models/{id}``) can be large; keep only a few.
MODEL_LOOKUP_CACHE_MAX_ENTRIES = 16
VERSION_LOOKUP_CACHE_MAX_ENTRIES = 128

_cache_enabled: ContextVar[bool] = ContextVar("civitai_lookup_cache_enabled", default=False)


@contextlib.contextmanager
def civitai_lookup_cache() -> Iterator[None]:
    """Let CivitAI model/version lookups inside this block use the cache."""

    token = _cache_enabled.set(True)
    try:
        yield
    finally:
        _cache_enabled.reset(token)


def lookup_cache_enabled() -> bool:
    return _cache_enabled.get()


class TTLLookupCache:
    """Bounded TTL cache with in-flight request coalescing."""

    def __init__(
        self,
        *,
        ttl_seconds: float = LOOKUP_CACHE_TTL_SECONDS,
        max_entries: int = VERSION_LOOKUP_CACHE_MAX_ENTRIES,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl = ttl_seconds
        self._max_entries = max(1, max_entries)
        self._clock = clock
        self._entries: "OrderedDict[Hashable, Tuple[float, Any]]" = OrderedDict()
        self._inflight: Dict[Hashable, "asyncio.Task[Any]"] = {}

    def __len__(self) -> int:
        return len(self._entries)

    def clear(self) -> None:
        self._entries.clear()

    def peek(self, key: Hashable) -> Optional[Any]:
        """Return a copy of a fresh entry, or ``None``. Never fetches."""

        entry = self._entries.get(key)
        if entry is None:
            return None
        stored_at, value = entry
        if self._clock() - stored_at >= self._ttl:
            self._entries.pop(key, None)
            return None
        self._entries.move_to_end(key)
        return copy.deepcopy(value)

    def store(self, key: Hashable, value: Any) -> None:
        if value is None:
            return
        self._entries[key] = (self._clock(), copy.deepcopy(value))
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    async def get_or_fetch(
        self, key: Hashable, fetch: Callable[[], Awaitable[Any]]
    ) -> Any:
        cached = self.peek(key)
        if cached is not None:
            return cached

        task = self._inflight.get(key)
        if task is None:
            task = asyncio.ensure_future(self._run(key, fetch))
            # Retrieve the outcome even if every waiter was cancelled, so an
            # exception never surfaces as "Task exception was never retrieved".
            task.add_done_callback(_consume_task_outcome)
            self._inflight[key] = task

        # shield: one cancelled caller must not cancel the fetch the others
        # are waiting on.
        value = await asyncio.shield(task)
        return copy.deepcopy(value)

    async def _run(self, key: Hashable, fetch: Callable[[], Awaitable[Any]]) -> Any:
        try:
            value = await fetch()
            self.store(key, value)
            return value
        finally:
            self._inflight.pop(key, None)


def _consume_task_outcome(task: "asyncio.Task[Any]") -> None:
    if not task.cancelled():
        task.exception()


__all__ = [
    "LOOKUP_CACHE_TTL_SECONDS",
    "MODEL_LOOKUP_CACHE_MAX_ENTRIES",
    "VERSION_LOOKUP_CACHE_MAX_ENTRIES",
    "TTLLookupCache",
    "civitai_lookup_cache",
    "lookup_cache_enabled",
]
