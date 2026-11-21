"""Tests for the server-side download queue worker."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, List, Set

import pytest

from py.services.download_queue_service import DownloadQueueService
from py.services.download_queue_worker import (
    DownloadQueueWorker,
    build_queue_download_payload,
    normalize_max_concurrent,
)


class _FakeSettings:
    def __init__(self, values: Dict[str, Any] | None = None) -> None:
        self.values = dict(values or {})

    def get(self, key: str, default: Any = None) -> Any:
        return self.values.get(key, default)


class _FakeManager:
    """Stand-in for DownloadManager's live-tracking surface."""

    def __init__(self) -> None:
        self.running: Set[str] = set()
        self.restore_calls = 0

    def get_running_download_ids(self) -> Set[str]:
        return set(self.running)

    async def get_active_downloads(self) -> Dict[str, Any]:
        self.restore_calls += 1
        return {"downloads": []}


class _ControlledRunner:
    """Download runner whose downloads finish when the test says so."""

    def __init__(self, queue: DownloadQueueService) -> None:
        self.queue = queue
        self.started: List[str] = []
        self.payloads: List[Dict[str, Any]] = []
        self.gates: Dict[str, asyncio.Future] = {}

    async def __call__(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        download_id = payload["download_id"]
        self.started.append(download_id)
        self.payloads.append(payload)
        await self.queue.update_status(download_id, "downloading")
        gate = asyncio.get_running_loop().create_future()
        self.gates[download_id] = gate
        result = await gate
        if result.get("success"):
            await self.queue.complete_download(download_id, status="completed")
        return result

    def finish(self, download_id: str, result: Dict[str, Any] | None = None) -> None:
        self.gates[download_id].set_result(result or {"success": True})


class _Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


async def _no_cooldown() -> float:
    return 0.0


@pytest.fixture
def queue(tmp_path: Path) -> DownloadQueueService:
    return DownloadQueueService(db_path=str(tmp_path / "queue.sqlite"))


def _make_worker(
    queue: DownloadQueueService,
    runner,
    *,
    manager: _FakeManager | None = None,
    settings: _FakeSettings | None = None,
    clock: _Clock | None = None,
    cooldown_probe=_no_cooldown,
) -> DownloadQueueWorker:
    manager = manager or _FakeManager()
    settings = settings or _FakeSettings()

    async def queue_factory() -> DownloadQueueService:
        return queue

    async def manager_factory() -> _FakeManager:
        return manager

    return DownloadQueueWorker(
        download_runner=runner,
        queue_service_factory=queue_factory,
        download_manager_factory=manager_factory,
        cooldown_probe=cooldown_probe,
        settings_getter=lambda: settings,
        clock=clock or _Clock(),
        safety_poll_seconds=0.05,
        startup_delay_seconds=0,
    )


async def _settle() -> None:
    for _ in range(5):
        await asyncio.sleep(0)


async def _queue_ids(queue: DownloadQueueService) -> Dict[str, str]:
    return {row["download_id"]: row["status"] for row in await queue.get_queue()}


async def _add(queue: DownloadQueueService, *ids: str) -> None:
    for index, download_id in enumerate(ids):
        await queue.add_to_queue(download_id=download_id, model_id=100 + index)
        # Distinct added_at values keep the queue order deterministic.
        await asyncio.sleep(0.002)


def test_normalize_max_concurrent_accepts_only_1_to_5() -> None:
    assert normalize_max_concurrent(1) == 1
    assert normalize_max_concurrent("5") == 5
    assert normalize_max_concurrent(0) is None
    assert normalize_max_concurrent(6) is None
    assert normalize_max_concurrent("abc") is None
    assert normalize_max_concurrent(True) is None
    assert normalize_max_concurrent(None) is None


def test_payload_matches_download_model_get_defaults() -> None:
    payload = build_queue_download_payload(
        {
            "download_id": "dl",
            "model_id": 1,
            "model_version_id": 2,
            "source": "retry",
            "file_params": '{"id": 7}',
        }
    )
    assert payload == {
        "model_id": 1,
        "model_version_id": 2,
        "download_id": "dl",
        "use_default_paths": True,
        "file_params": {"id": 7},
    }
    civarchive = build_queue_download_payload(
        {"download_id": "dl", "model_id": 1, "source": "civarchive", "file_params": None}
    )
    assert civarchive["source"] == "civarchive"
    assert "file_params" not in civarchive
    assert "model_version_id" not in civarchive


async def test_respects_concurrency_limit_and_queue_order(
    queue: DownloadQueueService,
) -> None:
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner)  # default limit: 2
    await _add(queue, "a", "b", "c", "d")
    await queue.move_to_top("c")

    started = await worker.tick()
    await _settle()
    assert started == ["c", "a"]
    assert runner.started == ["c", "a"]

    # Nothing new while both slots are taken.
    assert await worker.tick() == []

    runner.finish("c")
    await _settle()
    assert await worker.tick() == ["b"]
    await _settle()
    assert (await _queue_ids(queue)) == {"a": "downloading", "b": "downloading", "d": "queued"}

    runner.finish("a")
    runner.finish("b")
    await _settle()
    assert await worker.tick() == ["d"]
    await _settle()
    runner.finish("d")
    await _settle()
    assert await _queue_ids(queue) == {}


