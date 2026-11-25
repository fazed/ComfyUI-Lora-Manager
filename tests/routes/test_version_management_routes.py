"""Version management, read-only parts: old-versions endpoint and localFiles.

``GET /api/lm/{prefix}/updates/old-versions`` and the ``localFiles`` field of
``GET /api/lm/{prefix}/updates/versions/{model_id}``. Both read the scanner
cache (and the persisted records); no Civitai call, no write.
"""

from __future__ import annotations

import json
import logging
from types import SimpleNamespace

import pytest
from aiohttp.test_utils import make_mocked_request

from py.routes.handlers.model_handlers import ModelUpdateHandler
from py.routes.model_route_registrar import COMMON_ROUTE_DEFINITIONS
from py.services.model_update_service import ModelUpdateRecord, ModelVersionRecord
from py.services.service_registry import ServiceRegistry
from py.services.update_classifier import build_old_versions
from py.utils.request_guard import READ_ONLY_GET_ROUTES


def _version(version_id, name, released, base="Anima", in_library=False):
    return ModelVersionRecord(
        version_id=version_id,
        name=name,
        base_model=base,
        released_at=released,
        size_bytes=1000,
        preview_url=None,
        is_in_library=in_library,
        should_ignore=False,
        usage_control="Download",
    )


def _item(name, model_id, version_id, base="Anima", size=1000, folder="chars", released=None, version_name=None):
    civitai = {"modelId": model_id, "id": version_id, "model": {"name": "Eldreda"}}
    if released:
        civitai["publishedAt"] = released
    if version_name:
        civitai["name"] = version_name
    return {
        "file_path": f"D:/loras/{folder}/{name}.safetensors",
        "file_name": name,
        "folder": folder,
        "base_model": base,
        "size": size,
        "modified": 1_700_000_000.0,
        "preview_url": "",
        "civitai": civitai,
    }


RECORD = ModelUpdateRecord(
    model_type="lora",
    model_id=7000,
    versions=[
        _version(7001, "v1.0 Anima", "2025-01-01T00:00:00Z", in_library=True),
        _version(7002, "v2.0 Anima", "2025-06-01T00:00:00Z"),
        _version(7003, "v1.0 Illustrious", "2025-01-02T00:00:00Z", base="Illustrious", in_library=True),
        _version(7004, "v1.0 Remapped", "2025-07-01T00:00:00Z", base="Anima 2.9B"),
    ],
    last_checked_at=1.0,
    should_ignore_model=False,
)


# ---------------------------------------------------------------------------
# build_old_versions (pure)
# ---------------------------------------------------------------------------


def test_lists_only_lines_with_more_than_one_owned_version():
    items = [
        _item("eldreda_v1", 7000, 7001),
        _item("eldreda_v2", 7000, 7002, size=2000),
        _item("eldreda_il", 7000, 7003, base="Illustrious"),
        _item("solo", 8000, 8001),
        _item("no_civitai", 0, 0) | {"civitai": {}},
    ]
    payload = build_old_versions(model_type="lora", local_items=items, records={7000: RECORD})

    assert payload["totals"] == {"groups": 1, "olderVersions": 1, "olderFiles": 1, "olderBytes": 1000}
    [group] = payload["groups"]
    assert group["key"] == "7000:anima"
    assert group["baseModel"] == "Anima"
    assert group["modelName"] == "Eldreda"
    assert group["newest"]["versionId"] == 7002
    assert group["newest"]["name"] == "v2.0 Anima"
    assert [v["versionId"] for v in group["older"]] == [7001]
    [old_file] = group["older"][0]["files"]
    assert old_file["filePath"] == "D:/loras/chars/eldreda_v1.safetensors"
    assert old_file["folder"] == "chars"
    assert old_file["sizeBytes"] == 1000


def test_newest_is_by_release_date_not_by_id():
    items = [_item("a", 1, 50), _item("b", 1, 40)]
    record = ModelUpdateRecord(
        model_type="lora",
        model_id=1,
        versions=[_version(50, "old upload", "2024-01-01T00:00:00Z"), _version(40, "newer", "2025-01-01T00:00:00Z")],
        last_checked_at=1.0,
        should_ignore_model=False,
    )
    [group] = build_old_versions(model_type="lora", local_items=items, records={1: record})["groups"]
    assert group["newest"]["versionId"] == 40
    assert [v["versionId"] for v in group["older"]] == [50]


def test_local_dates_and_id_fallback_without_records():
    items = [
        _item("a", 1, 10, released="2024-05-01T00:00:00Z", version_name="v1"),
        _item("b", 1, 11, released="2024-09-01T00:00:00Z", version_name="v2"),
        _item("c", 2, 21),
        _item("d", 2, 22),
    ]
    payload = build_old_versions(model_type="lora", local_items=items, records={})
    newest = {g["modelId"]: g["newest"]["versionId"] for g in payload["groups"]}
    assert newest == {1: 11, 2: 22}
    assert payload["groups"][0]["newest"]["name"] == "v2"


