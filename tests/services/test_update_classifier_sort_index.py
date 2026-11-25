"""Pin that the Updates classifier ignores Civitai's creator-defined version order.

The stored ``sort_index`` of ``model_update_versions`` is deliberately not used by
``py/services/update_classifier.py``: the stored value is unreliable (sticky after
the first insert, owned local-only records float to the top, new uploads tie and
lose on id, creator reorders never arrive) and even the true Civitai order is not
recency (creators pin older favourites and group versions by family). Rules built
on it demoted real successors and promoted parallel styles. See the README section
"Why the creator's version order is not used" (ui/README.md, Updates).

The fixture is a real-library case (Civitai model 1096396, a multi-base LoRA with
Illustrious, Pony, Flux, Flux.2 Klein, Anima and Krea 2 versions), anonymized to
ids, names, bases, release dates and sizes.
"""

from __future__ import annotations

import random
from datetime import datetime, timezone

import pytest

from py.services.model_update_service import ModelUpdateRecord, ModelVersionRecord
from py.services.update_classifier import build_updates_overview

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
MODEL_ID = 1096396

# (version_id, name, base, released, size_bytes, owned)
VERSIONS = [
    (1232278, "Illustrious - V2", "Illustrious", "2025-01-02T00:00:00Z", 228466596, True),
    (1617422, "1.0", "Illustrious", "2025-04-03T00:00:00Z", 228453876, True),
    (1994181, "More_Realism-IL", "Illustrious", "2025-07-10T00:00:00Z", 228454572, False),
    (2659019, "PONY", "Pony", "2026-02-04T00:00:00Z", 456506404, False),
    (2685421, "FLUX", "Flux.1 D", "2026-02-13T00:00:00Z", 306432472, False),
    (2988484, "Flux.2 Klein 9B", "Flux.2 Klein 9B", "2026-05-29T00:00:00Z", 82867920, False),
    (3050316, "ANIMA", "Anima", "2026-06-19T00:00:00Z", 69391584, True),
    (3182058, "Krea 2", "Krea 2", "2026-07-30T00:00:00Z", 114326440, True),
]


def _versions(sort_indices):
    records = [
        ModelVersionRecord(
            version_id=vid,
            name=name,
            base_model=base,
            released_at=released,
            size_bytes=size,
            preview_url=None,
            is_in_library=owned,
            should_ignore=False,
            usage_control="Download",
            file_count=1,
            sort_index=idx,
        )
        for (vid, name, base, released, size, owned), idx in zip(VERSIONS, sort_indices)
    ]
    # The database returns versions ordered by (sort_index, version_id); mirror that.
    return sorted(records, key=lambda v: (v.sort_index, v.version_id))


def _items():
    items = []
    for vid, name, base, released, size, owned in VERSIONS:
        if not owned:
            continue
        path = f"D:/models/loras/concepts/m{MODEL_ID}_v{vid}.safetensors"
        items.append(
            {
                "file_path": path,
                "file_name": path.rsplit("/", 1)[-1].rsplit(".", 1)[0],
                "folder": "concepts",
                "model_name": "Concept LoRA",
                "base_model": base,
                "size": size,
                "preview_url": f"D:/models/loras/concepts/m{MODEL_ID}.png",
                "preview_nsfw_level": 0,
                "civitai": {
                    "id": vid,
                    "modelId": MODEL_ID,
                    "model": {"name": "Concept LoRA"},
                    "publishedAt": released,
                },
            }
        )
    return items


def _overview(sort_indices):
    record = ModelUpdateRecord(
        model_type="lora",
        model_id=MODEL_ID,
        versions=_versions(sort_indices),
        last_checked_at=1_764_000_000.0,
        should_ignore_model=False,
    )
    return build_updates_overview(
        model_type="lora",
        local_items=_items(),
        records={MODEL_ID: record},
        now=NOW,
    )


def _permutations():
    n = len(VERSIONS)
    identity = list(range(n))
    perms = {
        "identity": identity,
        "reversed": identity[::-1],
        # What the database actually held: owned local-only records first.
        "owned_first": [0, 1, 4, 5, 6, 7, 2, 3],
        "all_zero": [0] * n,
    }
    rng = random.Random(1096396)
    for i in range(4):
        shuffled = identity[:]
        rng.shuffle(shuffled)
        perms[f"shuffled_{i}"] = shuffled
    return perms


PERMUTATIONS = _permutations()


def test_more_realism_is_a_possible_new_label():
    payload = _overview(PERMUTATIONS["identity"])
    candidates = {
        c["versionId"]: c for group in payload["groups"] for c in group["candidates"]
    }
    entry = candidates[1994181]
    assert entry["confidence"] == "possible"
    assert entry["reason"] == "new_label"
    assert not entry.get("hiddenBecause")

    # The other bases (Pony, Flux.1 D, Flux.2 Klein 9B) are not lines the user
    # owns, so they are not candidates at all; the Anima and Krea 2 lines are
    # up to date.
    assert set(candidates) == {1994181}
    assert [(g["baseModel"], g["tier"]) for g in payload["groups"]] == [("Illustrious", "possible")]
    assert payload["totals"]["likely"] == 0
    assert payload["totals"]["possible"] == 1
    assert payload["totals"]["hidden"] == 0
    assert payload["totals"]["upToDate"] == 2


@pytest.mark.parametrize("name", [k for k in PERMUTATIONS if k != "identity"])
def test_overview_is_identical_under_any_sort_index(name):
    # Creator order is deliberately not used (see the README note): permuting
    # sort_index, and the record order that follows from it, must not change
    # a single byte of the overview.
    assert _overview(PERMUTATIONS[name]) == _overview(PERMUTATIONS["identity"])
