"""Handler-level tests for download queue terminal/status transitions.

Regression test: a "not found in queue" outcome must be returned as HTTP 200
with ``success: false``, not 404. The browser extension's apiFetch treats any
404 as a missing endpoint and retries a legacy URL, producing spurious
``/api/downloads/queue/complete ... 404`` warnings on every completion.
"""

import json
import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from py.routes.handlers.model_handlers import ModelDownloadHandler
from py.services import download_manager as download_manager_module
from py.services.download_coordinator import DownloadCoordinator
from py.services.download_manager import DownloadManager
from py.services.download_queue_service import DownloadQueueService
from py.services.use_cases import DownloadModelValidationError


def _make_handler() -> ModelDownloadHandler:
    return ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType] - unused by queue endpoints
        logger=logging.getLogger("test-download-queue"),
        download_use_case=None,  # pyright: ignore[reportArgumentType] - unused by queue endpoints
        download_coordinator=None,  # pyright: ignore[reportArgumentType] - unused by queue endpoints
    )


def _queue_request(path: str, query: dict[str, str]) -> web.Request:
    query_string = "&".join(f"{key}={value}" for key, value in query.items())
    return make_mocked_request("GET", f"{path}?{query_string}")


@pytest.fixture
def queue_service(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> DownloadQueueService:
    """Return a tmp-backed DownloadQueueService and stub the singleton."""
    service = DownloadQueueService(db_path=str(tmp_path / "queue.sqlite"))

    async def fake_get_instance(_cls: object = None) -> DownloadQueueService:
        return service

    monkeypatch.setattr(DownloadQueueService, "get_instance", fake_get_instance)
    return service


@pytest.mark.asyncio
async def test_complete_missing_download_returns_200_not_404(
    queue_service: DownloadQueueService,
) -> None:
    """Completing a download that is not queued is a business outcome."""
    handler = _make_handler()
    response = await handler.complete_download_in_queue(
        _queue_request(
            "/api/lm/downloads/queue/complete",
            {"download_id": "dl-nope", "status": "completed"},
        )
    )
    assert response.status == 200
    text = response.text
    assert text is not None
    assert json.loads(text) == {
        "success": False,
        "error": "Download not found in queue",
    }
    # The failed completion must not have side effects on the queue.
    assert await queue_service.get_queue() == []


@pytest.mark.asyncio
async def test_complete_queued_download_returns_success(
    queue_service: DownloadQueueService,
) -> None:
    """The happy path still moves the item to history with HTTP 200."""
    await queue_service.add_to_queue(download_id="dl-1", model_id=1)
    handler = _make_handler()
    response = await handler.complete_download_in_queue(
        _queue_request(
            "/api/lm/downloads/queue/complete",
            {"download_id": "dl-1", "status": "completed"},
        )
    )
    assert response.status == 200
    text = response.text
    assert text is not None
    payload = json.loads(text)
    assert payload["success"] is True
    # The returned item reflects the pre-transition queue record; the
    # terminal status lands in history.
    history = await queue_service.get_history()
    assert len(history["items"]) == 1
    assert history["items"][0]["status"] == "completed"


@pytest.mark.asyncio
async def test_status_missing_download_returns_200_not_404(
    queue_service: DownloadQueueService,
) -> None:
    """Status updates for unknown items also return 200 with success: false."""
    handler = _make_handler()
    response = await handler.update_download_queue_status(
        _queue_request(
            "/api/lm/downloads/queue/status",
            {"download_id": "dl-nope", "status": "downloading"},
        )
    )
    assert response.status == 200
    text = response.text
    assert text is not None
    assert json.loads(text) == {
        "success": False,
        "error": "Download not found in queue",
    }
    assert await queue_service.get_queue() == []


@pytest.mark.asyncio
async def test_status_queued_download_returns_success(
    queue_service: DownloadQueueService,
) -> None:
    """The happy path still updates the queue item with HTTP 200."""
    await queue_service.add_to_queue(download_id="dl-2", model_id=2)
    handler = _make_handler()
    response = await handler.update_download_queue_status(
        _queue_request(
            "/api/lm/downloads/queue/status",
            {"download_id": "dl-2", "status": "downloading"},
        )
    )
    assert response.status == 200
    text = response.text
    assert text is not None
    assert json.loads(text) == {"success": True}


@pytest.mark.asyncio
async def test_retry_missing_history_returns_200_not_404(
    queue_service: DownloadQueueService,
) -> None:
    """Retrying a history entry that no longer exists is a business outcome."""
    handler = _make_handler()
    response = await handler.retry_download_from_history(
        _queue_request(
            "/api/lm/downloads/history/retry",
            {"download_id": "dl-nope"},
        )
    )
    assert response.status == 200
    text = response.text
    assert text is not None
    assert json.loads(text) == {
        "success": False,
        "error": "History item not found or not retryable",
    }
    # No side effects: history and queue stay empty.
    history = await queue_service.get_history()
    assert history["items"] == []
    assert await queue_service.get_queue() == []


@pytest.mark.asyncio
async def test_retry_failed_history_returns_success(
    queue_service: DownloadQueueService,
) -> None:
    """The happy path still re-queues a retryable history entry with HTTP 200."""
    await queue_service.add_to_history(
        download_id="dl-fail", model_id=1, status="failed"
    )
    handler = _make_handler()
    response = await handler.retry_download_from_history(
        _queue_request(
            "/api/lm/downloads/history/retry",
            {"download_id": "dl-fail"},
        )
    )
    assert response.status == 200
    text = response.text
    assert text is not None
    payload = json.loads(text)
    assert payload["success"] is True
    # The retried item is re-queued under a fresh download_id.
    queue = await queue_service.get_queue()
    assert len(queue) == 1
    assert queue[0]["status"] == "queued"


@pytest.mark.asyncio
async def test_add_to_download_queue_canonicalizes_and_deduplicates(
    queue_service: DownloadQueueService,
) -> None:
    resolved = {
        "model_id": 1,
        "model_version_id": 100,
        "model_name": "Model",
        "version_name": "V1",
        "file_params": {"id": 1001, "fileName": "model.safetensors"},
    }
    coordinator = SimpleNamespace(
        resolve_download_target=AsyncMock(return_value=resolved)
    )
    handler = ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType]
        logger=logging.getLogger("test-download-queue-add"),
        download_use_case=None,  # pyright: ignore[reportArgumentType]
        download_coordinator=coordinator,  # pyright: ignore[reportArgumentType]
    )

    first = await handler.add_to_download_queue(
        _queue_request("/api/lm/downloads/queue/add", {"download_id": "dl-first", "model_id": "1"})
    )
    second = await handler.add_to_download_queue(
        _queue_request("/api/lm/downloads/queue/add", {"download_id": "dl-second", "model_id": "1"})
    )

    first_payload = json.loads(first.text)
    second_payload = json.loads(second.text)
    assert first_payload["queued"] is True
    assert first_payload["item"]["model_version_id"] == 100
    assert json.loads(first_payload["item"]["file_params"])["id"] == 1001
    assert second_payload["success"] is True
    assert second_payload["queued"] is False
    assert second_payload["duplicate"] is True
    assert second_payload["reason"] == "already_queued"
    assert len(await queue_service.get_queue()) == 1


