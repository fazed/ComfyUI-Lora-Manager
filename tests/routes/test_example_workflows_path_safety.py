"""Path-safety regression tests for GET /api/lm/example-workflows/{filename}.

The file name is a URL segment and aiohttp decodes ``%2F``/``%5C`` in
``match_info``, so every traversal spelling must be refused before the
handler touches the filesystem (a UNC name would open an SMB connection).
"""

import json
import os

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from py.routes.handlers import misc_handlers
from py.routes.handlers.misc_handlers import ExampleWorkflowsHandler


@pytest.fixture
def sandbox(tmp_path, monkeypatch):
    examples = tmp_path / "plugin" / "example_workflows"
    examples.mkdir(parents=True)
    (examples / "Basic_flow.json").write_text(json.dumps({"nodes": [1]}), encoding="utf-8")
    # A secret JSON next to and above the examples directory.
    (tmp_path / "plugin" / "settings.json").write_text(
        json.dumps({"civitai_api_key": "SECRET"}), encoding="utf-8"
    )
    (tmp_path / "x.json").write_text(json.dumps({"secret": True}), encoding="utf-8")
    monkeypatch.setattr(
        ExampleWorkflowsHandler, "_get_workflows_dir", lambda self: str(examples)
    )

    touched: list[str] = []
    real_isfile = os.path.isfile
    real_exists = os.path.exists

    def spy_isfile(path):
        touched.append(str(path))
        return real_isfile(path)

    def spy_exists(path):
        touched.append(str(path))
        return real_exists(path)

    monkeypatch.setattr(misc_handlers.os.path, "isfile", spy_isfile)
    monkeypatch.setattr(misc_handlers.os.path, "exists", spy_exists)
    return tmp_path, examples, touched


async def _client():
    handler = ExampleWorkflowsHandler()
    app = web.Application()
    app.router.add_get("/api/lm/example-workflows/{filename}", handler.get_example_workflow)
    client = TestClient(TestServer(app))
    await client.start_server()
    return client


async def test_example_workflow_legitimate_name_still_loads(sandbox):
    client = await _client()
    try:
        resp = await client.get("/api/lm/example-workflows/Basic_flow.json")
        assert resp.status == 200
        payload = await resp.json()
        assert payload["workflow"] == {"nodes": [1]}

        resp = await client.get("/api/lm/example-workflows/Default")
        assert resp.status == 200

        resp = await client.get("/api/lm/example-workflows/Missing.json")
        assert resp.status == 404
    finally:
        await client.close()


@pytest.mark.parametrize(
    "raw",
    [
        "..%5Csettings.json",
        "..%5C..%5Cx.json",
        "..%2Fsettings.json",
        "..%2F..%2Fx.json",
        "%5Cabs.json",
        "%2Fabs.json",
        "C:%5CWindows%5Cwin.ini.json",
        "C:evil.json",
        "%5C%5Csrv%5Cshare%5Cx.json",
        "%2F%2Fsrv%2Fshare%2Fx.json",
        "%5C%5C%3F%5CC:%5Cx.json",
        "%5C%5C.%5CNUL",
        "NUL.json",
        "con.json",
        "x.json:stream",
        "x.json%00",
        "settings.json.",
        "Basic_flow.txt",
    ],
)
async def test_example_workflow_rejects_traversal(sandbox, raw):
    tmp_path, examples, touched = sandbox
    client = await _client()
    try:
        resp = await client.get(f"/api/lm/example-workflows/{raw}")
        body = await resp.text()
        assert resp.status in (400, 404)
        assert "SECRET" not in body
        assert '"secret"' not in body
    finally:
        await client.close()
    # Rejected before any filesystem access.
    assert touched == []
