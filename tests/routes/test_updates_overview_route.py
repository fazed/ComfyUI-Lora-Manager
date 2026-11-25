"""GET /api/lm/{prefix}/updates/overview: read-only, per prefix, no Civitai."""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from py.routes.handlers.model_handlers import ModelUpdateHandler
from py.routes.model_route_registrar import COMMON_ROUTE_DEFINITIONS, ModelRouteRegistrar
from py.services.model_update_service import ModelUpdateRecord, ModelVersionRecord
from py.services.service_registry import ServiceRegistry


def _version(version_id, name, released, *, in_library=False, base="Illustrious", **extra):
    return ModelVersionRecord(
        version_id=version_id,
        name=name,
        base_model=base,
        released_at=released,
        size_bytes=100_000_000,
        preview_url=None,
        is_in_library=in_library,
        should_ignore=False,
        usage_control="Download",
        file_count=1,
        **extra,
    )


def _item(model_id, version_id, base="Illustrious", folder="styles"):
    return {
        "file_path": f"D:/models/loras/{folder}/m{model_id}.safetensors",
        "file_name": f"m{model_id}",
        "folder": folder,
        "model_name": f"Model {model_id}",
        "base_model": base,
        "size": 100_000_000,
        "preview_url": "",
        "preview_nsfw_level": 0,
        "civitai": {"id": version_id, "modelId": model_id, "model": {"name": f"Model {model_id}"}},
    }


class FakeScanner:
    def __init__(self, items):
        self.cache = SimpleNamespace(raw_data=items, version_index={})
        self.calls = []

    async def get_cached_data(self, *args, **kwargs):
        self.calls.append(("get_cached_data", args, kwargs))
        return self.cache

    def is_cancelled(self):
        return False

    def __getattr__(self, name):  # any other scanner call is a failure
        raise AssertionError(f"scanner.{name} must not be called by the overview")


class ReadOnlyUpdateService:
    """Only get_records_bulk is allowed; anything else fails the test."""

    def __init__(self, records):
        self.records = records
        self.calls = []

    async def get_records_bulk(self, model_type, model_ids):
        self.calls.append(("get_records_bulk", model_type, list(model_ids)))
        return {mid: rec for mid, rec in self.records.items() if mid in set(model_ids)}

    def __getattr__(self, name):
        raise AssertionError(f"update_service.{name} must not be called by the overview")


class FakeHistory:
    def __init__(self, downloaded):
        self.downloaded = downloaded
        self.calls = []

    async def get_downloaded_version_ids_bulk(self, model_type, model_ids):
        self.calls.append((model_type, list(model_ids)))
        return {mid: set(v) for mid, v in self.downloaded.items()}

    def __getattr__(self, name):
        raise AssertionError(f"history.{name} must not be called by the overview")


def _provider_must_not_be_used(*_args, **_kwargs):
    raise AssertionError("the overview must not select a metadata provider (no Civitai)")


def _handler(model_type, items, records, settings=None):
    service = SimpleNamespace(model_type=model_type, scanner=FakeScanner(items))
    update_service = ReadOnlyUpdateService(records)
    values = settings or {}
    handler = ModelUpdateHandler(
        service=service,
        update_service=update_service,
        metadata_provider_selector=_provider_must_not_be_used,
        settings_service=SimpleNamespace(get=lambda key, default=None: values.get(key, default)),
        logger=logging.getLogger(__name__),
    )
    return handler, service, update_service


@pytest.fixture
def history(monkeypatch):
    fake = FakeHistory({})

    async def factory():
        return fake

    monkeypatch.setattr(
        ServiceRegistry, "get_downloaded_version_history_service", staticmethod(factory)
    )
    return fake


def _request(path="/api/lm/loras/updates/overview"):
    return make_mocked_request("GET", path)


async def _call(handler, path="/api/lm/loras/updates/overview"):
    response = await handler.get_updates_overview(_request(path))
    assert response.status == 200
    return json.loads(response.text)


def test_route_is_registered_as_get_next_to_the_other_update_routes():
    definitions = [d for d in COMMON_ROUTE_DEFINITIONS if d.handler_name == "get_updates_overview"]
    assert len(definitions) == 1
    assert definitions[0].method == "GET"
    assert definitions[0].path_template == "/api/lm/{prefix}/updates/overview"


@pytest.mark.parametrize(
    "prefix, model_type",
    [("loras", "lora"), ("checkpoints", "checkpoint"), ("embeddings", "embedding")],
)
async def test_each_prefix_routes_to_its_own_handler(prefix, model_type, history):
    app = web.Application()
    registrar = ModelRouteRegistrar(app)
    handlers = {}
    for p, t in (("loras", "lora"), ("checkpoints", "checkpoint"), ("embeddings", "embedding")):
        handler, _service, update_service = _handler(t, [_item(1, 10)], {})
        handlers[p] = (handler, update_service)
        registrar.add_prefixed_route(
            "GET", "/api/lm/{prefix}/updates/overview", p, handler.get_updates_overview
        )

    request = make_mocked_request("GET", f"/api/lm/{prefix}/updates/overview", app=app)
    match = await app.router.resolve(request)
    response = await match.handler(request)
    payload = json.loads(response.text)
    assert payload["modelType"] == model_type
    handler, update_service = handlers[prefix]
    assert update_service.calls == [("get_records_bulk", model_type, [1])]
    for other, (_h, other_service) in handlers.items():
        if other != prefix:
            assert other_service.calls == []