@pytest.mark.asyncio
async def test_card_then_model_page_creates_one_queue_item(
    queue_service: DownloadQueueService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = SimpleNamespace(
        get_model_version=AsyncMock(return_value={
            "id": 100,
            "name": "V1",
            "modelId": 1,
            "model": {"id": 1, "name": "Model", "type": "LoRA"},
            "files": [{
                "id": 1001,
                "type": "Model",
                "primary": True,
                "name": "model.safetensors",
                "metadata": {"format": "SafeTensor"},
            }],
        })
    )
    monkeypatch.setattr(
        download_manager_module,
        "get_default_metadata_provider",
        AsyncMock(return_value=provider),
    )
    manager = DownloadManager()
    coordinator = DownloadCoordinator(
        ws_manager=None,
        download_manager_factory=AsyncMock(return_value=manager),
    )
    handler = ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType]
        logger=logging.getLogger("test-download-queue-integration"),
        download_use_case=None,  # pyright: ignore[reportArgumentType]
        download_coordinator=coordinator,
    )

    card_response = await handler.add_to_download_queue(
        _queue_request("/api/lm/downloads/queue/add", {"download_id": "card", "model_id": "1"})
    )
    page_response = await handler.add_to_download_queue(
        _queue_request(
            "/api/lm/downloads/queue/add",
            {
                "download_id": "page",
                "model_id": "1",
                "model_version_id": "100",
                "file_params": json.dumps({"id": 1001}),
            },
        )
    )

    assert json.loads(card_response.text)["queued"] is True
    page_payload = json.loads(page_response.text)
    assert page_payload["duplicate"] is True
    assert page_payload["item"]["download_id"] == "card"
    queue = await queue_service.get_queue()
    assert len(queue) == 1
    assert queue[0]["model_version_id"] == 100
    assert json.loads(queue[0]["file_params"])["id"] == 1001


