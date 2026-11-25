"""Per-file ``update_available`` flag with read-time ownership (fork, Part C).

Reproduces the stale-flag false positive: the library owns v1.0 and v2.0 of
the same model on the same base, but the persisted ``is_in_library`` flag of
v2.0 is still False (the file was added outside LoRA Manager's download
path). The old flag then offered v2.0 as an "update" for the v1.0 card.
"""

from __future__ import annotations

import time
from typing import Any, Dict, List

import pytest

from py.services.base_model_service import BaseModelService, _with_owned_versions
from py.services.model_query import ModelCacheRepository, ModelFilterSet, SearchStrategy
from py.services.model_update_service import ModelUpdateRecord, ModelVersionRecord
from py.utils.models import BaseModelMetadata


class _Settings:
    def __init__(self, values: Dict[str, Any] | None = None) -> None:
        self.values = {"version_grouping": "same_base", **(values or {})}

    def get(self, key: str, default: Any = None) -> Any:
        return self.values.get(key, default)


class _Service(BaseModelService):
    async def format_response(self, model_data):
        return model_data


class _Cache:
    def __init__(self, items: List[Dict[str, Any]]) -> None:
        self.raw_data = items


class _Scanner:
    def __init__(self, items: List[Dict[str, Any]]) -> None:
        self.cache = _Cache(items)

    async def get_cached_data(self, *_a: Any, **_k: Any) -> _Cache:
        return self.cache


class _Updates:
    def __init__(self, records: Dict[int, ModelUpdateRecord]) -> None:
        self.records = records

    async def get_records_bulk(self, model_type: str, model_ids: List[int]):
        return {mid: self.records[mid] for mid in model_ids if mid in self.records}


def _version(version_id: int, name: str, base: str, *, owned: bool, ignore: bool = False) -> ModelVersionRecord:
    return ModelVersionRecord(
        version_id=version_id,
        name=name,
        base_model=base,
        released_at=None,
        size_bytes=None,
        preview_url=None,
        is_in_library=owned,
        should_ignore=ignore,
        usage_control="Download",
    )


def _item(name: str, model_id: int, version_id: int, base: str) -> Dict[str, Any]:
    return {
        "model_name": name,
        "file_path": f"D:/loras/{name}.safetensors",
        "base_model": base,
        "civitai": {"modelId": model_id, "id": version_id, "baseModel": base},
    }


ELDREDA = 7000
V1_ANIMA, V2_ANIMA, V1_IL, V2_REMAP, V1_REMAP = 7001, 7002, 7003, 7005, 7004


def _eldreda_record(*extra: ModelVersionRecord) -> ModelUpdateRecord:
    return ModelUpdateRecord(
        model_type="lora",
        model_id=ELDREDA,
        versions=[
            _version(V1_ANIMA, "v1.0 Anima", "Anima", owned=True),
            # Stale: the file is on disk, the persisted flag says it is not.
            _version(V2_ANIMA, "v2.0 Anima", "Anima", owned=False),
            _version(V1_IL, "v1.0 Illustrious", "Illustrious", owned=True),
            _version(V1_REMAP, "v1.0 Remapped Anima 2.9B", "Anima 2.9B", owned=False),
            _version(V2_REMAP, "v2.0 Remapped Anima 2.9B", "Anima 2.9B", owned=False),
            *extra,
        ],
        last_checked_at=1.0,
        should_ignore_model=False,
    )


def _eldreda_library() -> List[Dict[str, Any]]:
    return [
        _item("eldreda_v1_anima", ELDREDA, V1_ANIMA, "Anima"),
        _item("eldreda_v2_anima", ELDREDA, V2_ANIMA, "Anima"),
        _item("eldreda_v1_il", ELDREDA, V1_IL, "Illustrious"),
    ]


def _service(items: List[Dict[str, Any]], records: Dict[int, ModelUpdateRecord], scanner: Any = None, **settings: Any) -> _Service:
    scanner = scanner if scanner is not None else _Scanner(items)
    config = _Settings(settings)
    return _Service(
        model_type="lora",
        scanner=scanner,
        metadata_class=BaseModelMetadata,
        cache_repository=ModelCacheRepository(scanner),
        filter_set=ModelFilterSet(config),
        search_strategy=SearchStrategy(),
        settings_provider=config,
        update_service=_Updates(records),  # type: ignore[arg-type]
    )


def _flags(annotated: List[Dict[str, Any]]) -> Dict[str, bool]:
    return {item["model_name"]: item["update_available"] for item in annotated}


def test_diagnosis_persisted_flag_alone_reports_a_false_update():
    record = _eldreda_record()
    # What the old code did for the v1.0 Anima card: threshold = highest
    # in-library Anima version by the persisted flag (v1.0), so v2.0 counts.
    assert record.has_update_for_base(V1_ANIMA, "Anima") is True