async def test_max_concurrent_setting_is_read_and_clamped(
    queue: DownloadQueueService,
) -> None:
    runner = _ControlledRunner(queue)
    settings = _FakeSettings({"download_queue_max_concurrent": "3"})
    worker = _make_worker(queue, runner, settings=settings)
    await _add(queue, "a", "b", "c", "d")
    assert len(await worker.tick()) == 3

    settings.values["download_queue_max_concurrent"] = 99  # invalid: default 2
    assert worker.max_concurrent() == 2
    for download_id in list(runner.gates):
        runner.finish(download_id)
    await _settle()


async def test_pause_and_resume_are_persisted(
    queue: DownloadQueueService,
) -> None:
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner)
    await _add(queue, "a")

    await worker.pause()
    assert await worker.tick() == []
    assert (await worker.describe())["paused"] is True

    # A new worker (e.g. after a restart) sees the persisted flag.
    other = _make_worker(queue, runner)
    assert await other.is_paused() is True

    await worker.resume()
    assert (await worker.describe())["paused"] is False
    assert await worker.tick() == ["a"]
    await _settle()
    runner.finish("a")
    await _settle()


async def test_rate_limit_result_starts_cooldown(queue: DownloadQueueService) -> None:
    clock = _Clock()
    calls: List[str] = []

    async def rate_limited_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
        calls.append(payload["download_id"])
        # The download manager re-queues the row with the error itself.
        await queue.update_status(payload["download_id"], "queued", error="429")
        return {
            "success": False,
            "reason": "rate_limited",
            "retry_after": 120,
            "error": "Download rate limited (429)",
        }

    worker = _make_worker(queue, rate_limited_runner, clock=clock)
    await _add(queue, "a", "b")

    # The first tick starts both slots; both bounce with a 429.
    await worker.tick()
    await _settle()
    assert calls == ["a", "b"]
    state = await worker.describe()
    assert state["rate_limited"] is True
    assert state["retry_after"] == 120

    # Rows stay queued (with the error) and nothing starts during cooldown.
    assert await _queue_ids(queue) == {"a": "queued", "b": "queued"}
    assert await worker.tick() == []
    clock.now += 119
    assert await worker.tick() == []

    clock.now += 2
    assert await worker.tick() == ["a", "b"]
    await _settle()


async def test_shared_rate_limiter_cooldown_blocks_starts(
    queue: DownloadQueueService,
) -> None:
    runner = _ControlledRunner(queue)
    remaining = {"seconds": 30.0}

    async def probe() -> float:
        return remaining["seconds"]

    clock = _Clock()
    worker = _make_worker(queue, runner, clock=clock, cooldown_probe=probe)
    await _add(queue, "a")

    assert await worker.tick() == []
    assert runner.started == []

    remaining["seconds"] = 0.0
    clock.now += 31
    assert await worker.tick() == ["a"]
    await _settle()
    runner.finish("a")
    await _settle()


async def test_failed_start_moves_row_to_history(queue: DownloadQueueService) -> None:
    async def failing_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
        return {"success": False, "error": "No model files found"}

    worker = _make_worker(queue, failing_runner)
    await _add(queue, "a")
    await worker.tick()
    await _settle()

    assert await _queue_ids(queue) == {}
    history = await queue.get_history()
    assert history["items"][0]["status"] == "failed"
    assert history["items"][0]["error"] == "No model files found"