def _resolving_handler(resolved: dict) -> ModelDownloadHandler:
    return ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType]
        logger=logging.getLogger("test-download-queue-thumbnail"),
        download_use_case=None,  # pyright: ignore[reportArgumentType]
        download_coordinator=SimpleNamespace(  # pyright: ignore[reportArgumentType]
            resolve_download_target=AsyncMock(return_value=resolved)
        ),
    )


@pytest.mark.asyncio
async def test_add_fills_empty_thumbnail_from_resolved_version(
    queue_service: DownloadQueueService,
) -> None:
    handler = _resolving_handler({
        "model_id": 1,
        "model_version_id": 100,
        "model_name": "Model",
        "version_name": "V1",
        "file_params": {"id": 1001},
        "thumbnail_url": "https://image.civitai.com/x/u/width=450,optimized=true/1.jpeg",
    })

    response = await handler.add_to_download_queue(
        _queue_request("/api/lm/downloads/queue/add", {"download_id": "dl-t", "model_id": "1"})
    )

    item = json.loads(response.text)["item"]
    assert item["thumbnail_url"] == "https://image.civitai.com/x/u/width=450,optimized=true/1.jpeg"
    assert item["model_name"] == "Model"
    assert item["version_name"] == "V1"


@pytest.mark.asyncio
async def test_add_keeps_caller_provided_thumbnail(
    queue_service: DownloadQueueService,
) -> None:
    handler = _resolving_handler({
        "model_id": 1,
        "model_version_id": 100,
        "file_params": {"id": 1001},
        "thumbnail_url": "https://image.civitai.com/x/u/width=450,optimized=true/1.jpeg",
    })

    response = await handler.add_to_download_queue(
        _queue_request(
            "/api/lm/downloads/queue/add",
            {"download_id": "dl-own", "model_id": "1", "thumbnail_url": "https://example.com/mine.jpg"},
        )
    )

    assert json.loads(response.text)["item"]["thumbnail_url"] == "https://example.com/mine.jpg"


@pytest.mark.asyncio
async def test_resolve_download_target_derives_video_still_thumbnail(
    queue_service: DownloadQueueService,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = SimpleNamespace(
        get_model_version=AsyncMock(return_value={
            "id": 100,
            "name": "V1",
            "modelId": 1,
            "model": {"id": 1, "name": "Model", "type": "LoRA"},
            "images": [{
                "url": "https://image.civitai.com/xG1nk/uuid/original=true/75044257.mp4",
                "type": "video",
            }],
            "files": [{
                "id": 1001,
                "type": "Model",
                "primary": True,
                "name": "model.safetensors",
                "metadata": {"format": "SafeTensor"},
            }],
        })
    )
    monkeypatch.setattr(
        download_manager_module,
        "get_default_metadata_provider",
        AsyncMock(return_value=provider),
    )
    coordinator = DownloadCoordinator(
        ws_manager=None,
        download_manager_factory=AsyncMock(return_value=DownloadManager()),
    )
    handler = ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType]
        logger=logging.getLogger("test-download-queue-video-thumb"),
        download_use_case=None,  # pyright: ignore[reportArgumentType]
        download_coordinator=coordinator,
    )

    response = await handler.add_to_download_queue(
        _queue_request(
            "/api/lm/downloads/queue/add",
            {"download_id": "dl-v", "model_id": "1", "model_version_id": "100"},
        )
    )

    assert json.loads(response.text)["item"]["thumbnail_url"] == (
        "https://image.civitai.com/xG1nk/uuid/anim=false,transcode=true,width=450,optimized=true/75044257.jpeg"
    )
    # The thumbnail comes from the one lookup resolve already made.
    provider.get_model_version.assert_awaited_once()


