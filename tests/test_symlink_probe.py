"""Tests for the ``requires_symlinks`` probe in ``tests/conftest.py``.

The probe decides whether symlink-dependent tests run or skip, so it must
report True whenever ``os.symlink`` works and False only when it fails.
"""

import os

import pytest


@pytest.fixture
def root_conftest(request):
    for plugin in request.config.pluginmanager.get_plugins():
        if hasattr(plugin, "probe_symlink_support") and hasattr(plugin, "symlinks_supported"):
            return plugin
    pytest.fail("tests/conftest.py symlink helpers are not loaded")


class _FakeItem:
    def __init__(self, marked: bool):
        self.marked = marked
        self.added = []

    def get_closest_marker(self, name):
        return object() if self.marked and name == "requires_symlinks" else None

    def add_marker(self, marker):
        self.added.append(marker)


def test_probe_reports_true_when_symlink_succeeds(root_conftest, monkeypatch, tmp_path):
    monkeypatch.setattr(os, "symlink", lambda *args, **kwargs: None)
    assert root_conftest.probe_symlink_support(str(tmp_path)) is True


def test_probe_reports_false_when_symlink_is_not_permitted(root_conftest, monkeypatch, tmp_path):
    def deny(*args, **kwargs):
        raise OSError(1314, "A required privilege is not held by the client")

    monkeypatch.setattr(os, "symlink", deny)
    assert root_conftest.probe_symlink_support(str(tmp_path)) is False


def test_probe_cleans_up_its_temp_dir(root_conftest, tmp_path):
    root_conftest.probe_symlink_support(str(tmp_path))
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("supported, expect_skip", [(True, False), (False, True)])
def test_marked_items_skip_only_without_symlink_support(
    root_conftest, monkeypatch, supported, expect_skip
):
    monkeypatch.setattr(root_conftest, "_symlink_support", supported)
    marked, unmarked = _FakeItem(True), _FakeItem(False)

    root_conftest.pytest_collection_modifyitems(None, [marked, unmarked])

    assert bool(marked.added) is expect_skip
    assert unmarked.added == []
