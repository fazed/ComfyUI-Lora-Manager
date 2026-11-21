"""Short-TTL CivitAI lookup cache used by queue/add and the download worker."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from py.services import civitai_client as civitai_client_module
from py.services.civitai_client import CivitaiClient
from py.services.civitai_lookup_cache import (
    LOOKUP_CACHE_TTL_SECONDS,
    TTLLookupCache,
    civitai_lookup_cache,
    lookup_cache_enabled,
)
from py.services.errors import RateLimitError
from py.services.model_metadata_provider import ModelMetadataProviderManager


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


# ----------------------------------------------------------------------
# TTLLookupCache
# ----------------------------------------------------------------------


async def test_hit_within_ttl_and_miss_after_expiry() -> None:
    clock = FakeClock()
    cache = TTLLookupCache(ttl_seconds=60, clock=clock)
    fetch = AsyncMock(side_effect=[{"v": 1}, {"v": 2}])

    assert await cache.get_or_fetch("k", fetch) == {"v": 1}
    clock.now += 59
    assert await cache.get_or_fetch("k", fetch) == {"v": 1}
    assert fetch.await_count == 1

    clock.now += 2
    assert await cache.get_or_fetch("k", fetch) == {"v": 2}
    assert fetch.await_count == 2


async def test_concurrent_lookups_share_one_fetch() -> None:
    cache = TTLLookupCache()
    gate = asyncio.Event()
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        await gate.wait()
        return {"id": 1}

    waiters = [asyncio.ensure_future(cache.get_or_fetch("k", fetch)) for _ in range(5)]
    await asyncio.sleep(0)
    gate.set()
    results = await asyncio.gather(*waiters)

    assert calls == 1
    assert results == [{"id": 1}] * 5
    # Every caller gets its own copy.
    assert len({id(result) for result in results}) == 5


async def test_errors_and_none_are_not_cached() -> None:
    cache = TTLLookupCache()
    failing = AsyncMock(side_effect=RateLimitError("slow down"))
    with pytest.raises(RateLimitError):
        await cache.get_or_fetch("k", failing)
    assert len(cache) == 0

    empty = AsyncMock(return_value=None)
    assert await cache.get_or_fetch("k", empty) is None
    assert len(cache) == 0

    ok = AsyncMock(return_value={"ok": True})
    assert await cache.get_or_fetch("k", ok) == {"ok": True}
    ok.assert_awaited_once()


async def test_concurrent_waiters_all_see_the_error() -> None:
    cache = TTLLookupCache()
    gate = asyncio.Event()

    async def fetch():
        await gate.wait()
        raise RuntimeError("boom")

    waiters = [asyncio.ensure_future(cache.get_or_fetch("k", fetch)) for _ in range(3)]
    await asyncio.sleep(0)
    gate.set()
    results = await asyncio.gather(*waiters, return_exceptions=True)
    assert all(isinstance(result, RuntimeError) for result in results)
    assert len(cache) == 0


async def test_mutating_a_result_does_not_change_the_cache() -> None:
    cache = TTLLookupCache()
    first = await cache.get_or_fetch("k", AsyncMock(return_value={"tags": ["a"]}))
    first["tags"].append("mutated")
    second = await cache.get_or_fetch("k", AsyncMock(return_value={"tags": ["other"]}))
    assert second == {"tags": ["a"]}


async def test_cache_is_lru_bounded() -> None:
    cache = TTLLookupCache(max_entries=2)
    for key in ("a", "b", "c"):
        await cache.get_or_fetch(key, AsyncMock(return_value={"k": key}))
    assert len(cache) == 2
    assert cache.peek("a") is None
    assert cache.peek("c") == {"k": "c"}


def test_cache_is_opt_in_per_block() -> None:
    assert lookup_cache_enabled() is False
    with civitai_lookup_cache():
        assert lookup_cache_enabled() is True
    assert lookup_cache_enabled() is False
    assert LOOKUP_CACHE_TTL_SECONDS == 60.0


# ----------------------------------------------------------------------
# CivitaiClient.get_model_version behind the cache
# ----------------------------------------------------------------------


class CountingDownloader:
    def __init__(self) -> None:
        self.urls: list[str] = []
        self.fail_models = False

    async def make_request(self, method, url, use_auth=True, **kwargs):
        self.urls.append(url)
        await asyncio.sleep(0)
        if "/models/" in url:
            if self.fail_models:
                return False, "Resource not found"
            return True, {
                "id": 1,
                "description": "desc",
                "tags": ["tag"],
                "creator": {"username": "maker"},
                "modelVersions": [{"id": 100}, {"id": 101}, {"id": 102}],
            }
        if "/model-versions/" in url:
            version_id = int(url.rsplit("/", 1)[1])
            return True, {
                "id": version_id,
                "modelId": 1,
                "name": f"v{version_id}",
                "model": {"name": "Model", "type": "LORA"},
                "images": [],
            }
        return False, "unexpected"

    def count(self, fragment: str) -> int:
        return sum(1 for url in self.urls if fragment in url)


@pytest.fixture
def downloader(monkeypatch):
    CivitaiClient._instance = None
    ModelMetadataProviderManager._instance = None
    instance = CountingDownloader()
    monkeypatch.setattr(
        civitai_client_module, "get_downloader", AsyncMock(return_value=instance)
    )
    yield instance
    CivitaiClient._instance = None
    ModelMetadataProviderManager._instance = None


async def test_parallel_adds_for_one_model_make_one_models_call(downloader) -> None:
    client = await CivitaiClient.get_instance()
    with civitai_lookup_cache():
        results = await asyncio.gather(
            *(client.get_model_version(1, version_id) for version_id in (100, 101, 102))
        )

    assert [result["id"] for result in results] == [100, 101, 102]
    assert downloader.count("/models/1") == 1
    assert downloader.count("/model-versions/") == 3
    assert results[0]["model"]["tags"] == ["tag"]


async def test_worker_lookup_reuses_the_add_lookup(downloader) -> None:
    client = await CivitaiClient.get_instance()
    with civitai_lookup_cache():
        added = await client.get_model_version(1, 100)
        added["model"]["name"] = "mutated by caller"
        started = await client.get_model_version(1, 100)

    assert len(downloader.urls) == 2
    assert started["model"]["name"] == "Model"


async def test_version_only_add_is_reused_under_canonical_ids(downloader) -> None:
    client = await CivitaiClient.get_instance()
    with civitai_lookup_cache():
        await client.get_model_version(None, 101)
        calls = len(downloader.urls)
        again = await client.get_model_version(1, 101)

    assert again["id"] == 101
    assert len(downloader.urls) == calls


async def test_lookups_outside_the_block_always_fetch(downloader) -> None:
    """Metadata refresh / relink never see cached data."""
    client = await CivitaiClient.get_instance()
    with civitai_lookup_cache():
        await client.get_model_version(1, 100)
    await client.get_model_version(1, 100)

    assert downloader.count("/models/1") == 2
    assert downloader.count("/model-versions/100") == 2


async def test_failed_model_lookup_is_not_cached(downloader) -> None:
    client = await CivitaiClient.get_instance()
    downloader.fail_models = True
    with civitai_lookup_cache():
        assert await client.get_model_version(1, 100) is None
        downloader.fail_models = False
        result = await client.get_model_version(1, 100)

    assert result is not None and result["id"] == 100
    assert downloader.count("/models/1") == 2
