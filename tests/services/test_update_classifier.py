"""Pure classification tests for the Updates overview (no Civitai, no database)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import pytest

from py.services.model_update_service import ModelUpdateRecord, ModelVersionRecord
from py.services.update_classifier import (
    HIDDEN_CODES,
    REASON_CODES,
    build_updates_overview,
    name_signature,
)

NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)


def version(
    version_id: int,
    name: str,
    *,
    base: Optional[str] = "Illustrious",
    released: Optional[str] = None,
    size: Optional[int] = 200_000_000,
    in_library: bool = False,
    ignore: bool = False,
    usage: Optional[str] = "Download",
    file_count: Optional[int] = 1,
    early_access: bool = False,
    early_access_ends_at: Optional[str] = None,
    paid: bool = False,
    preview: Optional[str] = None,
) -> ModelVersionRecord:
    return ModelVersionRecord(
        version_id=version_id,
        name=name,
        base_model=base,
        released_at=released,
        size_bytes=size,
        preview_url=preview,
        is_in_library=in_library,
        should_ignore=ignore,
        usage_control=usage,
        file_count=file_count,
        is_early_access=early_access,
        early_access_ends_at=early_access_ends_at,
        is_paid=paid,
    )


def record(model_id: int, versions, *, checked: Optional[float] = 1_760_000_000.0, ignore_model=False):
    return ModelUpdateRecord(
        model_type="lora",
        model_id=model_id,
        versions=list(versions),
        last_checked_at=checked,
        should_ignore_model=ignore_model,
    )


def item(
    model_id: int,
    version_id: int,
    *,
    base: Optional[str] = "Illustrious",
    path: Optional[str] = None,
    folder: str = "styles",
    name: str = "Model",
    size: int = 200_000_000,
    published: Optional[str] = None,
    nsfw: int = 0,
) -> dict[str, Any]:
    file_path = path or f"D:/models/loras/{folder}/m{model_id}_v{version_id}.safetensors"
    civitai: dict[str, Any] = {"id": version_id, "modelId": model_id, "model": {"name": name}}
    if published:
        civitai["publishedAt"] = published
    return {
        "file_path": file_path,
        "file_name": file_path.rsplit("/", 1)[-1].rsplit(".", 1)[0],
        "folder": folder,
        "model_name": name,
        "base_model": base,
        "size": size,
        "preview_url": f"D:/models/loras/{folder}/m{model_id}.png",
        "preview_nsfw_level": nsfw,
        "civitai": civitai,
    }


def overview(items, records, **kwargs):
    kwargs.setdefault("now", NOW)
    return build_updates_overview(
        model_type="lora",
        local_items=items,
        records={r.model_id: r for r in records},
        **kwargs,
    )


def only_group(payload):
    assert len(payload["groups"]) == 1, payload["groups"]
    return payload["groups"][0]


def candidate(group, version_id):
    for entry in group["candidates"]:
        if entry["versionId"] == version_id:
            return entry
    raise AssertionError(f"version {version_id} not a candidate: {group['candidates']}")


# --------------------------------------------------------------------------
# name_signature
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name, version_number, tokens, core",
    [
        ("v1.0", (1,), set(), ()),
        ("v2.0", (2,), set(), ()),
        ("Illustrious v2", (2,), set(), ()),
        ("v3 fp8", (3,), {"fp8"}, ()),
        ("v1.0 remapped", (1,), {"remapped"}, ()),
        ("Q4_K_M GGUF", None, {"q4_k_m", "gguf"}, ()),
        ("v2.1 High Noise", (2, 1), {"high", "noise"}, ()),
        ("Style A v1", (1,), set(), ("style", "a")),
        ("Anima v1.5 NVFP4", (1, 5), {"nvfp4"}, ()),
        ("1.0.0", (1,), set(), ()),
        # "2.9B" is a parameter count, not a version number.
        ("Remapped Anima 2.9B", None, {"remapped"}, ()),
        ("Wan 14B i2v v2", (2,), set(), ("i2v",)),
    ],
)
def test_name_signature(name, version_number, tokens, core):
    sig = name_signature(name, "Illustrious")
    assert sig.version == version_number
    assert set(sig.variant_tokens) == tokens
    assert sig.core == core


# --------------------------------------------------------------------------
# Likely successors
# --------------------------------------------------------------------------


def test_next_version_on_same_base_is_likely():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v1.0", released="2026-09-01T00:00:00Z", in_library=True),
                    version(11, "v2.0", released="2026-09-20T00:00:00Z"),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert group["tier"] == "likely"
    entry = candidate(group, 11)
    assert entry["confidence"] == "likely"
    assert entry["reason"] == "next_version_same_base"
    assert entry["hiddenBecause"] == []
    assert payload["totals"]["likely"] == 1
    assert group["newestOwned"]["versionId"] == 10


def test_release_date_beats_version_id():
    # v2 has a LOWER id but was released later: still the successor.
    # v0.9 has a HIGHER id but was released earlier: not a candidate at all.
    payload = overview(
        [item(1, 50)],
        [
            record(
                1,
                [
                    version(50, "v1.0", released="2026-06-01T00:00:00Z"),
                    version(40, "v2.0", released="2026-07-01T00:00:00Z"),
                    version(60, "v0.9 old", released="2026-05-01T00:00:00Z"),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert [c["versionId"] for c in group["candidates"]] == [40]
    assert group["candidates"][0]["confidence"] == "likely"


def test_unknown_dates_fall_back_to_id_as_possible():
    payload = overview(
        [item(1, 10)],
        [record(1, [version(10, "v1"), version(11, "v2")])],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "possible"
    assert entry["reason"] == "unknown_release_date"


# --------------------------------------------------------------------------
# Cause 1: variants of the same release
# --------------------------------------------------------------------------


def test_precision_variant_of_owned_version_is_variant():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v1.0", released="2026-09-01T00:00:00Z", size=6_000_000_000),
                    version(11, "v1.0 fp8", released="2026-09-01T06:00:00Z", size=3_000_000_000),
                    version(12, "v1.0 GGUF Q4_K_M", released="2026-09-03T00:00:00Z", size=2_000_000_000),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert group["tier"] == "hidden"
    for vid in (11, 12):
        entry = candidate(group, vid)
        assert entry["confidence"] == "variant"
        assert entry["reason"] == "looks_like_format_variant"
    assert payload["totals"] == {"likely": 0, "possible": 0, "hidden": 1, "groups": 1, "upToDate": 0}


@pytest.mark.parametrize(
    "owned_name, candidate_name",
    [
        ("v3 High Noise", "v3 Low Noise"),  # Wan high/low pair
        ("v1.0", "v1.0 remapped"),
        ("v2", "v2 int8"),
        ("v2", "v2 nvfp4"),
        ("v1", "v1 LoRA extracted"),
        ("v5", "v5 plus"),
        ("v4 matte", "v4 cute"),
        ("v1 bf16", "v1 fp16"),
        ("Base_V1", "Base_V1_INT8_CONVROT"),  # real checkpoint naming
    ],
)
def test_variant_token_pairs_are_variants(owned_name, candidate_name):
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, owned_name, released="2026-09-01T00:00:00Z"),
                    version(11, candidate_name, released="2026-09-10T00:00:00Z"),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "variant", entry


def test_remapped_upload_seconds_after_the_owned_one_is_a_variant():
    # Real pattern seen in the library: "Remapped Anima 2.9B" uploaded two
    # seconds after "v1.0 Anima" with a different file size.
    payload = overview(
        [item(1, 10, base="Anima")],
        [
            record(
                1,
                [
                    version(10, "v1.0 Anima", base="Anima", released="2026-09-19T17:03:27.765Z", size=150_000_000),
                    version(11, "Remapped Anima 2.9B", base="Anima", released="2026-09-19T17:03:30.034Z", size=90_000_000),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "variant"
    assert entry["reason"] == "looks_like_format_variant"


def test_same_release_same_size_is_variant_even_with_other_name():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "Default", released="2026-09-01T00:00:00Z", size=217_000_000),
                    version(11, "Bright", released="2026-09-01T09:00:00Z", size=218_000_000),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "variant"
    assert entry["reason"] == "same_release_variant"


def test_same_day_hotfix_with_higher_number_is_not_a_variant():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v1.0", released="2026-09-01T00:00:00Z"),
                    version(11, "v1.1", released="2026-09-01T12:00:00Z"),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "likely"


def test_same_day_other_size_is_possible():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "Release", released="2026-09-01T00:00:00Z", size=100_000_000),
                    version(11, "Release", released="2026-09-01T10:00:00Z", size=400_000_000),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "possible"
    assert entry["reason"] == "same_day_as_owned"


def test_format_siblings_of_a_new_release_keep_the_main_file_likely():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v2", released="2026-08-01T00:00:00Z", size=6_000_000_000),
                    version(20, "v3", released="2026-09-01T00:00:00Z", size=6_000_000_000),
                    version(21, "v3 fp8", released="2026-09-01T02:00:00Z", size=3_000_000_000),
                    version(22, "v3 gguf", released="2026-09-01T03:00:00Z", size=2_000_000_000),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert candidate(group, 20)["confidence"] == "likely"
    assert candidate(group, 21)["confidence"] == "variant"
    assert candidate(group, 22)["confidence"] == "variant"
    # The best candidate comes first.
    assert group["candidates"][0]["versionId"] == 20
    assert group["tier"] == "likely"


def test_wan_pair_successor_follows_the_owned_noise_flavour():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v2 high noise", released="2026-08-01T00:00:00Z"),
                    version(20, "v3 high noise", released="2026-09-01T00:00:00Z"),
                    version(21, "v3 low noise", released="2026-09-01T00:30:00Z"),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert candidate(group, 20)["confidence"] == "likely"
    sibling = candidate(group, 21)
    assert sibling["confidence"] == "possible"
    assert sibling["reason"] == "sibling_variant"


# --------------------------------------------------------------------------
# Cause 2: stale is_in_library vs the scanner
# --------------------------------------------------------------------------


def test_read_time_ownership_overrides_a_stale_flag():
    # Real case (checkpoint 2999795): the DB still says v1.0 is in the library,
    # the scanner holds v2.0. v2.0 must not be offered as an update.
    payload = overview(
        [item(2999795, 3425724, base="Illustrious")],
        [
            record(
                2999795,
                [
                    version(3402628, "v1.0", released="2026-10-13T10:37:24.563Z", size=7105349004, in_library=True),
                    version(3425724, "v2.0", released="2026-10-24T04:51:22.940Z", size=7105349852, in_library=False),
                ],
            )
        ],
    )
    assert payload["groups"] == []
    assert payload["totals"]["upToDate"] == 1


def test_flag_says_in_library_but_file_is_gone():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v1", released="2026-01-01T00:00:00Z"),
                    version(11, "v2", released="2026-02-01T00:00:00Z", in_library=True),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert group["ownedVersionIds"] == [10]
    assert candidate(group, 11)["confidence"] == "likely"


# --------------------------------------------------------------------------
# Cause 3: one row per model line, not per card
# --------------------------------------------------------------------------


def test_many_cards_of_one_model_line_make_one_group():
    items = [
        item(1, 10, path="D:/m/a/one.safetensors", folder="a"),
        item(1, 10, path="D:/m/b/one-copy.safetensors", folder="b"),
        item(1, 9, path="D:/m/a/old.safetensors", folder="a"),
    ]
    payload = overview(
        items,
        [
            record(
                1,
                [
                    version(9, "v0.9", released="2026-01-01T00:00:00Z"),
                    version(10, "v1", released="2026-02-01T00:00:00Z"),
                    version(11, "v2", released="2026-03-01T00:00:00Z"),
                ],
            )
        ],
    )
    group = only_group(payload)
    assert len(group["localCards"]) == 3
    assert group["ownedVersionIds"] == [9, 10]
    assert group["newestOwned"]["versionId"] == 10
    assert [c["versionId"] for c in group["candidates"]] == [11]


def test_each_base_line_is_its_own_group():
    items = [item(1, 10, base="Illustrious"), item(1, 20, base="Pony")]
    payload = overview(
        items,
        [
            record(
                1,
                [
                    version(10, "IL v1", base="Illustrious", released="2026-01-01T00:00:00Z"),
                    version(11, "IL v2", base="Illustrious", released="2026-03-01T00:00:00Z"),
                    version(20, "Pony v1", base="Pony", released="2026-01-05T00:00:00Z"),
                ],
            )
        ],
    )
    assert len(payload["groups"]) == 1  # the Pony line is up to date
    group = payload["groups"][0]
    assert group["baseModel"] == "Illustrious"
    assert [c["versionId"] for c in group["candidates"]] == [11]
    assert payload["totals"]["upToDate"] == 1


def test_other_base_is_hidden_and_attached_once():
    items = [item(1, 10, base="Illustrious"), item(1, 20, base="Pony")]
    payload = overview(
        items,
        [
            record(
                1,
                [
                    version(10, "v1", base="Illustrious", released="2026-01-01T00:00:00Z"),
                    version(20, "v1", base="Pony", released="2026-02-01T00:00:00Z"),
                    version(30, "v1", base="Flux.1 D", released="2026-05-01T00:00:00Z"),
                ],
            )
        ],
    )
    groups = payload["groups"]
    assert len(groups) == 1
    assert groups[0]["baseModel"] == "Pony"
    entry = candidate(groups[0], 30)
    assert entry["reason"] == "other_base"
    assert entry["hiddenBecause"][0] == "other_base"
    assert groups[0]["tier"] == "hidden"


# --------------------------------------------------------------------------
# Cause 4: parallel lines
# --------------------------------------------------------------------------


def test_parallel_style_line_is_possible():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "Watercolor v1", released="2026-01-01T00:00:00Z"),
                    version(11, "Ink v1", released="2026-02-01T00:00:00Z"),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["confidence"] == "possible"
    assert entry["reason"] == "parallel_line"


def test_lower_version_number_released_later_is_possible():
    payload = overview(
        [item(1, 10)],
        [
            record(
                1,
                [
                    version(10, "v3", released="2026-03-01T00:00:00Z"),
                    version(11, "v2.5", released="2026-04-01T00:00:00Z"),
                ],
            )
        ],
    )
    entry = candidate(only_group(payload), 11)
    assert entry["reason"] == "lower_version_number"


def _pair(owned_name, candidate_name, *, base="Illustrious", owned_size=200_000_000, cand_size=150_000_000):
    """One owned version and one candidate released a month later."""

    payload = overview(
        [item(1, 10, base=base)],
        [
            record(
                1,
                [
                    version(10, owned_name, base=base, released="2026-03-01T00:00:00Z", size=owned_size),
                    version(11, candidate_name, base=base, released="2026-04-01T00:00:00Z", size=cand_size),
                ],
            )
        ],
    )
    return candidate(only_group(payload), 11)


def test_new_label_without_number_after_a_bare_number_is_possible():
    # Anonymised from a real model: the user owns "Illustrious - V2" and "1.0"
    # on Illustrious plus the Anima and Krea 2 versions; "More_Realism-IL" is
    # a parallel style line, not the next version.
    model_id = 900
    versions = [
        version(1232278, "Illustrious - V2", released="2025-01-02T18:17:39.090Z", size=228466596),
        version(1617422, "1.0", released="2025-04-03T19:53:57.695Z", size=228453876),
        version(1994181, "More_Realism-IL", released="2025-07-10T14:00:00.000Z", size=228454572),
        version(2659019, "PONY", base="Pony", released="2026-02-04T09:28:03.247Z", size=456506404),
        version(2685421, "FLUX", base="Flux.1 D", released="2026-02-13T12:00:00.000Z", size=306432472),
        version(2988484, "Flux.2 Klein 9B", base="Flux.2 Klein 9B", released="2026-05-29T23:18:54.462Z", size=82867920),
        version(3050316, "ANIMA", base="Anima", released="2026-06-19T19:14:43.302Z", size=69391584),
        version(3182058, "Krea 2", base="Krea 2", released="2026-07-30T16:47:21.117Z", size=114326440),
    ]
    items = [
        item(model_id, 1232278, base="Illustrious"),
        item(model_id, 1617422, base="Illustrious"),
        item(model_id, 3050316, base="Anima"),
        item(model_id, 3182058, base="Krea 2"),
    ]
    payload = overview(items, [record(model_id, versions)])
    assert payload["totals"]["likely"] == 0
    group = only_group(payload)
    assert group["baseModel"] == "Illustrious"
    assert group["tier"] == "possible"
    assert group["newestOwned"]["versionId"] == 1617422
    entry = candidate(group, 1994181)
    assert entry["confidence"] == "possible"
    assert entry["reason"] == "new_label"
    assert entry["hiddenBecause"] == []
    # Pony / Flux / Flux.2 Klein are older than the newest owned version
    # (Krea 2), so they are no candidates at all; nothing else is visible.
    visible = [c for c in group["candidates"] if not c["hiddenBecause"]]
    assert [c["versionId"] for c in visible] == [1994181]


def test_new_label_needs_a_bare_number_as_owned_name():
    # The owned name has its own words: not the narrow new_label rule.
    entry = _pair("Watercolor v1", "Watercolor Soft")
    assert entry["reason"] != "new_label"


def test_roman_numeral_successor_stays_likely():
    entry = _pair("v12", "XIV (SDXL)", base="SDXL 1.0")
    assert entry["confidence"] == "likely"
    assert entry["reason"] == "next_version_same_base"


def test_same_number_with_other_words_is_possible():
    entry = _pair("context detail base v1", "context detail sft v1", base="MOSS Image")
    assert entry["confidence"] == "possible"
    assert entry["reason"] == "same_version_number"


def test_same_number_dropping_a_prerelease_word_stays_likely():
    entry = _pair("v1.0beta [x]", "v1.0 [x]")
    assert entry["confidence"] == "likely"
    assert entry["reason"] == "next_version_same_base"


def test_same_number_adding_a_word_after_prerelease_is_possible():
    # Drops "beta" but adds "sft": not just the final release.
    entry = _pair("v1.0 beta", "v1.0 sft")
    assert entry["confidence"] == "possible"


@pytest.mark.parametrize(
    "name, number, core",
    [
        ("IllustriousV2", (2,), ()),
        ("animav2.0_better", (2,), ("better",)),
        ("Pony_v3", (3,), ()),
        # "il" is too short to split: parsed exactly as before.
        ("ILv10_NPi", None, ("ilv10", "npi")),
    ],
)
def test_glued_base_word_and_version(name, number, core):
    sig = name_signature(name, "Illustrious")
    assert sig.version == number
    assert sig.core == core


def test_glued_base_word_successor_stays_likely():
    entry = _pair("v1", "IllustriousV2")
    assert entry["confidence"] == "likely"


@pytest.mark.parametrize(
    "owned_name, candidate_name, base",
    [
        ("v1.0 Anima", "v2.0 Anima", "Anima"),
        ("α", "β", "Krea 2"),
    ],
)
def test_real_successors_stay_likely(owned_name, candidate_name, base):
    entry = _pair(owned_name, candidate_name, base=base, owned_size=13_491_967_624, cand_size=13_491_966_960)
    assert entry["confidence"] == "likely"
    assert entry["reason"] == "next_version_same_base"


def test_new_label_is_a_known_reason_code():
    assert "new_label" in REASON_CODES


# --------------------------------------------------------------------------
# Cause 5: stale / missing records
# --------------------------------------------------------------------------


def test_models_without_record_are_unchecked_not_up_to_date():
    payload = overview(
        [item(1, 10), item(2, 20), item(3, 30)],
        [record(1, [version(10, "v1", released="2026-01-01T00:00:00Z")]), record(3, [], checked=None)],
    )
    assert payload["unchecked"] == 2
    assert payload["models"] == {
        "local": 3,
        "tracked": 2,
        "checked": 1,
        "untracked": 1,
        "neverChecked": 1,
    }
    assert payload["totals"]["upToDate"] == 2  # models 1 and 3 have no candidates
    assert payload["oldestCheckedAt"] is not None


def test_checked_timestamps_are_iso_and_oldest_is_reported():
    payload = overview(
        [item(1, 10), item(2, 20)],
        [
            record(1, [version(10, "v1"), version(11, "v2")], checked=1_700_000_000.0),
            record(2, [version(20, "v1")], checked=1_760_000_000.0),
        ],
    )
    assert payload["oldestCheckedAt"] == "2023-11-14T22:13:20Z"
    assert payload["newestCheckedAt"].startswith("2025-")
    assert only_group(payload)["lastCheckedAt"] == "2023-11-14T22:13:20Z"


# --------------------------------------------------------------------------
# Cause 6 and gates
# --------------------------------------------------------------------------


def base_record(**candidate_kwargs):
    return record(
        1,
        [
            version(10, "v1", released="2026-01-01T00:00:00Z"),
            version(11, "v2", released="2026-03-01T00:00:00Z", **candidate_kwargs),
        ],
    )


@pytest.mark.parametrize(
    "kwargs, code",
    [
        ({"file_count": 0}, "no_files"),
        ({"usage": "Generation"}, "not_downloadable"),
        ({"ignore": True}, "ignored"),
    ],
)
def test_gates_hide_candidates(kwargs, code):
    payload = overview([item(1, 10)], [base_record(**kwargs)])
    group = only_group(payload)
    entry = candidate(group, 11)
    assert code in entry["hiddenBecause"]
    assert group["tier"] == "hidden"


def test_unknown_file_count_and_usage_are_downloadable():
    payload = overview([item(1, 10)], [base_record(file_count=None, usage=None)])
    assert candidate(only_group(payload), 11)["hiddenBecause"] == []


def test_ignored_model_hides_everything():
    rec = base_record()
    rec.should_ignore_model = True
    group = only_group(overview([item(1, 10)], [rec]))
    assert group["isIgnored"] is True
    assert candidate(group, 11)["hiddenBecause"] == ["ignored"]
    assert candidate(group, 11)["isIgnored"] is True


def test_ignored_lines_stay_in_the_payload_for_the_ignored_view():
    """The Updates page lists ignored models and versions from the overview
    itself: an ignored line is a hidden group, not dropped, and an ignored
    version stays a candidate next to the visible ones."""

    ignored_model = record(
        1,
        [version(10, "v1", released="2026-01-01T00:00:00Z"), version(11, "v2", released="2026-03-01T00:00:00Z")],
        ignore_model=True,
    )
    ignored_version = record(
        2,
        [
            version(20, "v1", released="2026-01-01T00:00:00Z"),
            version(21, "v2", released="2026-02-01T00:00:00Z", ignore=True),
            version(22, "v3", released="2026-03-01T00:00:00Z"),
        ],
    )
    payload = overview([item(1, 10), item(2, 20)], [ignored_model, ignored_version])
    by_model = {g["modelId"]: g for g in payload["groups"]}
    assert by_model[1]["isIgnored"] is True
    assert by_model[1]["tier"] == "hidden"
    assert payload["totals"]["hidden"] == 1
    assert by_model[2]["isIgnored"] is False
    assert by_model[2]["tier"] == "likely"
    assert candidate(by_model[2], 21)["isIgnored"] is True
    assert candidate(by_model[2], 21)["hiddenBecause"] == ["ignored"]
    assert candidate(by_model[2], 22)["isIgnored"] is False


def test_early_access_follows_the_setting():
    future = "2026-12-31T00:00:00Z"
    shown = only_group(overview([item(1, 10)], [base_record(early_access=True, early_access_ends_at=future)]))
    entry = candidate(shown, 11)
    assert entry["isEarlyAccess"] is True
    assert entry["hiddenBecause"] == []

    hidden = only_group(
        overview(
            [item(1, 10)],
            [base_record(early_access=True, early_access_ends_at=future)],
            hide_early_access=True,
        )
    )
    assert candidate(hidden, 11)["hiddenBecause"] == ["early_access"]


def test_expired_early_access_is_not_early_access():
    group = only_group(
        overview(
            [item(1, 10)],
            [base_record(early_access=True, early_access_ends_at="2026-01-01T00:00:00Z")],
            hide_early_access=True,
        )
    )
    entry = candidate(group, 11)
    assert entry["isEarlyAccess"] is False
    assert entry["hiddenBecause"] == []


def test_paid_follows_the_setting():
    shown = only_group(overview([item(1, 10)], [base_record(paid=True)]))
    assert candidate(shown, 11)["isPaid"] is True
    assert candidate(shown, 11)["hiddenBecause"] == []
    hidden = only_group(overview([item(1, 10)], [base_record(paid=True)], hide_paid=True))
    assert candidate(hidden, 11)["hiddenBecause"] == ["paid"]


def test_already_downloaded_before_is_hidden():
    group = only_group(
        overview([item(1, 10)], [base_record()], downloaded_version_ids={1: [11]})
    )
    entry = candidate(group, 11)
    assert entry["hasBeenDownloaded"] is True
    assert entry["hiddenBecause"] == ["already_downloaded"]


# --------------------------------------------------------------------------
# Payload shape
# --------------------------------------------------------------------------


def test_payload_shape_and_local_cards():
    payload = overview(
        [item(1, 10, name="Ink Style", nsfw=8)],
        [base_record(preview="https://image.civitai.com/x.jpeg")],
        preview_url_builder=lambda path: "/static/" + path.rsplit("/", 1)[-1],
    )
    group = only_group(payload)
    assert group["modelName"] == "Ink Style"
    assert group["key"] == "1:illustrious"
    assert group["previewNsfwLevel"] == 8
    card = group["localCards"][0]
    assert card == {
        "filePath": "D:/models/loras/styles/m1_v10.safetensors",
        "fileName": "m1_v10",
        "folder": "styles",
        "baseModel": "Illustrious",
        "versionId": 10,
        "versionName": "v1",
        "releasedAt": "2026-01-01T00:00:00Z",
        "sizeBytes": 200_000_000,
        "previewUrl": "/static/m1.png",
        "previewNsfwLevel": 8,
    }
    entry = candidate(group, 11)
    assert set(entry) == {
        "versionId", "name", "baseModel", "releasedAt", "sizeBytes", "fileCount",
        "usageControl", "isEarlyAccess", "earlyAccessEndsAt", "isPaid", "previewUrl",
        "hasBeenDownloaded", "isIgnored", "confidence", "reason", "hiddenBecause",
        "description", "fileFormat", "precision", "files",
    }
    assert entry["previewUrl"] == "https://image.civitai.com/x.jpeg"
    assert payload["settings"] == {"hideEarlyAccessUpdates": False, "hidePaidUpdates": False}
    assert entry["reason"] in REASON_CODES
    assert all(code in HIDDEN_CODES for code in entry["hiddenBecause"])


def test_groups_are_sorted_likely_first():
    items = [item(1, 10), item(2, 20)]
    records = [
        record(1, [version(10, "Ink v1", released="2026-01-01T00:00:00Z"), version(11, "Watercolor v1", released="2026-02-01T00:00:00Z")]),
        record(2, [version(20, "v1", released="2026-01-01T00:00:00Z"), version(21, "v2", released="2026-02-01T00:00:00Z")]),
    ]
    payload = overview(items, records)
    assert [g["tier"] for g in payload["groups"]] == ["likely", "possible"]
    assert payload["totals"]["likely"] == 1
    assert payload["totals"]["possible"] == 1


def test_items_without_civitai_ids_are_ignored():
    payload = overview(
        [{"file_path": "x", "civitai": None}, {"file_path": "y", "civitai": {"modelId": 1}}],
        [],
    )
    assert payload["models"]["local"] == 0
    assert payload["groups"] == []
