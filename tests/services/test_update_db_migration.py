"""Durability of the update database schema migrations.

Every test builds an old-schema database in ``tmp_path``, lets
``ModelUpdateService`` initialise it, and then reopens the file with a fresh
``sqlite3`` connection: what counts is what actually reached the disk, not what
the service's own (now closed) connection saw.
"""

from __future__ import annotations

import sqlite3

import pytest

from py.services.model_update_service import ModelUpdateService


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


def _tables(path) -> set[str]:
    conn = sqlite3.connect(path)
    try:
        return {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
    finally:
        conn.close()


def _table_info(path, table: str) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(f"PRAGMA table_info({table})").fetchall()
    finally:
        conn.close()


def _columns(path, table: str) -> set[str]:
    return {row[1] for row in _table_info(path, table)}


def _primary_key(path, table: str) -> list[str]:
    info = [row for row in _table_info(path, table) if row[5]]
    return [row[1] for row in sorted(info, key=lambda row: row[5])]


def _rows(path, sql: str) -> list[tuple]:
    conn = sqlite3.connect(path)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


def _schema_sql(path) -> list[tuple]:
    return _rows(
        path,
        "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
    )


def _current_version_columns(tmp_path) -> set[str]:
    """The columns a brand-new database gets: the schema the code defines."""

    fresh = tmp_path / "fresh.sqlite"
    ModelUpdateService(str(fresh))
    return _columns(fresh, "model_update_versions")


def _create_status_table(conn: sqlite3.Connection, *, unique: bool = True) -> None:
    key = "INTEGER PRIMARY KEY" if unique else "INTEGER NOT NULL"
    conn.execute(
        f"CREATE TABLE model_update_status ("
        f"model_id {key}, model_type TEXT NOT NULL, "
        f"last_checked_at REAL, should_ignore_model INTEGER NOT NULL DEFAULT 0)"
    )


# A legacy versions table keyed on ``version_id`` alone, carrying every column
# the later releases added except the changelog ones (``description`` and
# ``files_meta``).
_LEGACY_VERSIONS_FULL = """
    CREATE TABLE model_update_versions (
        version_id INTEGER PRIMARY KEY,
        model_id INTEGER NOT NULL,
        sort_index INTEGER NOT NULL DEFAULT 0,
        name TEXT, base_model TEXT, released_at TEXT, size_bytes INTEGER, preview_url TEXT,
        is_in_library INTEGER NOT NULL DEFAULT 0, should_ignore INTEGER NOT NULL DEFAULT 0,
        early_access_ends_at TEXT, is_early_access INTEGER NOT NULL DEFAULT 0,
        usage_control TEXT, paid_access TEXT, is_paid INTEGER NOT NULL DEFAULT 0,
        file_count INTEGER, gate_lapsed_at TEXT, price_buzz INTEGER, list_price_buzz INTEGER,
        generation_price_buzz INTEGER, accepts_blue_buzz INTEGER NOT NULL DEFAULT 0,
        price_sale_ends_at TEXT, price_checked_at REAL, price_check_attempted_at REAL,
        FOREIGN KEY(model_id) REFERENCES model_update_status(model_id) ON DELETE CASCADE
    )
"""

# The very first shape of the table: ``version_id`` alone as the key and none
# of the columns that later releases added.
_LEGACY_VERSIONS_MINIMAL = """
    CREATE TABLE model_update_versions (
        version_id INTEGER PRIMARY KEY,
        model_id INTEGER NOT NULL,
        name TEXT,
        base_model TEXT,
        released_at TEXT,
        size_bytes INTEGER,
        preview_url TEXT,
        is_in_library INTEGER NOT NULL DEFAULT 0
    )
"""


def _legacy_full_db(path) -> None:
    conn = sqlite3.connect(path)
    _create_status_table(conn)
    conn.execute(_LEGACY_VERSIONS_FULL)
    conn.execute(
        "INSERT INTO model_update_status (model_id, model_type, last_checked_at, should_ignore_model) "
        "VALUES (5, 'lora', 3.0, 1), (6, 'checkpoint', 4.0, 0)"
    )
    conn.execute(
        "INSERT INTO model_update_versions (version_id, model_id, sort_index, name, base_model, "
        "is_in_library, should_ignore, usage_control, is_paid, file_count, price_buzz) VALUES "
        "(51, 5, 0, 'v1', 'Illustrious', 1, 0, 'Download', 0, 1, NULL), "
        "(52, 5, 1, 'v2', 'Illustrious', 0, 1, 'Generation', 1, 2, 300), "
        "(61, 6, 0, 'c1', 'SDXL 1.0', 1, 0, NULL, 0, 1, NULL)"
    )
    conn.commit()
    conn.close()


def _legacy_minimal_db(path) -> None:
    conn = sqlite3.connect(path)
    _create_status_table(conn)
    conn.execute(_LEGACY_VERSIONS_MINIMAL)
    conn.execute(
        "INSERT INTO model_update_status (model_id, model_type, last_checked_at, should_ignore_model) "
        "VALUES (5, 'lora', 3.0, 0)"
    )
    conn.execute(
        "INSERT INTO model_update_versions (version_id, model_id, name, base_model, size_bytes, "
        "preview_url, is_in_library) VALUES "
        "(51, 5, 'v1', 'Pony', 1000, 'http://example.invalid/a.png', 1), "
        "(52, 5, 'v2', 'Pony', 2000, NULL, 0)"
    )
    conn.commit()
    conn.close()


# --------------------------------------------------------------------------
# Composite primary key rebuild
# --------------------------------------------------------------------------


def test_primary_key_rebuild_reaches_the_disk(tmp_path):
    db_path = tmp_path / "updates.sqlite"
    _legacy_full_db(db_path)

    ModelUpdateService(str(db_path))

    # Reopened with a fresh connection: the rebuilt table is really there.
    tables = _tables(db_path)
    assert "model_update_versions" in tables
    assert "model_update_versions_legacy" not in tables
    assert "model_update_versions_new" not in tables
    assert _primary_key(db_path, "model_update_versions") == ["model_id", "version_id"]

    columns = _columns(db_path, "model_update_versions")
    assert {"description", "files_meta"} <= columns
    assert columns == _current_version_columns(tmp_path)

    rows = _rows(
        db_path,
        "SELECT model_id, version_id, sort_index, name, base_model, is_in_library, "
        "should_ignore, usage_control, is_paid, file_count, price_buzz, description, files_meta "
        "FROM model_update_versions ORDER BY version_id",
    )
    assert rows == [
        (5, 51, 0, "v1", "Illustrious", 1, 0, "Download", 0, 1, None, None, None),
        (5, 52, 1, "v2", "Illustrious", 0, 1, "Generation", 1, 2, 300, None, None),
        (6, 61, 0, "c1", "SDXL 1.0", 1, 0, None, 0, 1, None, None, None),
    ]
    assert _rows(
        db_path,
        "SELECT model_id, model_type, last_checked_at, should_ignore_model "
        "FROM model_update_status ORDER BY model_id",
    ) == [(5, "lora", 3.0, 1), (6, "checkpoint", 4.0, 0)]


def test_primary_key_rebuild_from_the_first_schema(tmp_path):
    """The legacy table also lacks every column the later releases added."""

    db_path = tmp_path / "updates.sqlite"
    _legacy_minimal_db(db_path)

    ModelUpdateService(str(db_path))

    tables = _tables(db_path)
    assert "model_update_versions" in tables
    assert "model_update_versions_legacy" not in tables
    assert "model_update_versions_new" not in tables
    assert _primary_key(db_path, "model_update_versions") == ["model_id", "version_id"]
    assert _columns(db_path, "model_update_versions") == _current_version_columns(tmp_path)

    rows = _rows(
        db_path,
        "SELECT model_id, version_id, sort_index, name, base_model, size_bytes, preview_url, "
        "is_in_library, should_ignore, usage_control, description, files_meta "
        "FROM model_update_versions ORDER BY version_id",
    )
    assert rows == [
        (5, 51, 0, "v1", "Pony", 1000, "http://example.invalid/a.png", 1, 0, None, None, None),
        (5, 52, 0, "v2", "Pony", 2000, None, 0, 0, None, None, None),
    ]


@pytest.mark.parametrize("builder", [_legacy_full_db, _legacy_minimal_db])
def test_primary_key_rebuild_is_idempotent(tmp_path, builder):
    db_path = tmp_path / "updates.sqlite"
    builder(db_path)

    ModelUpdateService(str(db_path))
    schema_after_first = _schema_sql(db_path)
    rows_after_first = _rows(
        db_path, "SELECT * FROM model_update_versions ORDER BY model_id, version_id"
    )

    # A second and a third start change nothing.
    ModelUpdateService(str(db_path))
    ModelUpdateService(str(db_path))
    assert _schema_sql(db_path) == schema_after_first
    assert (
        _rows(db_path, "SELECT * FROM model_update_versions ORDER BY model_id, version_id")
        == rows_after_first
    )


def test_service_reads_the_rebuilt_table(tmp_path):
    db_path = tmp_path / "updates.sqlite"
    _legacy_full_db(db_path)

    ModelUpdateService(str(db_path))
    # A fresh service on the migrated file sees every legacy version.
    service = ModelUpdateService(str(db_path))
    record = service._get_record("lora", 5)
    assert record is not None
    by_id = {v.version_id: v for v in record.versions}
    assert set(by_id) == {51, 52}
    assert by_id[51].usage_control == "Download"
    assert by_id[52].should_ignore is True


# --------------------------------------------------------------------------
# Status de-duplication and unique index
# --------------------------------------------------------------------------


def test_status_deduplication_reaches_the_disk(tmp_path):
    db_path = tmp_path / "updates.sqlite"
    conn = sqlite3.connect(db_path)
    _create_status_table(conn, unique=False)
    conn.execute(
        "INSERT INTO model_update_status (model_id, model_type, last_checked_at, should_ignore_model) "
        "VALUES (5, 'lora', 1.0, 0), (5, 'lora', 9.0, 1), (6, 'lora', NULL, 0)"
    )
    conn.commit()
    conn.close()

    ModelUpdateService(str(db_path))

    assert _rows(
        db_path,
        "SELECT model_id, last_checked_at, should_ignore_model "
        "FROM model_update_status ORDER BY model_id",
    ) == [(5, 9.0, 1), (6, None, 0)]
    indexes = {
        row[0]
        for row in _rows(
            db_path,
            "SELECT name FROM sqlite_master WHERE type = 'index' "
            "AND tbl_name = 'model_update_status'",
        )
    }
    assert "uq_model_update_status_model_id" in indexes


# --------------------------------------------------------------------------
# Failure in the middle of the rebuild
# --------------------------------------------------------------------------


class _FailOnFinalRename(sqlite3.Connection):
    """Raises on the last step of the rebuild, after the legacy table is dropped."""

    def execute(self, sql, *args, **kwargs):  # type: ignore[override]
        if "RENAME TO model_update_versions" in sql and "_new" in sql:
            raise sqlite3.OperationalError("injected failure")
        return super().execute(sql, *args, **kwargs)


def _assert_legacy_table_intact(db_path) -> None:
    tables = _tables(db_path)
    assert "model_update_versions" in tables
    assert "model_update_versions_legacy" not in tables
    assert "model_update_versions_new" not in tables
    # Still the old shape, with every row readable.
    assert _primary_key(db_path, "model_update_versions") == ["version_id"]
    assert _rows(
        db_path,
        "SELECT model_id, version_id, name, usage_control FROM model_update_versions "
        "ORDER BY version_id",
    ) == [
        (5, 51, "v1", "Download"),
        (5, 52, "v2", "Generation"),
        (6, 61, "c1", None),
    ]


def test_failure_mid_rebuild_leaves_the_original_table(tmp_path, monkeypatch):
    db_path = tmp_path / "updates.sqlite"
    _legacy_full_db(db_path)

    def failing_connect(self):
        conn = sqlite3.connect(self._db_path, check_same_thread=False, factory=_FailOnFinalRename)
        conn.row_factory = sqlite3.Row
        return conn

    monkeypatch.setattr(ModelUpdateService, "_connect", failing_connect)
    with pytest.raises(sqlite3.OperationalError, match="injected failure"):
        ModelUpdateService(str(db_path))

    _assert_legacy_table_intact(db_path)

    # Once the failure is gone the next start migrates normally.
    monkeypatch.undo()
    ModelUpdateService(str(db_path))
    assert _primary_key(db_path, "model_update_versions") == ["model_id", "version_id"]
    assert len(_rows(db_path, "SELECT * FROM model_update_versions")) == 3


def test_failing_copy_leaves_the_original_table(tmp_path):
    """A legacy row the new table rejects aborts the copy, not the data."""

    db_path = tmp_path / "updates.sqlite"
    conn = sqlite3.connect(db_path)
    _create_status_table(conn)
    # An early shape where model_id was still nullable; the new table is NOT NULL.
    conn.execute(
        "CREATE TABLE model_update_versions ("
        "version_id INTEGER PRIMARY KEY, model_id INTEGER, name TEXT)"
    )
    conn.execute(
        "INSERT INTO model_update_status (model_id, model_type) VALUES (5, 'lora')"
    )
    conn.execute(
        "INSERT INTO model_update_versions (version_id, model_id, name) "
        "VALUES (51, 5, 'v1'), (52, NULL, 'broken')"
    )
    conn.commit()
    conn.close()

    with pytest.raises(sqlite3.IntegrityError):
        ModelUpdateService(str(db_path))

    tables = _tables(db_path)
    assert "model_update_versions" in tables
    assert "model_update_versions_legacy" not in tables
    assert "model_update_versions_new" not in tables
    assert _primary_key(db_path, "model_update_versions") == ["version_id"]
    # The additive columns of the same start were rolled back with it.
    assert _columns(db_path, "model_update_versions") == {"version_id", "model_id", "name"}
    assert _rows(
        db_path, "SELECT version_id, model_id, name FROM model_update_versions ORDER BY version_id"
    ) == [(51, 5, "v1"), (52, None, "broken")]


def test_orphan_versions_survive_the_rebuild(tmp_path):
    """A version whose model has no status row is copied, not a reason to fail."""

    db_path = tmp_path / "updates.sqlite"
    _legacy_full_db(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO model_update_versions (version_id, model_id, name) VALUES (99, 404, 'orphan')"
    )
    conn.commit()
    conn.close()

    ModelUpdateService(str(db_path))

    assert _primary_key(db_path, "model_update_versions") == ["model_id", "version_id"]
    assert _rows(
        db_path, "SELECT model_id, version_id, name FROM model_update_versions ORDER BY version_id"
    ) == [(5, 51, "v1"), (5, 52, "v2"), (6, 61, "c1"), (404, 99, "orphan")]