# ----------------------------------------------------------------------
# Structured 429 rate-limit responses (download queue contract)
# ----------------------------------------------------------------------

_RATE_LIMITED_RESULT = {
    "success": False,
    "reason": "rate_limited",
    "retry_after": 120,
    "error": "Download rate limited (429), retry after 120s",
    "download_id": "dl-1",
}


def _make_download_handler(result: dict) -> ModelDownloadHandler:
    return ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType] - unused by download endpoints
        logger=logging.getLogger("test-download-rate-limit"),
        download_use_case=SimpleNamespace(execute=AsyncMock(return_value=result)),  # pyright: ignore[reportArgumentType]
        download_coordinator=None,  # pyright: ignore[reportArgumentType] - unused by download endpoints
    )


@pytest.mark.asyncio
async def test_download_model_post_returns_429_when_rate_limited() -> None:
    """POST /download-model maps reason="rate_limited" to HTTP 429."""
    handler = _make_download_handler(dict(_RATE_LIMITED_RESULT))
    request = SimpleNamespace(json=AsyncMock(return_value={"model_id": 1}))

    response = await handler.download_model(request)

    assert response.status == 429
    payload = json.loads(response.text)
    assert payload["success"] is False
    assert payload["reason"] == "rate_limited"
    assert payload["retry_after"] == 120
    assert payload["error"]


@pytest.mark.asyncio
async def test_download_model_post_keeps_500_for_other_failures() -> None:
    handler = _make_download_handler({"success": False, "error": "boom"})
    request = SimpleNamespace(json=AsyncMock(return_value={"model_id": 1}))

    response = await handler.download_model(request)

    assert response.status == 500
    payload = json.loads(response.text)
    assert payload["success"] is False
    assert "reason" not in payload


@pytest.mark.asyncio
async def test_download_model_get_returns_429_when_rate_limited() -> None:
    """GET /download-model-get (extension queue driver) gets the same 429."""
    handler = _make_download_handler(dict(_RATE_LIMITED_RESULT))
    request = _queue_request("/api/lm/download-model-get", {"model_id": "1"})

    response = await handler.download_model_get(request)

    assert response.status == 429
    payload = json.loads(response.text)
    assert payload["success"] is False
    assert payload["reason"] == "rate_limited"
    assert payload["retry_after"] == 120
    assert payload["error"]


@pytest.mark.asyncio
async def test_download_model_get_keeps_500_for_other_failures() -> None:
    handler = _make_download_handler({"success": False, "error": "boom"})
    request = _queue_request("/api/lm/download-model-get", {"model_id": "1"})

    response = await handler.download_model_get(request)

    assert response.status == 500
    payload = json.loads(response.text)
    assert payload["success"] is False
    assert "reason" not in payload


# ----------------------------------------------------------------------
# retry with start=true: backend executor for clients that do not run the
# companion browser extension (#1196)
# ----------------------------------------------------------------------


def _make_retry_start_handler(result: dict) -> tuple[ModelDownloadHandler, AsyncMock]:
    execute = AsyncMock(return_value=result)
    handler = ModelDownloadHandler(
        ws_manager=None,  # pyright: ignore[reportArgumentType] - unused here
        logger=logging.getLogger("test-retry-start"),
        download_use_case=SimpleNamespace(execute=execute),  # pyright: ignore[reportArgumentType]
        download_coordinator=None,  # pyright: ignore[reportArgumentType] - unused here
    )
    return handler, execute


