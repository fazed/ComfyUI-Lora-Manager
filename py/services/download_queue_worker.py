"""Server-side executor for the persistent download queue.

The SQLite download queue (``DownloadQueueService``) only stores rows; this
worker drains it. It starts ``queued`` rows in queue order (priority, then
added time) up to the ``download_queue_max_concurrent`` setting, through the
exact same code path as ``GET /api/lm/download-model-get`` (the
``DownloadModelUseCase``), so folder, filename and default-path behaviour is
identical to a manual start.

Behaviour:

* **Global pause**: ``pause()`` / ``resume()`` persist a flag in the queue
  database. While paused no new rows are started; running downloads keep
  going (they can still be paused individually).
* **Rate limits**: a ``rate_limited`` result (CivitAI 429 or the download
  manager's cooldown preflight) puts the worker in a cooldown for
  ``retry_after`` seconds. The download manager already re-queues the row
  with the error, so it is simply picked up again afterwards.
* **Startup recovery**: rows left in ``downloading``/``waiting``/``paused``
  by an unclean shutdown that have no live download are reset to
  ``queued``; restarting them resumes from the partial file on disk.
* **Idempotent manual starts**: ``run_download`` is shared with the
  ``download-model-get`` and ``history/retry?start=true`` handlers. A second
  start of a ``download_id`` that is already running joins the running task
  instead of starting it twice, and manual starts count towards the limit.
* **Wake-ups**: ``wake()`` is called when rows are added, retried or
  re-queued, when the pause flag or the limit changes and whenever a
  download finishes; a light periodic poll is the safety net.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable, Dict, Optional, Set

from .download_queue_service import DownloadQueueService
from .settings_manager import get_settings_manager

logger = logging.getLogger(__name__)

DownloadRunner = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]

MAX_CONCURRENT_SETTING_KEY = "download_queue_max_concurrent"
DEFAULT_MAX_CONCURRENT = 2
MIN_MAX_CONCURRENT = 1
MAX_MAX_CONCURRENT = 5

PAUSED_STATE_KEY = "worker_paused"

# Statuses an unclean shutdown can leave behind without a live download.
INTERRUPTED_STATUSES = ("downloading", "waiting", "paused")

DEFAULT_SAFETY_POLL_SECONDS = 30.0
DEFAULT_STARTUP_DELAY_SECONDS = 5.0
DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 60.0


def normalize_max_concurrent(value: Any) -> Optional[int]:
    """Parse a ``download_queue_max_concurrent`` value; ``None`` if invalid."""
    if isinstance(value, bool):
        return None
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    if MIN_MAX_CONCURRENT <= parsed <= MAX_MAX_CONCURRENT:
        return parsed
    return None


def _decode_file_params(raw: Any) -> Optional[Dict[str, Any]]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return None
    return raw if isinstance(raw, dict) and raw else None


def build_queue_download_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    """Build the download payload for a queue row.

    Mirrors what the companion extension sent to ``download-model-get`` for
    a queued row: default paths, the row's download id, its file selection
    and its source (``retry`` is a queue bookkeeping marker, not a source).
    """
    source = row.get("source")
    if source == "retry":
        source = None
    payload: Dict[str, Any] = {
        "model_id": row.get("model_id"),
        "download_id": row.get("download_id"),
        "use_default_paths": True,
    }
    if row.get("model_version_id") is not None:
        payload["model_version_id"] = row.get("model_version_id")
    if source:
        payload["source"] = source
    file_params = _decode_file_params(row.get("file_params"))
    if file_params:
        payload["file_params"] = file_params
    return payload


def _default_download_runner() -> DownloadRunner:
    from .download_coordinator import DownloadCoordinator
    from .service_registry import ServiceRegistry
    from .use_cases.download_model_use_case import DownloadModelUseCase
    from .websocket_manager import ws_manager

    use_case = DownloadModelUseCase(
        download_coordinator=DownloadCoordinator(
            ws_manager=ws_manager,
            download_manager_factory=ServiceRegistry.get_download_manager,
        )
    )
    return use_case.execute


async def _default_download_manager():
    from .service_registry import ServiceRegistry

    return await ServiceRegistry.get_download_manager()


async def _default_cooldown_probe() -> float:
    """Remaining CivitAI cooldown (seconds) from the shared rate limiter."""
    from .download_manager import DOWNLOAD_PREFLIGHT_HOSTS
    from .rate_limit_coordinator import RateLimitCoordinator

    coordinator = await RateLimitCoordinator.get_instance()
    return max(
        (coordinator.remaining_seconds(host) for host in DOWNLOAD_PREFLIGHT_HOSTS),
        default=0.0,
    )


class DownloadQueueWorker:
    """Drain the persistent download queue on the server."""

    def __init__(
        self,
        *,
        download_runner: Optional[DownloadRunner] = None,
        queue_service_factory: Optional[
            Callable[[], Awaitable[DownloadQueueService]]
        ] = None,
        download_manager_factory: Callable[[], Awaitable[Any]] = _default_download_manager,
        cooldown_probe: Callable[[], Awaitable[float]] = _default_cooldown_probe,
        settings_getter: Callable[[], Any] = get_settings_manager,
        clock: Callable[[], float] = time.time,
        safety_poll_seconds: float = DEFAULT_SAFETY_POLL_SECONDS,
        startup_delay_seconds: float = DEFAULT_STARTUP_DELAY_SECONDS,
    ) -> None:
        self._download_runner = download_runner
        # Resolved at call time so tests can swap the singleton.
        self._queue_service_factory = queue_service_factory or (
            lambda: DownloadQueueService.get_instance()
        )
        self._download_manager_factory = download_manager_factory
        self._cooldown_probe = cooldown_probe
        self._settings_getter = settings_getter
        self._clock = clock
        self._safety_poll_seconds = safety_poll_seconds
        self._startup_delay_seconds = startup_delay_seconds

        self._in_flight: Dict[str, asyncio.Task] = {}
        self._wake_event = asyncio.Event()
        self._loop_task: Optional[asyncio.Task] = None
        self._stopping = False
        self._cooldown_until = 0.0
        self._last_rate_limit_error: Optional[str] = None
        self._tick_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    @property
    def is_running(self) -> bool:
        return self._loop_task is not None and not self._loop_task.done()

    def start(self) -> None:
        """Start the background loop (idempotent)."""
        if self.is_running:
            return
        self._stopping = False
        self._loop_task = asyncio.create_task(
            self._run_loop(), name="download_queue_worker"
        )

    async def stop(self) -> None:
        """Stop the background loop. Running downloads are left alone."""
        self._stopping = True
        self._wake_event.set()
        task = self._loop_task
        self._loop_task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass

    def wake(self) -> None:
        """Ask the loop to re-evaluate the queue now."""
        self._wake_event.set()

    async def _run_loop(self) -> None:
        if self._startup_delay_seconds > 0:
            await asyncio.sleep(self._startup_delay_seconds)
        try:
            await self.recover_interrupted()
        except Exception:
            logger.warning("Download queue worker: recovery failed", exc_info=True)

        while not self._stopping:
            # Clear before the tick so wake-ups during the tick are kept.
            self._wake_event.clear()
            try:
                await self.tick()
            except Exception:
                logger.warning("Download queue worker: tick failed", exc_info=True)
            try:
                await asyncio.wait_for(
                    self._wake_event.wait(), timeout=self._next_wait_seconds()
                )
            except asyncio.TimeoutError:
                pass

    def _next_wait_seconds(self) -> float:
        remaining = self.cooldown_remaining()
        if remaining > 0:
            return max(0.05, min(remaining, self._safety_poll_seconds))
        return self._safety_poll_seconds

    # ------------------------------------------------------------------
    # State
    # ------------------------------------------------------------------

    def max_concurrent(self) -> int:
        try:
            raw = self._settings_getter().get(
                MAX_CONCURRENT_SETTING_KEY, DEFAULT_MAX_CONCURRENT
            )
        except Exception:
            return DEFAULT_MAX_CONCURRENT
        parsed = normalize_max_concurrent(raw)
        return parsed if parsed is not None else DEFAULT_MAX_CONCURRENT

    def cooldown_remaining(self) -> float:
        return max(0.0, self._cooldown_until - self._clock())

    async def is_paused(self) -> bool:
        service = await self._queue_service_factory()
        return (await service.get_state(PAUSED_STATE_KEY)) == "1"

    async def pause(self) -> None:
        service = await self._queue_service_factory()
        await service.set_state(PAUSED_STATE_KEY, "1")
        self.wake()

    async def resume(self) -> None:
        service = await self._queue_service_factory()
        await service.set_state(PAUSED_STATE_KEY, None)
        self.wake()

    async def describe(self) -> Dict[str, Any]:
        """Client-facing worker state for the queue/stats endpoints."""
        cooldown = self.cooldown_remaining()
        return {
            "loop_running": self.is_running,
            "paused": await self.is_paused(),
            "max_concurrent": self.max_concurrent(),
            "active": len(self._in_flight),
            "rate_limited": cooldown > 0,
            "rate_limited_until": self._cooldown_until if cooldown > 0 else None,
            "retry_after": int(cooldown + 0.5) if cooldown > 0 else 0,
            "rate_limit_error": self._last_rate_limit_error if cooldown > 0 else None,
        }

    def _register_rate_limit(self, retry_after: Any, error: Any = None) -> None:
        try:
            seconds = float(retry_after)
        except (TypeError, ValueError):
            seconds = 0.0
        if seconds <= 0:
            seconds = DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS
        until = self._clock() + seconds
        if until > self._cooldown_until:
            self._cooldown_until = until
        if error:
            self._last_rate_limit_error = str(error)
        logger.info(
            "Download queue worker: rate limited, not starting downloads for %.0fs",
            seconds,
        )

    async def _running_download_ids(self) -> Set[str]:
        try:
            manager = await self._download_manager_factory()
            getter = getattr(manager, "get_running_download_ids", None)
            if getter is None:
                return set()
            return set(getter())
        except Exception:
            logger.debug("Could not read running downloads", exc_info=True)
            return set()

    # ------------------------------------------------------------------
    # Starting downloads
    # ------------------------------------------------------------------

    async def run_download(
        self,
        payload: Dict[str, Any],
        *,
        runner: Optional[DownloadRunner] = None,
    ) -> Dict[str, Any]:
        """Run a download, joining an already running one with the same id.

        Used by the worker itself and by the manual-start handlers, so a
        ``download_id`` is never started twice. Exceptions from the runner
        propagate to the caller (the handlers map them to HTTP errors).
        """
        download_id = payload.get("download_id")
        execute = runner or self._resolve_runner()
        if not download_id:
            return await execute(payload)

        download_id = str(download_id)
        task = self._in_flight.get(download_id)
        if task is None:
            if download_id in await self._running_download_ids():
                # Started outside the worker (e.g. a restored aria2
                # transfer). Re-check after the await above.
                task = self._in_flight.get(download_id)
                if task is None:
                    return {
                        "success": False,
                        "reason": "already_running",
                        "error": "Download is already running",
                        "download_id": download_id,
                    }
            else:
                task = self._in_flight.get(download_id)
            if task is None:
                task = self._spawn(download_id, payload, execute)
        return await asyncio.shield(task)

    def _resolve_runner(self) -> DownloadRunner:
        if self._download_runner is None:
            self._download_runner = _default_download_runner()
        return self._download_runner

    def _spawn(
        self, download_id: str, payload: Dict[str, Any], execute: DownloadRunner
    ) -> asyncio.Task:
        task = asyncio.create_task(
            self._execute(download_id, dict(payload), execute),
            name=f"download_queue_item:{download_id}",
        )
        self._in_flight[download_id] = task

        def _on_done(done: asyncio.Task) -> None:
            if self._in_flight.get(download_id) is done:
                self._in_flight.pop(download_id, None)
            if not done.cancelled():
                done.exception()  # mark retrieved; callers see it via shield
            self.wake()

        task.add_done_callback(_on_done)
        return task

    async def _execute(
        self, download_id: str, payload: Dict[str, Any], execute: DownloadRunner
    ) -> Dict[str, Any]:
        try:
            result = await execute(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            # Errors raised before the download manager took over (e.g.
            # validation) leave the row 'queued'; close it so it is not
            # retried forever.
            await self._close_failed_row(download_id, str(exc) or type(exc).__name__)
            raise

        if not isinstance(result, dict):
            return result
        if result.get("success", False):
            return result
        if result.get("reason") == "rate_limited":
            # The download manager already put the row back to 'queued'
            # with the error; just stop starting rows for a while.
            self._register_rate_limit(result.get("retry_after"), result.get("error"))
            return result
        await self._close_failed_row(
            download_id, str(result.get("error") or "Download failed")
        )
        return result

    async def _close_failed_row(self, download_id: str, error: str) -> None:
        """Move a row that is still waiting in the queue to history as failed.

        Rows the download manager already moved (or that are mid-transfer)
        are left alone.
        """
        try:
            service = await self._queue_service_factory()
            for row in await service.get_queue():
                if row.get("download_id") == download_id:
                    if row.get("status") == "queued":
                        await service.complete_download(
                            download_id=download_id, status="failed", error=error
                        )
                    return
        except Exception:
            logger.warning(
                "Failed to close queue row %s after an error", download_id, exc_info=True
            )

    # ------------------------------------------------------------------
    # Queue processing
    # ------------------------------------------------------------------

    async def tick(self) -> list[str]:
        """Start as many queued rows as the limit allows; returns their ids."""
        async with self._tick_lock:
            return await self._tick_locked()

    async def _tick_locked(self) -> list[str]:
        if await self.is_paused():
            return []
        if self.cooldown_remaining() > 0:
            return []
        try:
            external = float(await self._cooldown_probe())
        except Exception:
            external = 0.0
        if external > 0:
            self._register_rate_limit(external)
            return []

        service = await self._queue_service_factory()
        queue = await service.get_queue()
        running = await self._running_download_ids()
        queue_ids = {row.get("download_id") for row in queue}
        active = set(self._in_flight) | (running & queue_ids)
        slots = self.max_concurrent() - len(active)

        started: list[str] = []
        execute = self._resolve_runner()
        # get_queue() is already ordered by priority, then added time.
        for row in queue:
            if slots <= 0:
                break
            download_id = row.get("download_id")
            if not download_id or row.get("status") != "queued":
                continue
            if download_id in active or download_id in running:
                continue
            self._spawn(str(download_id), build_queue_download_payload(row), execute)
            active.add(download_id)
            started.append(str(download_id))
            slots -= 1
        if started:
            logger.info("Download queue worker: started %s", ", ".join(started))
        return started

    async def recover_interrupted(self) -> list[str]:
        """Reset rows an unclean shutdown left mid-download back to queued."""
        try:
            manager = await self._download_manager_factory()
            # Restores persisted aria2 transfers so they count as live.
            restore = getattr(manager, "get_active_downloads", None)
            if restore is not None:
                await restore()
        except Exception:
            logger.debug("Could not restore persisted downloads", exc_info=True)

        running = await self._running_download_ids()
        service = await self._queue_service_factory()
        recovered: list[str] = []
        for row in await service.get_queue():
            download_id = row.get("download_id")
            if row.get("status") not in INTERRUPTED_STATUSES:
                continue
            if download_id in running or download_id in self._in_flight:
                continue
            await service.update_status(
                download_id, "queued", bytes_per_second=0.0, error=None
            )
            recovered.append(download_id)
        if recovered:
            logger.info(
                "Download queue worker: re-queued %d interrupted download(s)",
                len(recovered),
            )
        return recovered


_worker: Optional[DownloadQueueWorker] = None


def get_download_queue_worker() -> DownloadQueueWorker:
    """Return the process-wide worker (created lazily, not started)."""
    global _worker
    if _worker is None:
        _worker = DownloadQueueWorker()
    return _worker


def wake_download_queue_worker() -> None:
    """Wake the worker if it exists (cheap no-op otherwise)."""
    if _worker is not None:
        _worker.wake()


async def start_download_queue_worker(app=None) -> None:
    """aiohttp ``on_startup`` hook."""
    try:
        get_download_queue_worker().start()
    except Exception:
        logger.error("Failed to start the download queue worker", exc_info=True)


async def stop_download_queue_worker(app=None) -> None:
    """aiohttp ``on_shutdown`` hook."""
    if _worker is not None:
        await _worker.stop()
