"""Path-safety tests for client-supplied download destinations.

``/download-model`` (and the queue worker and GET variant, which share
``DownloadCoordinator.schedule_download``) used ``model_root`` verbatim, so
any HTTP client could make a download land in any directory. The root must
now be a configured library root and ``relative_path`` strictly relative.
"""

import os

import pytest

from py.services.download_coordinator import DownloadCoordinator
from py.utils import library_roots
from py.utils.library_roots import configured_download_roots, match_configured_root
from py.utils.safe_paths import UnsafePathError


class _Ws:
    def generate_download_id(self):
        return "dl-1"

    async def broadcast_download_progress(self, *_args, **_kwargs):
        return None


class _Manager:
    def __init__(self):
        self.calls = []

    async def download_from_civitai(self, **kwargs):
        self.calls.append(kwargs)
        return {"success": True}


@pytest.fixture
def roots(tmp_path, monkeypatch):
    lora_root = tmp_path / "Models" / "Loras"
    ckpt_root = tmp_path / "Models" / "checkpoints"
    configured = [str(lora_root).replace(os.sep, "/"), str(ckpt_root)]
    monkeypatch.setattr(
        library_roots, "configured_download_roots", lambda config_obj=None: list(configured)
    )
    return lora_root, ckpt_root, configured


def _coordinator(manager):
    async def factory():
        return manager

    return DownloadCoordinator(ws_manager=_Ws(), download_manager_factory=factory)


async def test_configured_root_is_accepted_and_configured_spelling_used(roots):
    lora_root, _ckpt, configured = roots
    manager = _Manager()
    coordinator = _coordinator(manager)

    variants = [str(lora_root), str(lora_root) + os.sep, configured[0]]
    if os.name == "nt":
        variants += [str(lora_root).upper(), str(lora_root).replace("\\", "/").lower()]
    for variant in variants:
        await coordinator.schedule_download(
            {"model_id": 1, "model_root": variant, "relative_path": "SDXL\\style"}
        )

    assert [call["save_dir"] for call in manager.calls] == [configured[0]] * len(variants)
    assert {call["relative_path"] for call in manager.calls} == {"SDXL/style"}


async def test_empty_root_keeps_default_root_behaviour(roots):
    manager = _Manager()
    await _coordinator(manager).schedule_download(
        {"model_id": 1, "model_root": "", "use_default_paths": True}
    )
    await _coordinator(manager).schedule_download({"model_id": 1, "use_default_paths": True})
    assert [call["save_dir"] for call in manager.calls] == [None, None]


async def test_default_paths_ignore_client_relative_path(roots):
    lora_root, _ckpt, configured = roots
    manager = _Manager()
    await _coordinator(manager).schedule_download(
        {
            "model_id": 1,
            "model_root": str(lora_root),
            "relative_path": "../../evil",
            "use_default_paths": True,
            "use_save_dir_as_root": True,
        }
    )
    assert manager.calls[0]["relative_path"] == ""
    assert manager.calls[0]["use_save_dir_as_root"] is True


@pytest.mark.parametrize(
    "model_root",
    [
        "loras",
        "/",
        "C:\\",
        "\\\\srv\\share\\loras",
        "SUFFIX_SIBLING",
        "SUBFOLDER",
        "OUTSIDE",
    ],
)
async def test_unconfigured_root_is_rejected(roots, tmp_path, model_root):
    lora_root, _ckpt, _configured = roots
    model_root = {
        "SUFFIX_SIBLING": str(lora_root) + "_evil",
        "SUBFOLDER": str(lora_root / "sub"),
        "OUTSIDE": str(tmp_path / "Startup"),
    }.get(model_root, model_root)
    manager = _Manager()
    with pytest.raises(ValueError, match="not a configured library root"):
        await _coordinator(manager).schedule_download(
            {"model_id": 1, "model_root": model_root}
        )
    assert manager.calls == []


@pytest.mark.parametrize(
    "relative_path",
    ["/abs", "\\abs", "C:evil", "C:\\abs", "..", "a/../../b", "a\\..\\b", "\\\\srv\\s", "x:ads", "CON"],
)
async def test_unsafe_relative_path_is_rejected(roots, relative_path):
    lora_root, _ckpt, _configured = roots
    manager = _Manager()
    with pytest.raises(ValueError):
        await _coordinator(manager).schedule_download(
            {"model_id": 1, "model_root": str(lora_root), "relative_path": relative_path}
        )
    assert manager.calls == []


async def test_no_configured_roots_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setattr(
        library_roots, "configured_download_roots", lambda config_obj=None: []
    )
    manager = _Manager()
    with pytest.raises(ValueError, match="no library directories"):
        await _coordinator(manager).schedule_download(
            {"model_id": 1, "model_root": str(tmp_path)}
        )
    assert manager.calls == []


def test_configured_download_roots_collects_every_root_list():
    class _Config:
        loras_roots = ["/m/loras", "/m/Loras/"]
        extra_loras_roots = ["/x/loras"]
        checkpoints_roots = ["/m/ckpt"]
        unet_roots = ["/m/unet"]
        base_models_roots = ["/m/ckpt", "/m/unet"]
        extra_checkpoints_roots = []
        extra_unet_roots = None
        embeddings_roots = ["/m/emb"]
        extra_embeddings_roots = ["/x/emb"]
        other_roots = ["/m/vae"]
        wildcards_roots = ["/w"]
        workflows_roots = ["", "/wf"]

    roots = configured_download_roots(_Config())
    assert "/m/loras" in roots
    assert {"/x/loras", "/m/ckpt", "/m/unet", "/m/emb", "/x/emb", "/m/vae", "/w", "/wf"} <= set(roots)
    assert "" not in roots
    assert len(roots) == len({os.path.normcase(os.path.normpath(r)) for r in roots})


def test_match_configured_root_rejects_bad_values():
    for value in (None, "", "   ", "a\x00b", 5):
        with pytest.raises(UnsafePathError):
            match_configured_root(value, ["/m/loras"])
    with pytest.raises(UnsafePathError):
        match_configured_root("/m/loras", [])
    assert match_configured_root("/m/loras/", ["/m/loras"]) == "/m/loras"