@pytest.mark.asyncio
async def test_retry_with_start_runs_download_server_side(
    queue_service: DownloadQueueService,
) -> None:
    """start=true executes the re-queued item instead of parking it."""
    await queue_service.add_to_history(
        download_id="dl-fail",
        model_id=7,
        model_version_id=70,
        status="failed",
        file_params={"id": 7001, "type": "Model"},
    )
    handler, execute = _make_retry_start_handler(
        {"success": True, "download_id": "ignored-by-handler"}
    )

    response = await handler.retry_download_from_history(
        _queue_request(
            "/api/lm/downloads/history/retry",
            {"download_id": "dl-fail", "start": "true"},
        )
    )

    assert response.status == 200
    payload = json.loads(response.text)
    assert payload["success"] is True
    assert payload["started"] is True
    queued = (await queue_service.get_queue())[0]
    execute.assert_awaited_once()
    sent = execute.await_args.args[0]
    assert sent["model_id"] == 7
    assert sent["model_version_id"] == 70
    assert sent["download_id"] == queued["download_id"]
    assert sent["use_default_paths"] is True
    assert sent["source"] == "retry"
    assert sent["file_params"] == {"id": 7001, "type": "Model"}


@pytest.mark.asyncio
async def test_retry_without_start_keeps_client_side_drain(
    queue_service: DownloadQueueService,
) -> None:
    """The extension's call (no start flag) must not trigger a download."""
    await queue_service.add_to_history(
        download_id="dl-fail", model_id=1, status="failed"
    )
    handler, execute = _make_retry_start_handler({"success": True})

    response = await handler.retry_download_from_history(
        _queue_request(
            "/api/lm/downloads/history/retry", {"download_id": "dl-fail"}
        )
    )

    assert response.status == 200
    payload = json.loads(response.text)
    assert payload["success"] is True
    assert "started" not in payload
    execute.assert_not_awaited()
    assert (await queue_service.get_queue())[0]["status"] == "queued"


@pytest.mark.asyncio
async def test_retry_with_start_maps_rate_limit_to_429(
    queue_service: DownloadQueueService,
) -> None:
    await queue_service.add_to_history(
        download_id="dl-fail", model_id=1, status="failed"
    )
    handler, _execute = _make_retry_start_handler(dict(_RATE_LIMITED_RESULT))

    response = await handler.retry_download_from_history(
        _queue_request(
            "/api/lm/downloads/history/retry",
            {"download_id": "dl-fail", "start": "1"},
        )
    )

    assert response.status == 429
    payload = json.loads(response.text)
    assert payload["success"] is False
    assert payload["reason"] == "rate_limited"
    assert payload["started"] is True


@pytest.mark.asyncio
async def test_retry_with_start_maps_validation_error_to_400(
    queue_service: DownloadQueueService,
) -> None:
    await queue_service.add_to_history(
        download_id="dl-fail", model_id=1, status="failed"
    )
    handler, execute = _make_retry_start_handler({})
    execute.side_effect = DownloadModelValidationError("bad payload")

    response = await handler.retry_download_from_history(
        _queue_request(
            "/api/lm/downloads/history/retry",
            {"download_id": "dl-fail", "start": "true"},
        )
    )

    assert response.status == 400
    assert json.loads(response.text)["success"] is False


# ----------------------------------------------------------------------
# Server-side queue worker integration
# ----------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_worker(monkeypatch: pytest.MonkeyPatch):
    """Install a worker that never touches the real download manager.

    Autouse: download-model-get and retry?start=true route manual starts
    through the process-wide worker.
    """
    from py.services import download_queue_worker as worker_module

    async def no_cooldown() -> float:
        return 0.0

    async def manager_factory():
        return SimpleNamespace(get_running_download_ids=lambda: set())

    worker = worker_module.DownloadQueueWorker(
        download_runner=AsyncMock(return_value={"success": True}),
        download_manager_factory=manager_factory,
        cooldown_probe=no_cooldown,
        settings_getter=lambda: SimpleNamespace(get=lambda key, default=None: default),
        startup_delay_seconds=0,
    )
    monkeypatch.setattr(worker_module, "_worker", worker)
    return worker


