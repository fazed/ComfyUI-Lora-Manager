"""Tests for the /model-versions-status remote cache (SWR, dedupe, cooldown)."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

from py.routes.handlers.misc_handlers import (
    ModelLibraryHandler,
    ServiceRegistryAdapter,
)
from py.services.errors import RateLimitError, ResourceNotFoundError
from py.services.model_versions_status_cache import (
    FAILURE_NOT_FOUND,
    FAILURE_RATE_LIMITED,
    FAILURE_UNAVAILABLE,
    SOURCE_LIBRARY,
    ModelVersionsStatusCache,
)


def _payload(*version_ids: int, name: str = "Some LoRA", type_: str = "LORA"):
    return {
        "name": name,
        "type": type_,
        "modelVersions": [
            {
                "id": vid,
                "name": f"v{vid}",
                "images": [{"url": f"https://img/{vid}.png", "meta": {"big": "x" * 50}}],
                "files": [{"name": "huge"}],
            }
            for vid in version_ids
        ],
    }


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class CountingFetcher:
    def __init__(self, *results: Any, delay: float = 0.0) -> None:
        self.results = list(results)
        self.calls = 0
        self.delay = delay

    async def __call__(self):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        result = self.results[min(self.calls, len(self.results)) - 1]
        if isinstance(result, BaseException):
            raise result
        return result


class Cooldown:
    def __init__(self) -> None:
        self.remaining = 0.0

    async def __call__(self) -> float:
        return self.remaining


def _cache(clock: FakeClock, cooldown: Optional[Cooldown] = None, **kwargs):
    kwargs.setdefault("library_fallback", None)
    return ModelVersionsStatusCache(
        clock=clock,
        cooldown_probe=cooldown or Cooldown(),
        **kwargs,
    )


async def test_cache_hit_avoids_second_upstream_call():
    clock = FakeClock()
    cache = _cache(clock)
    fetch = CountingFetcher(_payload(1, 2))

    first = await cache.get(5, fetch)
    clock.advance(60)
    second = await cache.get(5, fetch)

    assert fetch.calls == 1
    assert first.cached is False and first.stale is False
    assert second.cached is True and second.stale is False
    assert [v["id"] for v in second.payload["modelVersions"]] == [1, 2]
    # Stored payload is slimmed down to what the endpoint reads.
    assert second.payload["modelVersions"][0] == {
        "id": 1,
        "name": "v1",
        "images": [{"url": "https://img/1.png"}],
    }


async def test_stale_while_revalidate_serves_stale_and_refreshes_in_background():
    clock = FakeClock()
    cache = _cache(clock, fresh_ttl=300, stale_ttl=3600)
    fetch = CountingFetcher(_payload(1), _payload(1, 2), delay=0.01)

    await cache.get(5, fetch)
    clock.advance(301)

    stale = await cache.get(5, fetch)
    assert stale.cached is True and stale.stale is True
    assert [v["id"] for v in stale.payload["modelVersions"]] == [1]

    await cache.wait_for_refreshes()
    assert fetch.calls == 2

    fresh = await cache.get(5, fetch)
    assert fresh.stale is False
    assert [v["id"] for v in fresh.payload["modelVersions"]] == [1, 2]
    assert fetch.calls == 2


async def test_expired_entry_is_fetched_synchronously():
    clock = FakeClock()
    cache = _cache(clock, fresh_ttl=300, stale_ttl=3600)
    fetch = CountingFetcher(_payload(1), _payload(1, 2))

    await cache.get(5, fetch)
    clock.advance(3601)
    result = await cache.get(5, fetch)

    assert fetch.calls == 2
    assert result.cached is False
    assert [v["id"] for v in result.payload["modelVersions"]] == [1, 2]


async def test_failed_refresh_keeps_serving_stale_without_remembering_failure():
    clock = FakeClock()
    cache = _cache(clock, fresh_ttl=300, stale_ttl=3600)
    fetch = CountingFetcher(
        _payload(1),
        RuntimeError("Civitai timeout"),
        RuntimeError("Civitai timeout"),
        RuntimeError("Civitai timeout"),
        _payload(1, 2),
    )

    await cache.get(5, fetch)
    clock.advance(301)
    await cache.get(5, fetch)  # triggers the failing background refresh
    await cache.wait_for_refreshes()
    assert fetch.calls == 2

    # The failure is not remembered: the next stale hit revalidates again.
    result = await cache.get(5, fetch)
    await cache.wait_for_refreshes()
    assert result.stale is True
    assert [v["id"] for v in result.payload["modelVersions"]] == [1]
    assert fetch.calls == 3

    # A forced refresh that fails still falls back to the stale copy.
    forced = await cache.get(5, fetch, force_refresh=True)
    assert forced.stale is True and forced.payload is not None
    assert fetch.calls == 4

    # Next attempt succeeds and replaces the stale copy.
    await cache.get(5, fetch)
    await cache.wait_for_refreshes()
    fresh = await cache.get(5, fetch)
    assert fresh.stale is False
    assert [v["id"] for v in fresh.payload["modelVersions"]] == [1, 2]
    assert fetch.calls == 5


@pytest.mark.parametrize(
    "error",
    [
        None,  # provider returned nothing usable
        RuntimeError("Civitai timeout"),
        ConnectionError("network down"),
        RuntimeError("Civitai returned HTTP 503"),
    ],
)
async def test_failure_is_not_cached_next_call_goes_upstream(error):
    clock = FakeClock()
    cache = _cache(clock)
    fetch = CountingFetcher(error, error)

    first = await cache.get(5, fetch)
    second = await cache.get(5, fetch)

    assert fetch.calls == 2
    assert first.failure is not None and first.cached is False
    assert second.failure is not None and second.cached is False
    assert 5 not in cache


async def test_success_after_failure_is_cached():
    clock = FakeClock()
    cache = _cache(clock)
    fetch = CountingFetcher(None, _payload(1))

    first = await cache.get(5, fetch)
    assert first.failure is not None and first.failure.kind == FAILURE_UNAVAILABLE

    second = await cache.get(5, fetch)
    assert second.payload is not None and second.cached is False

    third = await cache.get(5, fetch)
    assert third.payload is not None and third.cached is True
    assert fetch.calls == 2


async def test_not_found_drops_stale_payload_and_is_reported():
    clock = FakeClock()
    cache = _cache(clock, fresh_ttl=300, stale_ttl=3600)
    fetch = CountingFetcher(_payload(1), ResourceNotFoundError("Civitai model 5 was not found"))

    await cache.get(5, fetch)
    result = await cache.get(5, fetch, force_refresh=True)

    assert result.failure is not None
    assert result.failure.kind == FAILURE_NOT_FOUND
    assert "was not found" in result.failure.message


async def test_concurrent_requests_share_one_upstream_call():
    clock = FakeClock()
    cache = _cache(clock)
    fetch = CountingFetcher(_payload(1, 2), delay=0.05)

    results = await asyncio.gather(*(cache.get(5, fetch) for _ in range(10)))

    assert fetch.calls == 1
    assert all(r.payload is not None for r in results)
    assert all(r.cached is False for r in results)


async def test_cancelled_waiter_does_not_cancel_shared_fetch():
    clock = FakeClock()
    cache = _cache(clock)
    fetch = CountingFetcher(_payload(1), delay=0.05)

    waiter = asyncio.ensure_future(cache.get(5, fetch))
    await asyncio.sleep(0.01)
    waiter.cancel()
    other = await cache.get(5, fetch)

    assert other.payload is not None
    assert fetch.calls == 1


async def test_cooldown_blocks_upstream_without_cache():
    clock = FakeClock()
    cooldown = Cooldown()
    cooldown.remaining = 120.0
    cache = _cache(clock, cooldown)
    fetch = CountingFetcher(_payload(1))

    result = await cache.get(5, fetch)

    assert fetch.calls == 0
    assert result.failure is not None
    assert result.failure.kind == FAILURE_RATE_LIMITED
    assert result.failure.retry_after == 120.0


async def test_cooldown_serves_stale_without_background_refresh():
    clock = FakeClock()
    cooldown = Cooldown()
    cache = _cache(clock, cooldown, fresh_ttl=300, stale_ttl=3600)
    fetch = CountingFetcher(_payload(1), _payload(1, 2))

    await cache.get(5, fetch)
    clock.advance(301)
    cooldown.remaining = 60.0

    result = await cache.get(5, fetch)
    forced = await cache.get(5, fetch, force_refresh=True)
    await cache.wait_for_refreshes()

    assert fetch.calls == 1
    assert result.stale is True and result.payload is not None
    assert forced.stale is True and forced.payload is not None


async def test_rate_limit_error_from_provider_is_not_cached():
    clock = FakeClock()
    cache = _cache(clock)
    fetch = CountingFetcher(
        RateLimitError("Request rate limited", retry_after=45), _payload(1)
    )

    first = await cache.get(5, fetch)
    second = await cache.get(5, fetch)

    assert fetch.calls == 2
    assert first.failure is not None and first.failure.kind == FAILURE_RATE_LIMITED
    assert first.failure.retry_after == 45
    assert first.cached is False
    assert second.payload is not None and second.failure is None


async def test_library_fallback_used_when_upstream_unavailable():
    clock = FakeClock()
    cooldown = Cooldown()
    cooldown.remaining = 300.0
    calls: List[int] = []

    async def library(model_id: int):
        calls.append(model_id)
        return {
            "name": "",
            "type": "lora",
            "modelVersions": [{"id": 7, "name": "v7", "images": []}],
        }

    cache = _cache(clock, cooldown, library_fallback=library)
    fetch = CountingFetcher(_payload(1))

    result = await cache.get(5, fetch)

    assert fetch.calls == 0
    assert calls == [5]
    assert result.source == SOURCE_LIBRARY
    assert result.stale is True
    assert result.payload["modelVersions"][0]["id"] == 7


async def test_lru_bound_evicts_least_recently_used():
    clock = FakeClock()
    cache = _cache(clock, max_entries=3)
    fetch = CountingFetcher(_payload(1))

    for model_id in (1, 2, 3):
        await cache.get(model_id, fetch)
    await cache.get(1, fetch)  # touch 1 -> 2 is now least recently used
    await cache.get(4, fetch)

    assert len(cache) == 3
    assert 2 not in cache
    assert 1 in cache and 3 in cache and 4 in cache


# ---------------------------------------------------------------------------
# Handler integration


class _CountingProvider:
    def __init__(self, payload: Dict[str, Any]) -> None:
        self.payload = payload
        self.calls = 0

    async def get_model_versions(self, _model_id):
        self.calls += 1
        return self.payload


class _MutableScanner:
    def __init__(self) -> None:
        self.local: List[Dict[str, Any]] = []

    async def get_model_versions_by_id(self, _model_id):
        return list(self.local)


class _MutableHistory:
    def __init__(self) -> None:
        self.downloaded: List[int] = []

    async def get_downloaded_version_ids(self, _model_type, _model_id):
        return list(self.downloaded)


def _handler(provider, scanner, history):
    async def scanner_factory():
        return scanner

    async def history_factory():
        return history

    async def provider_factory():
        return provider

    async def none_factory():
        return None

    return ModelLibraryHandler(
        ServiceRegistryAdapter(
            get_lora_scanner=scanner_factory,
            get_checkpoint_scanner=scanner_factory,
            get_embedding_scanner=scanner_factory,
            get_other_scanner=none_factory,
            get_workflow_scanner=none_factory,
            get_downloaded_version_history_service=history_factory,
        ),
        metadata_provider_factory=provider_factory,
        versions_status_cache=ModelVersionsStatusCache(
            cooldown_probe=None, library_fallback=None
        ),
    )


async def _call(handler, model_id: str, **extra):
    response = await handler.get_model_versions_status(
        SimpleNamespace(query={"modelId": model_id, **extra})  # pyright: ignore[reportArgumentType]
    )
    return response, json.loads(response.text)


async def test_handler_cache_hit_recomputes_local_status():
    provider = _CountingProvider(_payload(1, 2))
    scanner = _MutableScanner()
    history = _MutableHistory()
    handler = _handler(provider, scanner, history)

    response, first = await _call(handler, "5")
    assert response.status == 200
    assert first["cached"] is False and first["stale"] is False
    assert first["source"] == "remote"
    assert [v["inLibrary"] for v in first["versions"]] == [False, False]

    # A download finishes: local state changes, remote list does not.
    scanner.local = [{"versionId": 2}]
    history.downloaded = [2]

    response, second = await _call(handler, "5")
    assert response.status == 200
    assert provider.calls == 1
    assert second["cached"] is True
    assert second["versions"] == [
        {
            "id": 1,
            "name": "v1",
            "thumbnailUrl": "https://img/1.png",
            "inLibrary": False,
            "hasBeenDownloaded": False,
        },
        {
            "id": 2,
            "name": "v2",
            "thumbnailUrl": "https://img/2.png",
            "inLibrary": True,
            "hasBeenDownloaded": True,
        },
    ]


async def test_handler_refresh_query_bypasses_fresh_cache():
    provider = _CountingProvider(_payload(1))
    handler = _handler(provider, _MutableScanner(), _MutableHistory())

    await _call(handler, "5")
    _, payload = await _call(handler, "5", refresh="1")

    assert provider.calls == 2
    assert payload["cached"] is False


async def test_handler_rate_limit_without_cache_returns_429():
    class LimitedProvider:
        async def get_model_versions(self, _model_id):
            raise RateLimitError("Request rate limited", retry_after=90)

    handler = _handler(LimitedProvider(), _MutableScanner(), _MutableHistory())

    response, payload = await _call(handler, "5")

    assert response.status == 429
    assert payload["success"] is False
    assert payload["retryAfter"] == 90


async def test_handler_missing_model_keeps_404():
    handler = _handler(_CountingProvider(None), _MutableScanner(), _MutableHistory())  # type: ignore[arg-type]

    response, payload = await _call(handler, "5")

    assert response.status == 404
    assert payload == {"success": False, "error": "Model not found", "cached": False}
