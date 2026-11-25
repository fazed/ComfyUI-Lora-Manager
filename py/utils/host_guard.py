"""Host check against DNS rebinding (fork).

A DNS-rebinding attacker makes their own domain (``evil.example.com``)
resolve to ``127.0.0.1``. The browser then treats the attacker's page and
LoRA Manager as the *same origin*: ``Sec-Fetch-Site`` says ``same-origin``,
so the request guard (``py/utils/request_guard.py``) and ComfyUI's origin
middleware let the requests through, and the page can even read the
responses (settings, library, queue). The only thing the attacker cannot
change is the ``Host`` header: it carries the attacker's domain name.

This module rejects requests to LoRA Manager routes whose ``Host`` is a
domain name we do not know. Rules (documented in ``ui/README.md``, "Host
check (DNS rebinding)"), applied to the hostname from ``Host`` (port
stripped, IPv6 brackets removed, lower-cased, one trailing dot removed):

1. no ``Host`` header (HTTP/1.0 clients, some tools): allow. Browsers always
   send ``Host``, so a missing header is never a rebinding attack;
2. an IP literal (IPv4 or IPv6, any address): allow. Rebinding needs a
   domain name, and LAN access by IP must keep working;
3. ``localhost`` or ``*.localhost``: allow (browsers resolve these locally);
4. a name listed in the ``allowed_hosts`` setting or the
   ``LORA_MANAGER_ALLOWED_HOSTS`` environment variable (comma-separated):
   allow. Entries match case-insensitively, a port in an entry is ignored,
   ``*.example.lan`` matches subdomains of ``example.lan`` (not
   ``example.lan`` itself), Unicode names are converted to punycode;
5. anything else, including a malformed ``Host`` (userinfo, bad port,
   characters outside a hostname, longer than 255 characters): reject with
   HTTP 403 ``{"success": false, "error": "Host not allowed: ...",
   "code": "host_not_allowed"}``. The first block per host is logged as a
   warning.

Scope. Standalone mode serves only LoRA Manager, so
:data:`standalone_host_guard` checks every path. In ComfyUI mode the app
belongs to ComfyUI and the check must not touch ComfyUI's own routes, so
:data:`host_guard` only checks requests that LoRA Manager owns:
``LoraManager.add_routes`` records every resource it registers in
:data:`LM_ROUTE_SCOPE` (``register_lm_routes``), which derives a path-prefix
list from that route table. A request is ours when its matched resource is
one of those, or its path is one of the exact LM paths or starts with one of
the derived prefixes (``/api/lm/`` is always included, so unknown paths in
our namespace are checked as well).
"""

from __future__ import annotations

import ipaddress
import logging
import os
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Iterable, Optional, Sequence
from urllib.parse import urlsplit

from aiohttp import web

logger = logging.getLogger(__name__)

HOST_BLOCKED_CODE = "host_not_allowed"
HOST_BLOCKED_STATUS = 403
ALLOWED_HOSTS_SETTING = "allowed_hosts"
ALLOWED_HOSTS_ENV = "LORA_MANAGER_ALLOWED_HOSTS"

#: Longest ``Host`` header we parse (a DNS name is at most 253 characters,
#: plus a port).
MAX_HOST_HEADER_LENGTH = 255
_DISPLAY_LIMIT = 80

_HOST_CHARS_RE = re.compile(r"^[A-Za-z0-9._\-:\[\]]+$")
_LABEL_RE = re.compile(r"^[a-z0-9_](?:[a-z0-9_\-]{0,61}[a-z0-9_])?$")
_PORT_RE = re.compile(r"^[0-9]{0,5}$")
_SCHEME_RE = re.compile(r"^[a-z][a-z0-9+.\-]*://")


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _is_hostname(name: str) -> bool:
    if not name or len(name) > 253:
        return False
    return all(_LABEL_RE.match(label) for label in name.split("."))


def _ip_literal(value: str) -> Optional[str]:
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        return None