@pytest.mark.asyncio
async def test_queue_response_advertises_worker_capability(
    queue_service: DownloadQueueService, isolated_worker
) -> None:
    handler = _make_handler()
    response = await handler.get_download_queue(
        _queue_request("/api/lm/downloads/queue", {})
    )
    payload = json.loads(response.text)
    assert payload["queue_worker"] is True
    assert payload["worker"]["paused"] is False
    assert payload["worker"]["max_concurrent"] == 2
    assert payload["worker"]["rate_limited"] is False

    stats = json.loads(
        (await handler.get_download_stats(_queue_request("/api/lm/downloads/stats", {}))).text
    )
    assert stats["queue_worker"] is True
    assert "worker" in stats


@pytest.mark.asyncio
async def test_pause_all_and_resume_all_toggle_worker(
    queue_service: DownloadQueueService, isolated_worker
) -> None:
    handler = _make_handler()
    paused = json.loads(
        (await handler.pause_download_queue(
            _queue_request("/api/lm/downloads/queue/pause-all", {})
        )).text
    )
    assert paused == {"success": True, "worker": paused["worker"]}
    assert paused["worker"]["paused"] is True
    assert await queue_service.get_state("worker_paused") == "1"

    resumed = json.loads(
        (await handler.resume_download_queue(
            _queue_request("/api/lm/downloads/queue/resume-all", {})
        )).text
    )
    assert resumed["worker"]["paused"] is False
    assert await queue_service.get_state("worker_paused") is None


@pytest.mark.asyncio
async def test_add_to_queue_wakes_the_worker(
    queue_service: DownloadQueueService, isolated_worker
) -> None:
    handler = _make_handler()
    assert not isolated_worker._wake_event.is_set()
    await handler.add_to_download_queue(
        _queue_request("/api/lm/downloads/queue/add", {"download_id": "dl-w", "model_id": "5"})
    )
    assert isolated_worker._wake_event.is_set()


@pytest.mark.asyncio
async def test_download_model_get_joins_running_download(
    queue_service: DownloadQueueService, isolated_worker
) -> None:
    """A manual start of a download the worker already runs is not doubled."""
    import asyncio

    gate = asyncio.get_running_loop().create_future()
    calls: list[str] = []

    async def slow_runner(payload: dict) -> dict:
        calls.append(payload["download_id"])
        return await gate

    isolated_worker._download_runner = slow_runner
    await queue_service.add_to_queue(download_id="dl-run", model_id=1)
    assert await isolated_worker.tick() == ["dl-run"]

    handler = _make_download_handler({"success": True, "via": "handler"})
    request = _queue_request(
        "/api/lm/download-model-get", {"model_id": "1", "download_id": "dl-run"}
    )
    pending = asyncio.ensure_future(handler.download_model_get(request))
    for _ in range(5):
        await asyncio.sleep(0)
    gate.set_result({"success": True, "via": "worker"})
    response = await pending

    assert json.loads(response.text)["via"] == "worker"
    assert calls == ["dl-run"]
    handler._download_use_case.execute.assert_not_called()  # pyright: ignore[reportAttributeAccessIssue]


@pytest.mark.asyncio
async def test_download_model_get_returns_409_when_running_elsewhere(
    queue_service: DownloadQueueService, isolated_worker
) -> None:
    async def manager_factory():
        return SimpleNamespace(get_running_download_ids=lambda: {"dl-x"})

    isolated_worker._download_manager_factory = manager_factory
    handler = _make_download_handler({"success": True})
    response = await handler.download_model_get(
        _queue_request(
            "/api/lm/download-model-get", {"model_id": "1", "download_id": "dl-x"}
        )
    )
    assert response.status == 409
    assert json.loads(response.text)["reason"] == "already_running"
    handler._download_use_case.execute.assert_not_called()  # pyright: ignore[reportAttributeAccessIssue]
