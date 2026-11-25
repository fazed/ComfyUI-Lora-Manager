"""Host check against DNS rebinding: parsing, allowlist and decision matrix.

Pure functions only; the middleware is covered in
``test_host_guard_middleware.py``.
"""

from __future__ import annotations

import pytest

from py.utils import host_guard
from py.utils.host_guard import (
    ALLOWED_HOSTS_ENV,
    AllowedHosts,
    evaluate_host,
    normalize_allowed_host_entry,
    normalize_allowed_hosts,
    parse_host_header,
)


def _allow(*entries: str) -> AllowedHosts:
    return AllowedHosts.from_entries(entries)


NONE = _allow()


# ---------------------------------------------------------------------------
# Host header parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "header,kind,hostname",
    [
        ("127.0.0.1:8188", "ip", "127.0.0.1"),
        ("127.0.0.1", "ip", "127.0.0.1"),
        ("[::1]:8188", "ip", "::1"),
        ("[::1]", "ip", "::1"),
        ("::1", "ip", "::1"),  # unbracketed IPv6 without port (some tools)
        ("[fe80::1%25eth0]:8188", "invalid", None),  # percent-encoded zone is not a Host form we accept
        ("localhost:8000", "name", "localhost"),
        ("LOCALHOST", "name", "localhost"),
        ("localhost.", "name", "localhost"),
        ("Foo.Localhost:80", "name", "foo.localhost"),
        ("192.168.1.20", "ip", "192.168.1.20"),
        ("evil.example.com", "name", "evil.example.com"),
        ("evil.example.com.", "name", "evil.example.com"),
        ("127.0.0.1.evil.com", "name", "127.0.0.1.evil.com"),
        ("my_host.lan:8188", "name", "my_host.lan"),
        ("xn--bcher-kva.lan", "name", "xn--bcher-kva.lan"),
        ("host:", "name", "host"),  # empty port is allowed by RFC 3986
    ],
)
def test_parse_host_header(header, kind, hostname) -> None:
    assert parse_host_header(header) == (kind, hostname)


@pytest.mark.parametrize("header", [None, "", "   "])
def test_parse_missing_host(header) -> None:
    assert parse_host_header(header) == ("missing", None)


@pytest.mark.parametrize(
    "header",
    [
        "a@b",
        "127.0.0.1@evil.com",
        "user:pass@localhost",
        "localhost:80:80",
        "localhost:http",
        "localhost:123456",
        "[::1",
        "[::1]x",
        "[evil.com]:80",
        "local host",
        "localhost/x",
        "bücher.lan",  # browsers send punycode; raw Unicode is not a valid Host
        "localhost..",
        ".localhost",
        "a..b",
        "x" * 300,
        "a." * 140 + "localhost",
        "\x00localhost",
    ],
)
def test_parse_invalid_host(header) -> None:
    assert parse_host_header(header) == ("invalid", None)


# ---------------------------------------------------------------------------
# Decision
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "header,reason",
    [
        ("127.0.0.1:8188", "ip-literal"),
        ("[::1]:8188", "ip-literal"),
        ("192.168.1.20", "ip-literal"),
        ("10.0.0.5:8188", "ip-literal"),
        ("[2001:db8::1]:8188", "ip-literal"),
        ("8.8.8.8", "ip-literal"),  # any address: rebinding needs a name
        ("localhost:8000", "localhost"),
        ("LOCALHOST", "localhost"),
        ("localhost.", "localhost"),
        ("foo.localhost", "localhost"),
        ("a.b.localhost:8188", "localhost"),
        (None, "missing-host"),
        ("", "missing-host"),
    ],
)
def test_allowed_without_configuration(header, reason) -> None:
    decision = evaluate_host(header, NONE)
    assert decision.allowed is True
    assert decision.reason == reason


@pytest.mark.parametrize(
    "header,hostname",
    [
        ("evil.example.com", "evil.example.com"),
        ("evil.example.com:8188", "evil.example.com"),
        ("evil.example.com.", "evil.example.com"),
        ("localhost.evil.com", "localhost.evil.com"),
        ("127.0.0.1.evil.com", "127.0.0.1.evil.com"),
        ("localhostx", "localhostx"),
        ("xlocalhost", "xlocalhost"),
        ("comfy.lan", "comfy.lan"),
        ("my_host.lan", "my_host.lan"),
        ("xn--bcher-kva.lan", "xn--bcher-kva.lan"),
    ],
)
def test_names_are_blocked_without_configuration(header, hostname) -> None:
    decision = evaluate_host(header, NONE)
    assert decision.allowed is False
    assert decision.reason == "not-allowed"
    assert decision.display_host == hostname


@pytest.mark.parametrize("header", ["a@b", "x" * 5000, "local host", "[::1"])
def test_invalid_host_is_blocked(header) -> None:
    decision = evaluate_host(header, NONE)
    assert decision.allowed is False
    assert decision.reason == "invalid-host"
    assert len(decision.display_host) <= 80