@pytest.mark.asyncio
async def test_eldreda_case_has_no_update_with_read_time_ownership():
    library = _eldreda_library()
    service = _service(library, {ELDREDA: _eldreda_record()})
    # The page only holds the v1.0 Anima card; ownership comes from the whole cache.
    annotated = await service.annotate_update_flags([library[0]])
    assert _flags(annotated) == {"eldreda_v1_anima": False}
    annotated = await service.annotate_update_flags(library)
    assert set(_flags(annotated).values()) == {False}


@pytest.mark.asyncio
async def test_a_real_newer_version_is_still_flagged():
    library = _eldreda_library()
    record = _eldreda_record(_version(7010, "v3.0 Anima", "Anima", owned=False))
    annotated = await _service(library, {ELDREDA: record}).annotate_update_flags(library)
    flags = _flags(annotated)
    assert flags["eldreda_v1_anima"] is True
    assert flags["eldreda_v2_anima"] is True
    assert flags["eldreda_v1_il"] is False


@pytest.mark.asyncio
async def test_ignored_versions_and_ignored_models_stay_hidden():
    library = _eldreda_library()
    record = _eldreda_record(_version(7010, "v3.0 Anima", "Anima", owned=False, ignore=True))
    annotated = await _service(library, {ELDREDA: record}).annotate_update_flags(library)
    assert set(_flags(annotated).values()) == {False}

    record = _eldreda_record(_version(7010, "v3.0 Anima", "Anima", owned=False))
    record.should_ignore_model = True
    annotated = await _service(library, {ELDREDA: record}).annotate_update_flags(library)
    assert set(_flags(annotated).values()) == {False}


@pytest.mark.asyncio
async def test_early_access_setting_still_applies():
    library = _eldreda_library()
    early = _version(7010, "v3.0 Anima", "Anima", owned=False)
    early.is_early_access = True
    record = _eldreda_record(early)
    hidden = await _service(library, {ELDREDA: record}, hide_early_access_updates=True).annotate_update_flags(library)
    assert set(_flags(hidden).values()) == {False}
    shown = await _service(library, {ELDREDA: record}).annotate_update_flags(library)
    assert _flags(shown)["eldreda_v1_anima"] is True


@pytest.mark.asyncio
async def test_no_record_means_no_update():
    library = _eldreda_library()
    annotated = await _service(library, {}).annotate_update_flags(library)
    assert set(_flags(annotated).values()) == {False}


@pytest.mark.asyncio
async def test_multiple_local_cards_per_version():
    library = _eldreda_library() + [_item("eldreda_v1_anima_fp8", ELDREDA, V1_ANIMA, "Anima")]
    annotated = await _service(library, {ELDREDA: _eldreda_record()}).annotate_update_flags(library)
    assert set(_flags(annotated).values()) == {False}


@pytest.mark.asyncio
async def test_unreadable_scanner_falls_back_to_the_persisted_flag():
    library = _eldreda_library()
    service = _service(library, {ELDREDA: _eldreda_record()}, scanner=object())
    annotated = await service.annotate_update_flags([library[0]])
    assert _flags(annotated) == {"eldreda_v1_anima": True}


@pytest.mark.asyncio
async def test_stored_record_is_never_mutated():
    record = _eldreda_record()
    library = _eldreda_library()
    await _service(library, {ELDREDA: record}).annotate_update_flags(library)
    assert [v.is_in_library for v in record.versions] == [True, False, True, False, False]


def test_overlay_returns_the_same_object_when_nothing_changes():
    record = _eldreda_record()
    assert _with_owned_versions(record, None) is record
    assert _with_owned_versions(record, {V1_ANIMA}) is record
    patched = _with_owned_versions(record, {V2_ANIMA})
    assert patched is not record
    assert [v.is_in_library for v in patched.versions][:2] == [True, True]


@pytest.mark.asyncio
async def test_annotation_cost_stays_small_on_a_library_sized_cache():
    # ~1150 LoRAs, 60 per page, every page model tracked.
    library = [_item(f"m{i}", 10_000 + i // 2, 20_000 + i, "Illustrious") for i in range(1150)]
    records = {
        10_000 + n: ModelUpdateRecord(
            model_type="lora",
            model_id=10_000 + n,
            versions=[
                _version(20_000 + 2 * n, "a", "Illustrious", owned=True),
                _version(20_000 + 2 * n + 1, "b", "Illustrious", owned=False),
            ],
            last_checked_at=1.0,
            should_ignore_model=False,
        )
        for n in range(575)
    }
    page = library[:60]
    with_scanner = _service(library, records)
    without_scanner = _service(library, records, scanner=object())

    async def run(service):
        await service.annotate_update_flags(page)

    new = []
    old = []
    for _ in range(5):
        start = time.perf_counter()
        await run(with_scanner)
        new.append(time.perf_counter() - start)
        start = time.perf_counter()
        await run(without_scanner)
        old.append(time.perf_counter() - start)
    # The owned-version index adds one pass over the cache: a few ms at most.
    assert min(new) - min(old) < 0.01
    annotated = await with_scanner.annotate_update_flags(page)
    assert all(item["update_available"] is False for item in annotated)