def parse_host_header(value: Optional[str]) -> tuple[str, Optional[str]]:
    """Classify a ``Host`` header value.

    Returns ``("missing", None)``, ``("invalid", None)``, ``("ip", address)``
    or ``("name", hostname)`` (lower-cased, port and one trailing dot
    removed).
    """

    if value is None:
        return "missing", None
    raw = value.strip()
    if not raw:
        return "missing", None
    if len(raw) > MAX_HOST_HEADER_LENGTH or not _HOST_CHARS_RE.match(raw):
        return "invalid", None

    if raw.startswith("["):
        end = raw.find("]")
        if end == -1:
            return "invalid", None
        rest = raw[end + 1 :]
        if rest and not (rest.startswith(":") and _PORT_RE.match(rest[1:])):
            return "invalid", None
        address = _ip_literal(raw[1:end])
        if address is None or ":" not in address:
            return "invalid", None
        return "ip", address

    if raw.count(":") > 1:
        address = _ip_literal(raw)  # unbracketed IPv6, no port
        return ("ip", address) if address is not None else ("invalid", None)

    host, _, port = raw.partition(":")
    if "[" in host or "]" in host or not _PORT_RE.match(port):
        return "invalid", None
    host = host.lower()
    if host.endswith("."):
        host = host[:-1]
    if not host:
        return "invalid", None
    address = _ip_literal(host)
    if address is not None:
        return "ip", address
    if not _is_hostname(host):
        return "invalid", None
    return "name", host


def _to_ascii(name: str) -> Optional[str]:
    if name.isascii():
        return name
    try:
        return name.encode("idna").decode("ascii")
    except UnicodeError:
        return None


def normalize_allowed_host_entry(entry: Any) -> Optional[str]:
    """Normalise one ``allowed_hosts`` entry, or ``None`` when unusable.

    Accepts ``name``, ``name:port``, ``*.domain``, IP literals and, for
    convenience, a full URL (``http://comfy.lan:8188/``). The port is
    dropped; Unicode names become punycode.
    """

    if not isinstance(entry, str):
        return None
    value = entry.strip().lower()
    if not value:
        return None
    if _SCHEME_RE.match(value):
        try:
            value = urlsplit(value).netloc
        except ValueError:
            return None
    else:
        value = value.split("/", 1)[0]
    if "@" in value:
        return None

    wildcard = value.startswith("*.")
    if wildcard:
        value = value[2:]
    if "*" in value:
        return None

    if not value.isascii():
        # Unicode name: drop a port, then convert to punycode (the form
        # browsers put in the Host header).
        head, sep, port = value.rpartition(":")
        if sep and _PORT_RE.match(port):
            value = head
        if value.endswith("."):
            value = value[:-1]
        converted = _to_ascii(value) if value else None
        if converted is None:
            return None
        value = converted

    kind, hostname = parse_host_header(value)
    if kind == "ip" and not wildcard:
        return hostname
    if kind != "name" or hostname is None:
        return None
    return f"*.{hostname}" if wildcard else hostname


def normalize_allowed_hosts(value: Any) -> list[str]:
    """Normalise the ``allowed_hosts`` setting: a list (or a comma/newline
    separated string) of entries; invalid entries and duplicates dropped."""

    if value is None:
        return []
    if isinstance(value, str):
        candidates: Iterable[Any] = re.split(r"[,\n;]", value)
    elif isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        candidates = value
    else:
        return []
    result: list[str] = []
    for candidate in candidates:
        entry = normalize_allowed_host_entry(candidate)
        if entry is not None and entry not in result:
            result.append(entry)
    return result


# ---------------------------------------------------------------------------
# Allowlist and decision
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AllowedHosts:
    exact: frozenset[str]
    suffixes: tuple[str, ...]  # ".my.tld" for "*.my.tld"

    @classmethod
    def from_entries(cls, entries: Iterable[Any]) -> "AllowedHosts":
        exact: set[str] = set()
        suffixes: list[str] = []
        for entry in normalize_allowed_hosts(list(entries)):
            if entry.startswith("*."):
                suffixes.append(entry[1:])
            else:
                exact.add(entry)
        return cls(frozenset(exact), tuple(suffixes))

    def matches(self, hostname: str) -> bool:
        if hostname in self.exact:
            return True
        return any(hostname.endswith(suffix) for suffix in self.suffixes)


EMPTY_ALLOWED_HOSTS = AllowedHosts(frozenset(), ())


@dataclass(frozen=True)
class HostDecision:
    allowed: bool
    reason: str
    display_host: str = ""