def test_listed_hostname_is_allowed() -> None:
    allowed = _allow("comfy.lan")
    assert evaluate_host("comfy.lan:8188", allowed).allowed
    assert evaluate_host("COMFY.LAN", allowed).allowed
    assert evaluate_host("comfy.lan.", allowed).allowed
    assert not evaluate_host("x.comfy.lan", allowed).allowed
    assert not evaluate_host("comfy.lan.evil.com", allowed).allowed
    assert not evaluate_host("evilcomfy.lan", allowed).allowed
    assert evaluate_host("comfy.lan", allowed).reason == "allowed-hosts"


def test_wildcard_matches_subdomains_only() -> None:
    allowed = _allow("*.my.tld")
    assert evaluate_host("a.my.tld", allowed).allowed
    assert evaluate_host("a.b.my.tld:443", allowed).allowed
    assert evaluate_host("A.MY.TLD", allowed).allowed
    assert not evaluate_host("my.tld", allowed).allowed
    assert not evaluate_host("evilmy.tld", allowed).allowed
    assert not evaluate_host("my.tld.evil.com", allowed).allowed


def test_entry_port_is_ignored() -> None:
    allowed = _allow("comfy.lan:8188")
    assert evaluate_host("comfy.lan:8188", allowed).allowed
    assert evaluate_host("comfy.lan:9000", allowed).allowed
    assert evaluate_host("comfy.lan", allowed).allowed


def test_idna_entry_matches_punycode_host() -> None:
    allowed = _allow("Bücher.lan")
    assert evaluate_host("xn--bcher-kva.lan", allowed).allowed
    allowed = _allow("xn--bcher-kva.lan")
    assert evaluate_host("xn--bcher-kva.lan:8188", allowed).allowed


def test_underscore_hostname_can_be_listed() -> None:
    assert evaluate_host("my_host.lan", _allow("MY_HOST.lan")).allowed


def test_userinfo_is_never_allowed_even_if_listed() -> None:
    assert not evaluate_host("a@comfy.lan", _allow("comfy.lan")).allowed


# ---------------------------------------------------------------------------
# Allowlist entries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "entry,expected",
    [
        ("comfy.lan", "comfy.lan"),
        ("  Comfy.LAN  ", "comfy.lan"),
        ("comfy.lan:8188", "comfy.lan"),
        ("comfy.lan.", "comfy.lan"),
        ("http://comfy.lan:8188/", "comfy.lan"),
        ("https://comfy.lan/lm-ui/", "comfy.lan"),
        ("*.my.tld", "*.my.tld"),
        ("*.My.Tld:443", "*.my.tld"),
        ("Bücher.lan", "xn--bcher-kva.lan"),
        ("my_host", "my_host"),
        ("192.168.1.20", "192.168.1.20"),
        ("[::1]:8188", "::1"),
    ],
)
def test_normalize_entry(entry, expected) -> None:
    assert normalize_allowed_host_entry(entry) == expected


@pytest.mark.parametrize(
    "entry",
    ["", "   ", "*", "*.", "*.*.lan", "a*.lan", "*.127.0.0.1", "a@b", "local host", None, 5, ["x"]],
)
def test_reject_entry(entry) -> None:
    assert normalize_allowed_host_entry(entry) is None


def test_normalize_allowed_hosts_list_and_string() -> None:
    assert normalize_allowed_hosts(["comfy.lan", "COMFY.lan:8188", "", "a@b", "*.my.tld"]) == [
        "comfy.lan",
        "*.my.tld",
    ]
    assert normalize_allowed_hosts("comfy.lan, *.my.tld\nother.lan") == [
        "comfy.lan",
        "*.my.tld",
        "other.lan",
    ]
    assert normalize_allowed_hosts(None) == []
    assert normalize_allowed_hosts({"a": 1}) == []


# ---------------------------------------------------------------------------
# Effective allowlist: setting + environment, cached
# ---------------------------------------------------------------------------


def test_effective_allowlist_combines_setting_and_env(monkeypatch) -> None:
    monkeypatch.setenv(ALLOWED_HOSTS_ENV, "env.lan, *.env.tld")
    allowed = host_guard.effective_allowed_hosts(["comfy.lan"])
    assert evaluate_host("comfy.lan", allowed).allowed
    assert evaluate_host("env.lan", allowed).allowed
    assert evaluate_host("x.env.tld", allowed).allowed
    assert not evaluate_host("evil.com", allowed).allowed


def test_effective_allowlist_is_cached_and_follows_changes(monkeypatch) -> None:
    monkeypatch.delenv(ALLOWED_HOSTS_ENV, raising=False)
    first = host_guard.effective_allowed_hosts(["comfy.lan"])
    assert host_guard.effective_allowed_hosts(["comfy.lan"]) is first
    second = host_guard.effective_allowed_hosts(["comfy.lan", "other.lan"])
    assert second is not first
    assert evaluate_host("other.lan", second).allowed
    monkeypatch.setenv(ALLOWED_HOSTS_ENV, "env.lan")
    third = host_guard.effective_allowed_hosts(["comfy.lan", "other.lan"])
    assert evaluate_host("env.lan", third).allowed


def test_effective_allowlist_tolerates_garbage(monkeypatch) -> None:
    monkeypatch.delenv(ALLOWED_HOSTS_ENV, raising=False)
    for value in (None, "", 5, {"x": 1}, ["comfy.lan", None, 3]):
        allowed = host_guard.effective_allowed_hosts(value)
        assert not evaluate_host("evil.com", allowed).allowed