def test_variants_of_one_version_are_not_old_versions():
    items = [_item("v1", 1, 10), _item("v1_fp8", 1, 10, size=500)]
    assert build_old_versions(model_type="lora", local_items=items)["groups"] == []


def test_several_files_of_an_older_version_are_all_listed():
    items = [_item("v2", 1, 11), _item("v1", 1, 10), _item("v1_fp8", 1, 10, size=500)]
    [group] = build_old_versions(model_type="lora", local_items=items)["groups"]
    [older] = group["older"]
    assert [f["fileName"] for f in older["files"]] == ["v1", "v1_fp8"]
    assert older["sizeBytes"] == 1500


def test_base_lines_are_compared_case_insensitively():
    items = [_item("a", 1, 10, base="Anima"), _item("b", 1, 11, base="anima ")]
    assert len(build_old_versions(model_type="lora", local_items=items)["groups"]) == 1


# ---------------------------------------------------------------------------
# Route + handler
# ---------------------------------------------------------------------------


class _Scanner:
    def __init__(self, items):
        self.cache = SimpleNamespace(raw_data=items, version_index={})

    async def get_cached_data(self, *args, **kwargs):
        return self.cache

    def __getattr__(self, name):
        raise AssertionError(f"scanner.{name} must not be called")


class _Updates:
    def __init__(self, records):
        self.records = records

    async def get_records_bulk(self, model_type, model_ids):
        return {mid: rec for mid, rec in self.records.items() if mid in set(model_ids)}

    async def get_record(self, model_type, model_id):
        return self.records.get(model_id)

    def __getattr__(self, name):
        raise AssertionError(f"update_service.{name} must not be called")


def _no_provider(*_a, **_k):
    raise AssertionError("no Civitai provider may be selected")


def _handler(items, records):
    return ModelUpdateHandler(
        service=SimpleNamespace(model_type="lora", scanner=_Scanner(items)),
        update_service=_Updates(records),
        metadata_provider_selector=_no_provider,
        settings_service=SimpleNamespace(get=lambda key, default=None: default),
        logger=logging.getLogger(__name__),
    )


@pytest.fixture(autouse=True)
def _history(monkeypatch):
    class History:
        async def get_downloaded_version_ids(self, model_type, model_id):
            return []

    async def factory():
        return History()

    monkeypatch.setattr(ServiceRegistry, "get_downloaded_version_history_service", staticmethod(factory))


def test_old_versions_route_is_registered_and_classified_read_only():
    [definition] = [d for d in COMMON_ROUTE_DEFINITIONS if d.handler_name == "get_old_versions"]
    assert definition.method == "GET"
    assert definition.path_template == "/api/lm/{prefix}/updates/old-versions"
    assert "/api/lm/{prefix}/updates/old-versions" in READ_ONLY_GET_ROUTES


@pytest.mark.asyncio
async def test_old_versions_handler_reads_cache_and_records_only():
    items = [_item("eldreda_v1", 7000, 7001), _item("eldreda_v2", 7000, 7002)]
    handler = _handler(items, {7000: RECORD})
    response = await handler.get_old_versions(make_mocked_request("GET", "/api/lm/loras/updates/old-versions"))
    body = json.loads(response.text)
    assert response.status == 200
    assert body["modelType"] == "lora"
    assert body["groups"][0]["older"][0]["versionId"] == 7001


@pytest.mark.asyncio
async def test_versions_endpoint_lists_local_files_per_version_at_read_time():
    items = [
        _item("eldreda_v1", 7000, 7001),
        _item("eldreda_v1_fp8", 7000, 7001, size=500),
        _item("eldreda_v2", 7000, 7002),  # persisted flag says not in library
        _item("eldreda_il", 7000, 7003, base="Illustrious"),
        _item("other_model", 9000, 9001),
    ]
    handler = _handler(items, {7000: RECORD})
    request = make_mocked_request("GET", "/api/lm/loras/updates/versions/7000", match_info={"model_id": "7000"})
    body = json.loads((await handler.get_model_versions(request)).text)
    files = {v["versionId"]: [f["fileName"] for f in v["localFiles"]] for v in body["record"]["versions"]}
    assert files == {
        7001: ["eldreda_v1", "eldreda_v1_fp8"],
        7002: ["eldreda_v2"],
        7003: ["eldreda_il"],
        7004: [],
    }
    v1 = next(v for v in body["record"]["versions"] if v["versionId"] == 7001)
    assert v1["localFiles"][0] == {
        "filePath": "D:/loras/chars/eldreda_v1.safetensors",
        "fileName": "eldreda_v1",
        "folder": "chars",
        "baseModel": "Anima",
        "sizeBytes": 1000,
        "modified": 1_700_000_000.0,
    }
    # The existing fields are unchanged (persisted flag, additive change only).
    v2 = next(v for v in body["record"]["versions"] if v["versionId"] == 7002)
    assert v2["isInLibrary"] is False
