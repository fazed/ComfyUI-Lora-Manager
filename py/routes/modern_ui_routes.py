"""Routes for the fork-local modern web UI (``ui/`` at the repository root).

This module is intentionally self-contained so the fork can keep syncing with
upstream without merge conflicts: the only upstream-owned code that references
it is one registration line in ``py/lora_manager.py`` and one in
``standalone.py``.

What it serves
--------------
* ``GET /lm-ui`` redirects (relatively, so any reverse-proxy prefix survives)
  to ``/lm-ui/``.
* ``GET /lm-ui/{tail}`` serves the pre-built single-page app from
  ``ui/dist``:

  - paths whose last segment has a file extension (``assets/index-abc.js``,
    ``favicon.svg``, ...) are served as static files, or answered with 404 when
    missing, so a broken asset reference never silently receives HTML;
  - every other path falls back to ``index.html`` (client-side routing). A
    relative ``<base href>`` is injected so the hashed assets resolve no matter
    how deep the SPA route is and no matter which prefix a reverse proxy
    (llama-swap, SwarmUI, ...) mounted ComfyUI under. The backend only ever
    sees the stripped path, exactly like ``relative_root_prefix`` for the
    classic templates.

* User themes (no rebuild needed): CSS files dropped into
  ``<settings dir>/ui-themes/*.css`` are listed by ``GET /api/lm/ui/themes``
  and served from ``GET /lm-ui/user-themes/{file}``. A theme declares itself
  with an optional header comment ``/* @lm-theme {"id": ..., "label": ...,
  "scheme": "light"|"dark", "description": ...} */``.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable

from aiohttp import web

logger = logging.getLogger(__name__)

MOUNT = "/lm-ui"
THEMES_API = "/api/lm/ui/themes"
USER_THEMES_SEGMENT = "user-themes"
USER_THEMES_DIRNAME = "ui-themes"

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DIST_DIR = os.path.join(_REPO_ROOT, "ui", "dist")

_THEME_FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*\.css$")
_THEME_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
_THEME_HEADER_RE = re.compile(r"/\*\s*@lm-theme\s+(\{.*?\})\s*\*/", re.DOTALL)
_HEAD_RE = re.compile(r"<head[^>]*>", re.IGNORECASE)

_NOT_BUILT_HTML = (
    "<!doctype html><meta charset='utf-8'><title>LoRA Manager UI</title>"
    "<p>The modern UI has not been built. Run <code>bun install &amp;&amp; "
    "bun run build</code> in the <code>ui/</code> folder.</p>"
)


def _default_user_themes_dir() -> str | None:
    try:
        from ..utils.settings_paths import get_settings_dir

        return os.path.join(get_settings_dir(create=False), USER_THEMES_DIRNAME)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Could not resolve settings dir for UI themes: %s", exc)
        return None


def relative_base_href(tail: str) -> str:
    """Return the relative ``<base href>`` that points back at the mount root.

    ``tail`` is the request path below ``/lm-ui/``: ``""`` or ``"loras"`` keep
    ``./``; ``"loras/x"`` or ``"loras/"`` need ``../``.
    """

    depth = tail.lstrip("/").count("/")
    return "../" * depth if depth else "./"


def _safe_join(root: str, relative: str) -> str | None:
    """Join ``relative`` under ``root``; ``None`` when it would escape it."""

    if not relative or "\x00" in relative:
        return None
    root_abs = os.path.abspath(root)
    candidate = os.path.abspath(os.path.join(root_abs, *relative.split("/")))
    if candidate != root_abs and candidate.startswith(root_abs + os.sep):
        return candidate
    return None


def parse_theme_header(css: str, fallback_id: str) -> dict[str, Any]:
    """Read the optional ``@lm-theme`` JSON header of a user theme file."""

    meta: dict[str, Any] = {}
    match = _THEME_HEADER_RE.search(css[:4096])
    if match:
        try:
            parsed = json.loads(match.group(1))
            if isinstance(parsed, dict):
                meta = parsed
        except ValueError:
            logger.warning("Ignoring invalid @lm-theme header in %s", fallback_id)

    theme_id = str(meta.get("id") or fallback_id)
    if not _THEME_ID_RE.match(theme_id):
        theme_id = fallback_id
    scheme = meta.get("scheme")
    return {
        "id": theme_id,
        "label": str(meta.get("label") or theme_id),
        "scheme": scheme if scheme in ("light", "dark") else "light",
        "description": str(meta.get("description") or ""),
    }


class ModernUiRoutes:
    """Serve the modern UI SPA and the user-theme directory."""

    def __init__(
        self,
        *,
        dist_dir: str | None = None,
        user_themes_dir: str | None | Callable[[], str | None] = None,
    ) -> None:
        self._dist_dir = dist_dir or DEFAULT_DIST_DIR
        self._user_themes_dir = (
            user_themes_dir if user_themes_dir is not None else _default_user_themes_dir
        )

    @classmethod
    def setup_routes(cls, app: web.Application, **kwargs: Any) -> "ModernUiRoutes":
        controller = cls(**kwargs)
        controller.register(app)
        return controller

    def register(self, app: web.Application) -> None:
        app.router.add_get(THEMES_API, self.list_user_themes)
        app.router.add_get(MOUNT, self.redirect_to_mount)
        app.router.add_get(MOUNT + "/{tail:.*}", self.serve)

    # -- helpers ---------------------------------------------------------

    def _themes_dir(self) -> str | None:
        value = self._user_themes_dir
        return value() if callable(value) else value

    # -- handlers --------------------------------------------------------

    async def redirect_to_mount(self, request: web.Request) -> web.StreamResponse:
        # Relative Location keeps any reverse-proxy prefix: "/p/lm-ui" -> "/p/lm-ui/".
        target = MOUNT.rsplit("/", 1)[-1] + "/"
        if request.query_string:
            target += "?" + request.query_string
        raise web.HTTPFound(target)

    async def serve(self, request: web.Request) -> web.StreamResponse:
        tail = request.match_info.get("tail", "")

        if tail.startswith(USER_THEMES_SEGMENT + "/"):
            return self._serve_user_theme(tail[len(USER_THEMES_SEGMENT) + 1 :])

        last_segment = tail.rsplit("/", 1)[-1]
        if "." in last_segment:
            return self._serve_asset(tail)

        return self._serve_index(tail)

    def _serve_asset(self, tail: str) -> web.StreamResponse:
        path = _safe_join(self._dist_dir, tail)
        if not path or not os.path.isfile(path):
            raise web.HTTPNotFound()
        response = web.FileResponse(path)
        if tail.startswith("assets/"):
            # Vite emits content-hashed file names under assets/.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    def _serve_index(self, tail: str) -> web.StreamResponse:
        index_path = os.path.join(self._dist_dir, "index.html")
        if not os.path.isfile(index_path):
            return web.Response(text=_NOT_BUILT_HTML, content_type="text/html", status=503)
        with open(index_path, "r", encoding="utf-8") as handle:
            html = handle.read()
        base_tag = f'<base href="{relative_base_href(tail)}">'
        match = _HEAD_RE.search(html)
        if match:
            html = html[: match.end()] + base_tag + html[match.end() :]
        else:
            html = base_tag + html
        return web.Response(
            text=html,
            content_type="text/html",
            headers={"Cache-Control": "no-cache"},
        )

    def _serve_user_theme(self, name: str) -> web.StreamResponse:
        themes_dir = self._themes_dir()
        if not themes_dir or not _THEME_FILE_RE.match(name):
            raise web.HTTPNotFound()
        path = _safe_join(themes_dir, name)
        if not path or not os.path.isfile(path):
            raise web.HTTPNotFound()
        response = web.FileResponse(path)
        response.content_type = "text/css"
        response.headers["Cache-Control"] = "no-cache"
        return response

    async def list_user_themes(self, request: web.Request) -> web.Response:
        themes_dir = self._themes_dir()
        themes: list[dict[str, Any]] = []
        if themes_dir and os.path.isdir(themes_dir):
            for name in sorted(os.listdir(themes_dir)):
                if not _THEME_FILE_RE.match(name):
                    continue
                path = os.path.join(themes_dir, name)
                if not os.path.isfile(path):
                    continue
                try:
                    with open(path, "r", encoding="utf-8") as handle:
                        head = handle.read(4096)
                except OSError as exc:
                    logger.warning("Could not read UI theme %s: %s", path, exc)
                    continue
                meta = parse_theme_header(head, os.path.splitext(name)[0])
                # Relative to the app base (``/lm-ui/``), so prefixes survive.
                meta["href"] = f"{USER_THEMES_SEGMENT}/{name}"
                themes.append(meta)
        return web.json_response(
            {"success": True, "themes": themes, "directory": themes_dir or ""}
        )


__all__ = ["ModernUiRoutes", "MOUNT", "relative_base_href", "parse_theme_header"]