def _display(value: str) -> str:
    cleaned = "".join(ch if ch.isprintable() else "?" for ch in value.strip())
    if len(cleaned) > _DISPLAY_LIMIT:
        cleaned = cleaned[: _DISPLAY_LIMIT - 3] + "..."
    return cleaned


def evaluate_host(host_header: Optional[str], allowed: AllowedHosts) -> HostDecision:
    """Decide whether a request with this ``Host`` header may proceed."""

    kind, hostname = parse_host_header(host_header)
    if kind == "missing":
        return HostDecision(True, "missing-host")
    if kind == "invalid" or hostname is None:
        return HostDecision(False, "invalid-host", _display(host_header or ""))
    if kind == "ip":
        return HostDecision(True, "ip-literal", hostname)
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return HostDecision(True, "localhost", hostname)
    if allowed.matches(hostname):
        return HostDecision(True, "allowed-hosts", hostname)
    return HostDecision(False, "not-allowed", hostname)


_ALLOWLIST_CACHE: Optional[tuple[Any, AllowedHosts]] = None


def _freeze(value: Any) -> Any:
    if isinstance(value, (list, tuple)):
        return tuple(item if isinstance(item, str) else repr(item) for item in value)
    if value is None or isinstance(value, str):
        return value
    return repr(value)


def effective_allowed_hosts(setting_value: Any) -> AllowedHosts:
    """Allowlist from the setting value plus the environment variable.

    Cached on the raw values, so it is rebuilt only when the setting or the
    environment changes (no file access per request).
    """

    global _ALLOWLIST_CACHE
    env_value = os.environ.get(ALLOWED_HOSTS_ENV, "")
    key = (_freeze(setting_value), env_value)
    cached = _ALLOWLIST_CACHE
    if cached is not None and cached[0] == key:
        return cached[1]
    entries = normalize_allowed_hosts(setting_value) + normalize_allowed_hosts(env_value)
    allowed = AllowedHosts.from_entries(entries) if entries else EMPTY_ALLOWED_HOSTS
    _ALLOWLIST_CACHE = (key, allowed)
    return allowed


def _default_allowed_hosts_provider() -> Any:
    from ..services.settings_manager import get_settings_manager

    return get_settings_manager().get(ALLOWED_HOSTS_SETTING)


# ---------------------------------------------------------------------------
# Route scope (ComfyUI mode)
# ---------------------------------------------------------------------------


class LmRouteScope:
    """The routes LoRA Manager registered on a shared (ComfyUI) app."""

    ALWAYS_PREFIXES = ("/api/lm/",)

    def __init__(self) -> None:
        self._resources: set[int] = set()
        self._exact: set[str] = set()
        self._prefixes: set[str] = set(self.ALWAYS_PREFIXES)

    @property
    def exact_paths(self) -> frozenset[str]:
        return frozenset(self._exact)

    @property
    def prefixes(self) -> frozenset[str]:
        return frozenset(self._prefixes)

    def add_resources(self, resources: Iterable[Any]) -> None:
        for resource in resources:
            canonical = getattr(resource, "canonical", None)
            if not isinstance(canonical, str) or not canonical.startswith("/"):
                continue
            self._resources.add(id(resource))
            if isinstance(resource, web.StaticResource):
                base = canonical.rstrip("/")
                if base:
                    self._exact.add(base)
                    self._prefixes.add(base + "/")
            elif "{" in canonical:
                static_part = canonical.split("{", 1)[0]
                prefix = static_part[: static_part.rfind("/") + 1]
                if prefix not in ("", "/"):  # never claim the whole app
                    self._prefixes.add(prefix)
            else:
                self._exact.add(canonical)

    def covers_resource(self, resource: Any) -> bool:
        return resource is not None and id(resource) in self._resources

    def covers_path(self, path: str) -> bool:
        if path in self._exact:
            return True
        return any(path.startswith(prefix) for prefix in self._prefixes)

    def covers(self, request: web.Request) -> bool:
        if self.covers_path(request.path):
            return True
        try:
            resource = request.match_info.route.resource
        except AttributeError:
            return False
        return self.covers_resource(resource)


#: Routes registered by ``LoraManager.add_routes`` (ComfyUI mode).
LM_ROUTE_SCOPE = LmRouteScope()