async def test_runner_exception_closes_row(queue: DownloadQueueService) -> None:
    async def raising_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
        raise ValueError("Invalid model_id")

    worker = _make_worker(queue, raising_runner)
    await _add(queue, "a")
    await worker.tick()
    await _settle()

    assert await _queue_ids(queue) == {}
    assert (await queue.get_history())["items"][0]["error"] == "Invalid model_id"


async def test_startup_recovery_requeues_interrupted_rows(
    queue: DownloadQueueService,
) -> None:
    manager = _FakeManager()
    manager.running = {"live"}
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner, manager=manager)
    await _add(queue, "stale", "paused", "live", "waiting")
    await queue.update_status("stale", "downloading", bytes_per_second=1234.0)
    await queue.update_status("paused", "paused")
    await queue.update_status("live", "downloading")

    recovered = await worker.recover_interrupted()

    assert sorted(recovered) == ["paused", "stale"]
    assert manager.restore_calls == 1  # aria2 transfers restored first
    rows = {row["download_id"]: row for row in await queue.get_queue()}
    assert rows["stale"]["status"] == "queued"
    assert rows["stale"]["bytes_per_second"] == 0.0
    assert rows["paused"]["status"] == "queued"
    assert rows["live"]["status"] == "downloading"
    assert rows["waiting"]["status"] == "queued"


async def test_manual_start_is_not_started_twice(queue: DownloadQueueService) -> None:
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner)
    await _add(queue, "a", "b")

    payload = build_queue_download_payload((await queue.get_queue())[0])
    manual_first = asyncio.create_task(worker.run_download(payload))
    manual_second = asyncio.create_task(worker.run_download(dict(payload)))
    await _settle()

    # The manual start counts towards the limit and is skipped by the tick.
    assert await worker.tick() == ["b"]
    await _settle()
    assert runner.started == ["a", "b"]

    runner.finish("a")
    first, second = await asyncio.gather(manual_first, manual_second)
    assert first == second == {"success": True}
    runner.finish("b")
    await _settle()


async def test_manual_start_with_custom_runner_joins_worker_task(
    queue: DownloadQueueService,
) -> None:
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner)
    await _add(queue, "a")
    assert await worker.tick() == ["a"]
    await _settle()

    handler_calls: List[str] = []

    async def handler_runner(payload: Dict[str, Any]) -> Dict[str, Any]:
        handler_calls.append(payload["download_id"])
        return {"success": True}

    joined = asyncio.create_task(
        worker.run_download({"download_id": "a", "model_id": 100}, runner=handler_runner)
    )
    await _settle()
    runner.finish("a")
    assert await joined == {"success": True}
    assert handler_calls == []


async def test_download_running_outside_worker_is_not_restarted(
    queue: DownloadQueueService,
) -> None:
    manager = _FakeManager()
    manager.running = {"a"}
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner, manager=manager)
    await _add(queue, "a", "b", "c")

    # "a" (e.g. a restored aria2 transfer) counts towards the limit of 2.
    assert await worker.tick() == ["b"]
    await _settle()

    result = await worker.run_download({"download_id": "a", "model_id": 100})
    assert result["reason"] == "already_running"
    assert runner.started == ["b"]
    runner.finish("b")
    await _settle()


async def test_loop_wakes_up_when_rows_are_added(queue: DownloadQueueService) -> None:
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner)
    # Long poll: only an explicit wake-up can start the row quickly.
    worker._safety_poll_seconds = 30.0
    worker.start()
    try:
        await asyncio.sleep(0.05)
        await _add(queue, "a")
        worker.wake()
        for _ in range(50):
            if runner.started:
                break
            await asyncio.sleep(0.01)
        assert runner.started == ["a"]
        runner.finish("a")
        await _settle()
    finally:
        await worker.stop()
    assert worker.is_running is False


async def test_loop_recovers_on_start_and_drains(queue: DownloadQueueService) -> None:
    runner = _ControlledRunner(queue)
    worker = _make_worker(queue, runner)
    await _add(queue, "a")
    await queue.update_status("a", "downloading")
    worker.start()
    try:
        for _ in range(50):
            if runner.started:
                break
            await asyncio.sleep(0.01)
        assert runner.started == ["a"]
        runner.finish("a")
        await _settle()
    finally:
        await worker.stop()