async def test_overview_reads_records_in_bulk_and_classifies(history):
    records = {
        1: ModelUpdateRecord(
            model_type="lora",
            model_id=1,
            versions=[
                _version(10, "v1", "2026-01-01T00:00:00Z", in_library=True),
                _version(11, "v2", "2026-02-01T00:00:00Z"),
            ],
            last_checked_at=1_760_000_000.0,
            should_ignore_model=False,
        )
    }
    handler, service, update_service = _handler("lora", [_item(1, 10), _item(2, 20)], records)
    payload = await _call(handler)

    assert update_service.calls == [("get_records_bulk", "lora", [1, 2])]
    assert history.calls == [("lora", [1, 2])]
    assert payload["success"] is True
    assert payload["totals"]["likely"] == 1
    assert payload["unchecked"] == 1  # model 2 has no record: not "up to date"
    group = payload["groups"][0]
    assert group["modelId"] == 1
    assert group["candidates"][0]["versionId"] == 11
    assert group["candidates"][0]["confidence"] == "likely"


async def test_stale_in_library_flag_is_overridden_by_the_scanner(history):
    records = {
        2999795: ModelUpdateRecord(
            model_type="checkpoint",
            model_id=2999795,
            versions=[
                _version(3402628, "v1.0", "2026-10-13T10:37:24.563Z", in_library=True),
                _version(3425724, "v2.0", "2026-10-24T04:51:22.940Z", in_library=False),
            ],
            last_checked_at=1_760_000_000.0,
            should_ignore_model=False,
        )
    }
    handler, *_ = _handler("checkpoint", [_item(2999795, 3425724)], records)
    payload = await _call(handler, "/api/lm/checkpoints/updates/overview")
    assert payload["groups"] == []
    assert payload["totals"]["upToDate"] == 1


async def test_download_history_hides_previously_downloaded_versions(history):
    history.downloaded = {1: [11]}
    records = {
        1: ModelUpdateRecord(
            model_type="lora",
            model_id=1,
            versions=[
                _version(10, "v1", "2026-01-01T00:00:00Z"),
                _version(11, "v2", "2026-02-01T00:00:00Z"),
            ],
            last_checked_at=1.0,
            should_ignore_model=False,
        )
    }
    handler, *_ = _handler("lora", [_item(1, 10)], records)
    payload = await _call(handler)
    entry = payload["groups"][0]["candidates"][0]
    assert entry["hasBeenDownloaded"] is True
    assert entry["hiddenBecause"] == ["already_downloaded"]
    assert payload["totals"]["hidden"] == 1


async def test_settings_hide_paid_and_early_access_by_default(history):
    records = {
        1: ModelUpdateRecord(
            model_type="lora",
            model_id=1,
            versions=[
                _version(10, "v1", "2026-01-01T00:00:00Z"),
                _version(11, "v2", "2026-02-01T00:00:00Z", is_paid=True),
            ],
            last_checked_at=1.0,
            should_ignore_model=False,
        )
    }
    handler, *_ = _handler(
        "lora", [_item(1, 10)], records, settings={"hide_paid_updates": True}
    )
    payload = await _call(handler)
    assert payload["settings"] == {"hideEarlyAccessUpdates": False, "hidePaidUpdates": True}
    assert payload["groups"][0]["candidates"][0]["hiddenBecause"] == ["paid"]


async def test_ignored_model_is_reported_not_dropped(history):
    records = {
        1: ModelUpdateRecord(
            model_type="lora",
            model_id=1,
            versions=[
                _version(10, "v1", "2026-01-01T00:00:00Z"),
                _version(11, "v2", "2026-02-01T00:00:00Z"),
            ],
            last_checked_at=1.0,
            should_ignore_model=True,
        )
    }
    handler, *_ = _handler("lora", [_item(1, 10)], records)
    payload = await _call(handler)
    group = payload["groups"][0]
    assert group["isIgnored"] is True
    assert group["tier"] == "hidden"


async def test_empty_library_makes_no_database_calls(history):
    handler, _service, update_service = _handler("lora", [], {})
    payload = await _call(handler)
    assert update_service.calls == []
    assert history.calls == []
    assert payload["groups"] == []
    assert payload["unchecked"] == 0


async def test_history_failure_does_not_break_the_overview(monkeypatch):
    async def broken():
        raise RuntimeError("history db locked")

    monkeypatch.setattr(
        ServiceRegistry, "get_downloaded_version_history_service", staticmethod(broken)
    )
    records = {
        1: ModelUpdateRecord(
            model_type="lora",
            model_id=1,
            versions=[_version(10, "v1", "2026-01-01T00:00:00Z"), _version(11, "v2", "2026-02-01T00:00:00Z")],
            last_checked_at=1.0,
            should_ignore_model=False,
        )
    }
    handler, *_ = _handler("lora", [_item(1, 10)], records)
    payload = await _call(handler)
    assert payload["totals"]["likely"] == 1