def register_lm_routes(resources: Iterable[Any]) -> None:
    """Record resources LoRA Manager registered (called by ``add_routes``)."""

    LM_ROUTE_SCOPE.add_resources(resources)


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

_LOGGED_HOSTS: set[str] = set()
_LOGGED_HOSTS_LIMIT = 256

_DEFAULT_SCOPE = object()


def _log_block_once(request: web.Request, decision: HostDecision) -> None:
    logger.debug(
        "Host check blocked %s %s (host=%s, reason=%s)",
        request.method, request.path, decision.display_host, decision.reason,
    )
    if decision.display_host in _LOGGED_HOSTS:
        return
    if len(_LOGGED_HOSTS) < _LOGGED_HOSTS_LIMIT:
        _LOGGED_HOSTS.add(decision.display_host)
    logger.warning(
        "LoRA Manager blocked %s %s for Host '%s' (%s): only IP addresses, "
        "localhost and the hostnames in the LoRA Manager setting %s (or the %s "
        "environment variable) are accepted, to prevent DNS rebinding. Add the "
        "hostname there if you reach ComfyUI through it. Further blocks for this "
        "host are logged at debug level.",
        request.method, request.path, decision.display_host, decision.reason,
        ALLOWED_HOSTS_SETTING, ALLOWED_HOSTS_ENV,
    )


def host_blocked_response(display_host: str) -> web.Response:
    return web.json_response(
        {
            "success": False,
            "error": (
                f"Host not allowed: {display_host}. Add it to the LoRA Manager "
                f"setting {ALLOWED_HOSTS_SETTING} if you access ComfyUI through "
                "this hostname."
            ),
            "code": HOST_BLOCKED_CODE,
        },
        status=HOST_BLOCKED_STATUS,
    )


Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]


def create_host_guard(
    *,
    scope: Any = _DEFAULT_SCOPE,
    allowed_hosts_provider: Optional[Callable[[], Any]] = None,
):
    """Build the host-check middleware.

    ``scope``: an :class:`LmRouteScope` (only its routes are checked),
    ``None`` (every path is checked: standalone), or the default
    (:data:`LM_ROUTE_SCOPE`, resolved per request).
    ``allowed_hosts_provider``: returns the raw ``allowed_hosts`` setting;
    defaults to the settings manager (in-memory read, no file access).
    """

    @web.middleware
    async def middleware(request: web.Request, handler: Handler) -> web.StreamResponse:
        active_scope = LM_ROUTE_SCOPE if scope is _DEFAULT_SCOPE else scope
        if active_scope is not None and not active_scope.covers(request):
            return await handler(request)

        host_header = request.headers.get("Host")
        kind, _ = parse_host_header(host_header)
        if kind in ("missing", "ip"):
            return await handler(request)

        provider = allowed_hosts_provider or _default_allowed_hosts_provider
        try:
            setting_value = provider()
        except Exception as exc:  # settings not ready: built-in rules only
            logger.debug("Host check could not read %s: %s", ALLOWED_HOSTS_SETTING, exc)
            setting_value = None
        decision = evaluate_host(host_header, effective_allowed_hosts(setting_value))
        if decision.allowed:
            return await handler(request)
        _log_block_once(request, decision)
        return host_blocked_response(decision.display_host)

    return middleware


#: ComfyUI mode: only LoRA Manager's own routes (:data:`LM_ROUTE_SCOPE`).
host_guard = create_host_guard()
host_guard.__name__ = "host_guard"

#: Standalone mode: the whole app is LoRA Manager.
standalone_host_guard = create_host_guard(scope=None)
standalone_host_guard.__name__ = "standalone_host_guard"


def install_host_guard(app: web.Application, middleware: Any = None) -> None:
    """Insert the host check right after ``api_json_error`` (idempotent).

    Used in ComfyUI mode, where the app's middleware list belongs to
    ComfyUI's PromptServer. Called after ``install_request_guard`` so the
    order is ``api_json_error, host_guard, request_guard``.
    """

    middleware = middleware or host_guard
    if middleware in app.middlewares:
        return
    index = next(
        (
            idx + 1
            for idx, existing in enumerate(app.middlewares)
            if getattr(existing, "__name__", "") == "api_json_error"
        ),
        0,
    )
    app.middlewares.insert(index, middleware)
