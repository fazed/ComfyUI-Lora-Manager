"""Phase B1 (item 6): LoRA stack entries keep rooted business paths.

Python 3.13 made ``os.path.isabs('/x')`` False on Windows; the loader now
uses ``is_absolute_like`` so a rooted stack path is still looked up as an
exact business path.
"""

from __future__ import annotations

import pytest

from py.nodes import lora_loader


# ---------------------------------------------------------------------------
# LoRA stack entries keep rooted business paths (lora_loader)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "lora_path, expected_lookup",
    [
        ("/mnt/models/loras/a.safetensors", "/mnt/models/loras/a.safetensors"),
        ("D:/models/loras/a.safetensors", "D:/models/loras/a.safetensors"),
        ("sub/a.safetensors", None),
    ],
)
def test_lora_stack_absolute_detection(monkeypatch, lora_path, expected_lookup):
    seen = []
    monkeypatch.setattr(
        lora_loader,
        "get_lora_info_absolute",
        lambda name: seen.append(name) or (name, []),
    )
    monkeypatch.setattr(lora_loader, "extract_lora_name", lambda path: "a")

    lora_loader._collect_stack_entries([(lora_path, 1.0, 1.0)])

    assert seen == [expected_lookup if expected_lookup is not None else "a"]
