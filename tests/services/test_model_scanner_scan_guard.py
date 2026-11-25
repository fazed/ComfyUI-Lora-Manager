"""Per-scanner guard around library scans (quick reconcile and full rebuild).

Identical scan requests that overlap are coalesced (the later caller awaits the
scan already in flight and gets the same summary, flagged as joined); different
requests (a full rebuild while a quick scan runs, another scope) are serialised.
The scans themselves are faked so no filesystem walk happens.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any, Dict, List, Optional

import pytest

from py.services import model_scanner
from py.services.base_model_service import BaseModelService
from py.services.model_cache import ModelCache
from py.services.model_hash_index import ModelHashIndex
from py.services.model_scanner import ModelScanner, ReconcileScope
from py.utils.models import BaseModelMetadata


@pytest.fixture(autouse=True)
def reset_model_scanner_singletons():
    ModelScanner._instances.clear()
    ModelScanner._locks.clear()
    yield
    ModelScanner._instances.clear()
    ModelScanner._locks.clear()


@pytest.fixture(autouse=True)
def stub_register_service(monkeypatch):
    async def noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(model_scanner.ServiceRegistry, "register_service", noop)


class GatedScanner(ModelScanner):
    """Scanner whose reconcile / rebuild wait on events and record calls."""

    def __init__(self, model_type: str = "guarded"):
        super().__init__(
            model_type=model_type,
            model_class=BaseModelMetadata,
            file_extensions={".txt"},
            hash_index=ModelHashIndex(),
        )
        self._cache = ModelCache(raw_data=[], folders=[])
        self.events: List[str] = []
        self.running = 0
        self.max_running = 0
        self.gate: Optional[asyncio.Event] = None
        self.fail_next = False
        self.reconcile_count = 0

    def get_model_roots(self) -> List[str]:
        return []

    async def _enter(self, name: str) -> None:
        self.running += 1
        self.max_running = max(self.max_running, self.running)
        self.events.append(f"{name}:start")
        try:
            if self.gate is not None:
                await self.gate.wait()
            else:
                await asyncio.sleep(0)
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("boom")
        finally:
            self.running -= 1
            self.events.append(f"{name}:end")

    async def _reconcile_cache(self, scope: Optional[ReconcileScope] = None) -> Optional[Dict[str, Any]]:
        self.reconcile_count += 1
        await self._enter("reconcile")
        return {"added": self.reconcile_count, "removed": 0, "scope": repr(scope)}

    async def _initialize_cache(self) -> None:
        await self._enter("rebuild")


class OtherGatedScanner(GatedScanner):
    """A second model type (its own singleton, its own guard)."""


async def _settle() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_concurrent_quick_scans_run_once_and_share_the_result():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    first = asyncio.create_task(scanner.scan_library())
    await _settle()
    second = asyncio.create_task(scanner.scan_library())
    await _settle()
    assert scanner.is_scanning()

    scanner.gate.set()
    (summary_a, joined_a), (summary_b, joined_b) = await asyncio.gather(first, second)

    assert scanner.reconcile_count == 1
    assert summary_a == summary_b == {"added": 1, "removed": 0, "scope": "None"}
    assert joined_a is False
    assert joined_b is True
    assert scanner.last_reconcile_summary == summary_a
    assert not scanner.is_scanning()


@pytest.mark.asyncio
async def test_scan_after_completion_starts_a_new_scan():
    scanner = GatedScanner()

    summary_a, joined_a = await scanner.scan_library()
    summary_b, joined_b = await scanner.scan_library()

    assert scanner.reconcile_count == 2
    assert summary_a["added"] == 1
    assert summary_b["added"] == 2
    assert joined_a is False and joined_b is False


@pytest.mark.asyncio
async def test_exception_reaches_every_caller_and_releases_the_guard():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()
    scanner.fail_next = True

    first = asyncio.create_task(scanner.scan_library())
    await _settle()
    second = asyncio.create_task(scanner.scan_library())
    await _settle()
    scanner.gate.set()

    results = await asyncio.gather(first, second, return_exceptions=True)
    assert all(isinstance(result, RuntimeError) for result in results)
    assert scanner.reconcile_count == 1

    scanner.gate = None
    summary, joined = await asyncio.wait_for(scanner.scan_library(), timeout=2)
    assert summary["added"] == 2
    assert joined is False
    assert not scanner.is_scanning()


@pytest.mark.asyncio
async def test_cancelled_caller_does_not_abort_the_shared_scan():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    first = asyncio.create_task(scanner.scan_library())
    await _settle()
    second = asyncio.create_task(scanner.scan_library())
    await _settle()

    first.cancel()
    await _settle()
    assert first.cancelled()
    assert scanner.is_scanning()

    scanner.gate.set()
    summary, joined = await asyncio.wait_for(second, timeout=2)
    assert summary["added"] == 1
    assert joined is True
    assert scanner.events == ["reconcile:start", "reconcile:end"]
    await _settle()
    assert not scanner.is_scanning()


@pytest.mark.asyncio
async def test_cancelled_scan_releases_the_guard():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    caller = asyncio.create_task(scanner.scan_library())
    await _settle()
    (inflight,) = list(scanner._scan_inflight.values())
    inflight.cancel()

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(caller, timeout=2)
    await _settle()
    assert not scanner.is_scanning()
    assert scanner.running == 0

    scanner.gate = None
    summary, joined = await asyncio.wait_for(scanner.scan_library(), timeout=2)
    assert summary["added"] == 2
    assert joined is False


@pytest.mark.asyncio
async def test_full_rebuild_waits_for_a_running_quick_scan():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    quick = asyncio.create_task(scanner.scan_library())
    await _settle()
    rebuild = asyncio.create_task(scanner.scan_library(rebuild_cache=True))
    await _settle()

    # The rebuild is queued, not started, while the quick scan runs.
    assert scanner.events == ["reconcile:start"]

    scanner.gate.set()
    quick_result, (rebuild_summary, rebuild_joined) = await asyncio.gather(quick, rebuild)

    assert scanner.events == [
        "reconcile:start",
        "reconcile:end",
        "rebuild:start",
        "rebuild:end",
    ]
    assert scanner.max_running == 1
    assert quick_result[0]["added"] == 1
    assert rebuild_summary is None
    assert rebuild_joined is False


@pytest.mark.asyncio
async def test_quick_scan_waits_for_a_running_full_rebuild_then_reconciles():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    rebuild = asyncio.create_task(scanner.scan_library(rebuild_cache=True))
    await _settle()
    quick = asyncio.create_task(scanner.scan_library())
    await _settle()
    assert scanner.events == ["rebuild:start"]

    scanner.gate.set()
    await asyncio.gather(rebuild, quick)
    assert scanner.events == [
        "rebuild:start",
        "rebuild:end",
        "reconcile:start",
        "reconcile:end",
    ]
    assert scanner.max_running == 1


@pytest.mark.asyncio
async def test_concurrent_full_rebuilds_coalesce():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    first = asyncio.create_task(scanner.get_cached_data(force_refresh=True, rebuild_cache=True))
    await _settle()
    second = asyncio.create_task(scanner.scan_library(rebuild_cache=True))
    await _settle()
    scanner.gate.set()
    await asyncio.gather(first, second)

    assert scanner.events == ["rebuild:start", "rebuild:end"]
    assert second.result() == (None, True)


@pytest.mark.asyncio
async def test_quick_scans_with_different_scopes_are_serialised_not_joined():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    whole = asyncio.create_task(scanner.scan_library())
    await _settle()
    scoped = asyncio.create_task(
        scanner.scan_library(scope=ReconcileScope(roots=("/a",)))
    )
    await _settle()
    assert scanner.events == ["reconcile:start"]

    scanner.gate.set()
    (_, joined_whole), (scoped_summary, joined_scoped) = await asyncio.gather(whole, scoped)
    assert scanner.reconcile_count == 2
    assert scanner.max_running == 1
    assert joined_whole is False and joined_scoped is False
    assert "/a" in scoped_summary["scope"]


@pytest.mark.asyncio
async def test_different_model_types_do_not_block_each_other():
    loras = GatedScanner()
    others = OtherGatedScanner("other-guarded")
    assert loras is not others
    gate = asyncio.Event()
    loras.gate = gate
    others.gate = gate

    first = asyncio.create_task(loras.scan_library())
    second = asyncio.create_task(others.scan_library())
    await _settle()

    # Both scans are running at the same time.
    assert loras.events == ["reconcile:start"]
    assert others.events == ["reconcile:start"]

    gate.set()
    (_, joined_a), (_, joined_b) = await asyncio.gather(first, second)
    assert joined_a is False and joined_b is False


@pytest.mark.asyncio
async def test_force_refresh_goes_through_the_guard():
    """repair-cache and the background reconcile call get_cached_data."""
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    quick = asyncio.create_task(scanner.scan_library())
    await _settle()
    via_cache = asyncio.create_task(scanner.get_cached_data(force_refresh=True))
    await _settle()
    scanner.gate.set()
    await asyncio.gather(quick, via_cache)

    assert scanner.reconcile_count == 1
    assert via_cache.result() is scanner._cache


@pytest.mark.asyncio
async def test_plain_get_cached_data_never_waits_for_a_scan():
    scanner = GatedScanner()
    scanner.gate = asyncio.Event()

    quick = asyncio.create_task(scanner.scan_library())
    await _settle()
    cache = await asyncio.wait_for(scanner.get_cached_data(), timeout=1)
    assert cache is scanner._cache

    scanner.gate.set()
    await quick


@pytest.mark.asyncio
async def test_background_initialization_holds_the_guard(monkeypatch):
    scanner = GatedScanner()
    scanner._cache = None
    gate = asyncio.Event()

    async def fake_load(page_type: str) -> bool:
        scanner.events.append("load:start")
        await gate.wait()
        scanner._cache = ModelCache(raw_data=[], folders=[])
        scanner.events.append("load:end")
        return True

    async def noop_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(scanner, "_load_persisted_cache", fake_load)
    monkeypatch.setattr(
        model_scanner.ws_manager, "broadcast_init_progress", noop_broadcast
    )

    init = asyncio.create_task(scanner.initialize_in_background(reconcile=True))
    await _settle()
    assert scanner.is_scanning()
    scan = asyncio.create_task(scanner.scan_library())
    await _settle()
    assert scanner.events == ["load:start"]

    gate.set()
    # The reconcile after hydration runs inside the guard without deadlocking.
    await asyncio.wait_for(asyncio.gather(init, scan), timeout=2)
    assert scanner.events == [
        "load:start",
        "load:end",
        "reconcile:start",
        "reconcile:end",
        "reconcile:start",
        "reconcile:end",
    ]
    assert scanner.max_running == 1
    assert not scanner.is_scanning()


@pytest.mark.asyncio
async def test_service_scan_models_flags_a_joined_scan():
    async def scan_library(*, rebuild_cache=False, scope=None):
        return {"added": 2, "removed": 1}, True

    service = SimpleNamespace(scanner=SimpleNamespace(scan_library=scan_library))
    summary = await BaseModelService.scan_models(service, force_refresh=True)
    assert summary == {"added": 2, "removed": 1, "joined": True}


@pytest.mark.asyncio
async def test_service_scan_models_keeps_the_lone_scan_summary():
    original = {"added": 2, "removed": 1}

    async def scan_library(*, rebuild_cache=False, scope=None):
        return original, False

    service = SimpleNamespace(scanner=SimpleNamespace(scan_library=scan_library))
    summary = await BaseModelService.scan_models(service, force_refresh=True)
    assert summary == {"added": 2, "removed": 1}
    assert "joined" not in summary


class _HandlerScanService:
    model_type = "lora"

    def __init__(self, summary):
        self._summary = summary
        self.scanner = SimpleNamespace(is_cancelled=lambda: False)

    def refresh_model_roots(self):
        return []

    def get_model_roots(self):
        return []

    async def scan_models(self, force_refresh=False, rebuild_cache=False, scope=None):
        return self._summary


class _Query(dict):
    def getall(self, key, default=None):
        return list(default or [])


async def _scan_response(summary):
    import json
    import logging

    from py.routes.handlers.model_handlers import ModelQueryHandler

    handler = ModelQueryHandler(
        service=_HandlerScanService(summary), logger=logging.getLogger(__name__)
    )
    response = await handler.scan_models(SimpleNamespace(query=_Query()))
    return response.status, json.loads(response.text)


@pytest.mark.asyncio
async def test_handler_lone_scan_response_shape_is_unchanged():
    status, payload = await _scan_response({"added": 1, "removed": 0})
    assert status == 200
    assert payload == {
        "status": "success",
        "message": "Lora scan completed",
        "added": 1,
        "removed": 0,
    }


@pytest.mark.asyncio
async def test_handler_joined_scan_answers_success_with_the_joined_flag():
    status, payload = await _scan_response({"added": 1, "removed": 0, "joined": True})
    assert status == 200
    assert payload["status"] == "success"
    assert payload["added"] == 1
    assert payload["joined"] is True


@pytest.mark.asyncio
async def test_service_scan_models_flags_a_joined_full_rebuild():
    async def scan_library(*, rebuild_cache=False, scope=None):
        return None, True

    service = SimpleNamespace(scanner=SimpleNamespace(scan_library=scan_library))
    summary = await BaseModelService.scan_models(
        service, force_refresh=True, rebuild_cache=True
    )
    assert summary == {"joined": True}
