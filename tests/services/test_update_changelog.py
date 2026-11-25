"""Changelog (version description) and file-format data of update candidates.

Covers the persistence side in ``ModelUpdateService`` (extraction from the
Civitai model response, keeping the data across refreshes, the additive
migration of an old-schema database) and the overview payload built by
``update_classifier`` (plain text, length cap, format / precision). No
network: the provider is a fake and every database lives in ``tmp_path``.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

import pytest

from py.services.model_update_service import (
    ModelUpdateRecord,
    ModelUpdateService,
    ModelVersionRecord,
)
from py.services.update_classifier import (
    DESCRIPTION_MAX_CHARS,
    build_updates_overview,
    description_to_text,
)

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


def remote_entry(version_id: int, **extra):
    entry = {
        "id": version_id,
        "name": f"v{version_id}",
        "baseModel": "Illustrious",
        "publishedAt": "2026-02-01T00:00:00Z",
        "files": [
            {
                "type": "Model",
                "primary": True,
                "sizeKB": 1024,
                "metadata": {"format": "SafeTensor", "fp": "fp16", "size": "pruned"},
            },
            {"type": "Training Data", "primary": False, "sizeKB": 10, "metadata": {"format": "Other"}},
            {
                "type": "Model",
                "primary": False,
                "sizeKB": 2048,
                "metadata": {"format": "GGUF", "fp": "fp8", "size": "full"},
            },
        ],
        "images": [],
    }
    entry.update(extra)
    return entry


@pytest.fixture
def service(tmp_path):
    return ModelUpdateService(str(tmp_path / "updates.sqlite"))


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------


def test_extracts_description_and_weight_file_metadata(service):
    versions = service._extract_versions(
        {"modelVersions": [remote_entry(11, description="<p>Better hands</p>")]}
    )
    assert versions is not None
    version = versions[0]
    assert version.description == "<p>Better hands</p>"
    files = json.loads(version.files_meta)
    # Only weight files, primary first, compact keys.
    assert files == [
        {"type": "Model", "format": "SafeTensor", "precision": "fp16", "size": "pruned", "sizeBytes": 1024 * 1024, "primary": True},
        {"type": "Model", "format": "GGUF", "precision": "fp8", "size": "full", "sizeBytes": 2048 * 1024, "primary": False},
    ]


def test_missing_description_and_files_stay_unknown(service):
    entry = remote_entry(12)
    entry.pop("files")
    version = service._extract_versions({"modelVersions": [entry]})[0]
    assert version.description is None
    assert version.files_meta is None


def test_description_is_capped_when_stored(service):
    huge = "x" * 100_000
    version = service._extract_versions({"modelVersions": [remote_entry(13, description=huge)]})[0]
    assert len(version.description) <= ModelUpdateService.DESCRIPTION_STORE_MAX_CHARS


def test_files_without_metadata_produce_null_fields(service):
    entry = remote_entry(14, files=[{"type": "Model", "primary": True, "sizeKB": 1}])
    version = service._extract_versions({"modelVersions": [entry]})[0]
    assert json.loads(version.files_meta) == [
        {"type": "Model", "format": None, "precision": None, "size": None, "sizeBytes": 1024, "primary": True}
    ]


# --------------------------------------------------------------------------
# Persistence across refreshes
# --------------------------------------------------------------------------


def test_round_trip_through_sqlite(service):
    version = service._extract_versions(
        {"modelVersions": [remote_entry(11, description="<b>New</b>")]}
    )[0]
    service._upsert_record(
        ModelUpdateRecord(
            model_type="lora", model_id=1, versions=[version], last_checked_at=1.0, should_ignore_model=False
        )
    )
    stored = service._get_record("lora", 1).versions[0]
    assert stored.description == "<b>New</b>"
    assert json.loads(stored.files_meta)[0]["format"] == "SafeTensor"


def test_refresh_without_the_data_keeps_the_stored_values(service):
    existing = ModelUpdateRecord(
        model_type="lora",
        model_id=1,
        versions=[
            ModelVersionRecord(
                version_id=11, name="v11", base_model="Illustrious", released_at=None, size_bytes=None,
                preview_url=None, is_in_library=False, should_ignore=False,
                description="old notes", files_meta='[{"type": "Model"}]',
            )
        ],
        last_checked_at=1.0,
        should_ignore_model=False,
    )
    entry = remote_entry(11)
    entry.pop("files")
    remote = service._extract_versions({"modelVersions": [entry]})
    record = service._build_record_from_remote("lora", 1, [], remote, existing, 2.0)
    assert record.versions[0].description == "old notes"
    assert record.versions[0].files_meta == '[{"type": "Model"}]'


def test_refresh_with_new_data_replaces_the_stored_values(service):
    existing = ModelUpdateRecord(
        model_type="lora",
        model_id=1,
        versions=[
            ModelVersionRecord(
                version_id=11, name="v11", base_model="Illustrious", released_at=None, size_bytes=None,
                preview_url=None, is_in_library=False, should_ignore=True, description="old",
            )
        ],
        last_checked_at=1.0,
        should_ignore_model=False,
    )
    remote = service._extract_versions({"modelVersions": [remote_entry(11, description="new")]})
    record = service._build_record_from_remote("lora", 1, [], remote, existing, 2.0)
    assert record.versions[0].description == "new"
    # The ignore flag is still carried over.
    assert record.versions[0].should_ignore is True


# --------------------------------------------------------------------------
# Migration of an old-schema database
# --------------------------------------------------------------------------


def _old_schema_db(path):
    """The schema of the last release before the changelog columns."""

    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE model_update_status ("
        "model_id INTEGER PRIMARY KEY, model_type TEXT NOT NULL, "
        "last_checked_at REAL, should_ignore_model INTEGER NOT NULL DEFAULT 0)"
    )
    conn.execute(
        """
        CREATE TABLE model_update_versions (
            model_id INTEGER NOT NULL,
            version_id INTEGER NOT NULL,
            sort_index INTEGER NOT NULL DEFAULT 0,
            name TEXT, base_model TEXT, released_at TEXT, size_bytes INTEGER, preview_url TEXT,
            is_in_library INTEGER NOT NULL DEFAULT 0, should_ignore INTEGER NOT NULL DEFAULT 0,
            early_access_ends_at TEXT, is_early_access INTEGER NOT NULL DEFAULT 0,
            usage_control TEXT, paid_access TEXT, is_paid INTEGER NOT NULL DEFAULT 0,
            file_count INTEGER, gate_lapsed_at TEXT, price_buzz INTEGER, list_price_buzz INTEGER,
            generation_price_buzz INTEGER, accepts_blue_buzz INTEGER NOT NULL DEFAULT 0,
            price_sale_ends_at TEXT, price_checked_at REAL, price_check_attempted_at REAL,
            PRIMARY KEY (model_id, version_id)
        )
        """
    )
    conn.execute(
        "INSERT INTO model_update_status (model_id, model_type, last_checked_at, should_ignore_model) "
        "VALUES (5, 'lora', 3.0, 1)"
    )
    conn.execute(
        "INSERT INTO model_update_versions (model_id, version_id, name, base_model, is_in_library, should_ignore, file_count) "
        "VALUES (5, 51, 'v1', 'Illustrious', 1, 0, 1), (5, 52, 'v2', 'Illustrious', 0, 1, 1)"
    )
    conn.commit()
    conn.close()


def test_old_schema_database_gains_the_columns_and_keeps_its_rows(tmp_path):
    db_path = tmp_path / "updates.sqlite"
    _old_schema_db(db_path)

    service = ModelUpdateService(str(db_path))
    with sqlite3.connect(db_path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(model_update_versions)")}
    assert {"description", "files_meta"} <= columns

    record = service._get_record("lora", 5)
    assert record is not None
    assert record.should_ignore_model is True
    by_id = {v.version_id: v for v in record.versions}
    assert by_id[51].name == "v1" and by_id[51].is_in_library is True
    assert by_id[52].should_ignore is True
    assert by_id[51].description is None and by_id[51].files_meta is None


def test_migration_is_idempotent(tmp_path):
    db_path = tmp_path / "updates.sqlite"
    _old_schema_db(db_path)
    ModelUpdateService(str(db_path))
    # A second start (and a third) must not fail or duplicate anything.
    ModelUpdateService(str(db_path))
    service = ModelUpdateService(str(db_path))
    assert len(service._get_record("lora", 5).versions) == 2


# --------------------------------------------------------------------------
# Overview payload
# --------------------------------------------------------------------------


def test_description_to_text_strips_markup_and_scripts():
    html = (
        "<h2>What&#39;s new</h2><p>Fixed <b>hands</b> &amp; eyes.<br>Trained longer.</p>"
        "<script>alert('x')</script><style>p{}</style>"
        "<ul><li>one</li><li>two</li></ul><img src=x onerror=alert(1)>"
        '<a href="javascript:alert(1)">link</a>'
    )
    text = description_to_text(html)
    assert "<" not in text and ">" not in text
    assert "alert" not in text
    assert "What's new" in text
    assert "Fixed hands & eyes.\nTrained longer." in text
    assert "- one\n- two" in text
    assert "link" in text


def test_description_to_text_caps_and_handles_empty():
    assert description_to_text(None) is None
    assert description_to_text("   <p> </p> ") is None
    long_text = description_to_text("word " * 2000)
    assert len(long_text) <= DESCRIPTION_MAX_CHARS + 1
    assert long_text.endswith("\u2026")


def _overview(versions):
    items = [
        {
            "file_path": "D:/models/loras/m1.safetensors",
            "file_name": "m1",
            "folder": "",
            "base_model": "Illustrious",
            "size": 1,
            "civitai": {"id": 10, "modelId": 1, "model": {"name": "Ink"}, "publishedAt": "2026-01-01T00:00:00Z"},
        }
    ]
    record = ModelUpdateRecord(
        model_type="lora", model_id=1, versions=versions, last_checked_at=1_760_000_000.0, should_ignore_model=False
    )
    return build_updates_overview(model_type="lora", local_items=items, records={1: record}, now=NOW)


def _v(version_id, **extra):
    return ModelVersionRecord(
        version_id=version_id, name=f"v{version_id}", base_model="Illustrious",
        released_at="2026-02-01T00:00:00Z" if version_id != 10 else "2026-01-01T00:00:00Z",
        size_bytes=1, preview_url=None, is_in_library=version_id == 10, should_ignore=False,
        usage_control="Download", file_count=1, **extra,
    )


def test_candidate_payload_carries_changelog_and_format():
    files = json.dumps([
        {"type": "Model", "format": "SafeTensor", "precision": "fp16", "size": "pruned", "sizeBytes": 5, "primary": True},
        {"type": "Model", "format": "GGUF", "precision": "fp8", "size": "full", "sizeBytes": 3, "primary": False},
    ])
    payload = _overview([_v(10), _v(11, description="<p>Sharper</p>", files_meta=files)])
    entry = payload["groups"][0]["candidates"][0]
    assert entry["description"] == "Sharper"
    assert entry["fileFormat"] == "SafeTensor"
    assert entry["precision"] == "fp16"
    assert entry["files"] == [
        {"type": "Model", "format": "SafeTensor", "precision": "fp16", "size": "pruned", "sizeBytes": 5, "primary": True},
        {"type": "Model", "format": "GGUF", "precision": "fp8", "size": "full", "sizeBytes": 3, "primary": False},
    ]


def test_candidate_payload_is_empty_until_the_next_check():
    payload = _overview([_v(10), _v(11)])
    entry = payload["groups"][0]["candidates"][0]
    assert entry["description"] is None
    assert entry["fileFormat"] is None
    assert entry["precision"] is None
    assert entry["files"] == []


def test_broken_files_meta_is_ignored():
    payload = _overview([_v(10), _v(11, files_meta="{not json")])
    entry = payload["groups"][0]["candidates"][0]
    assert entry["files"] == [] and entry["fileFormat"] is None
