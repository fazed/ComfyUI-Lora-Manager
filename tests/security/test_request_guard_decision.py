"""Decision matrix of the CSRF guard for state-changing GET routes.

The expected outcome is written out independently of the implementation
(``_expected``) and checked for every combination of ``Sec-Fetch-Site`` x
``X-LM-Client`` x ``Origin``.
"""

from __future__ import annotations

import itertools

import pytest

from py.utils.request_guard import (
    EXTENSION_ORIGIN_SCHEMES,
    evaluate_request,
    origin_matches_host,
    valid_client_id,
)

HOST = "127.0.0.1:8188"
SAME_ORIGIN = "http://127.0.0.1:8188"

FETCH_SITES = ["none", "same-origin", "same-site", "cross-site", None]
CLIENT_HEADERS = ["lm-extension", None]
ORIGINS = [
    None,
    SAME_ORIGIN,
    "https://evil.example",
    "chrome-extension://abc",
    "moz-extension://x",
    "null",
]


def _expected(site, header, origin) -> bool:
    if site in ("none", "same-origin"):
        return True  # browser says same-origin page or user-initiated
    if origin in ("chrome-extension://abc", "moz-extension://x"):
        return True  # only an extension can carry this Origin
    if header is not None and origin in (None, SAME_ORIGIN):
        return True  # trusted client, not a foreign web page
    if site is None and origin is None:
        return True  # non-browser client
    return False


@pytest.mark.parametrize(
    "site,header,origin", list(itertools.product(FETCH_SITES, CLIENT_HEADERS, ORIGINS))
)
def test_decision_matrix(site, header, origin) -> None:
    decision = evaluate_request(
        sec_fetch_site=site, origin=origin, client_header=header, host=HOST
    )
    assert decision.allowed is _expected(site, header, origin), decision.reason


def test_matrix_covers_all_documented_blocks() -> None:
    blocked = [
        combo
        for combo in itertools.product(FETCH_SITES, CLIENT_HEADERS, ORIGINS)
        if not _expected(*combo)
    ]
    # Cross-site <img> without anything, a page on another local port, a
    # foreign Origin with the header, an old browser same-origin request
    # without the header, and Origin: null.
    assert ("cross-site", None, None) in blocked
    assert ("same-site", None, None) in blocked
    assert ("cross-site", "lm-extension", "https://evil.example") in blocked
    assert (None, None, SAME_ORIGIN) in blocked
    assert (None, "lm-extension", "null") in blocked


@pytest.mark.parametrize("site", ["SAME-ORIGIN", " none ", "Same-Origin"])
def test_sec_fetch_site_is_case_and_space_insensitive(site) -> None:
    assert evaluate_request(
        sec_fetch_site=site, origin=None, client_header=None, host=HOST
    ).allowed


def test_unknown_sec_fetch_site_value_is_not_trusted() -> None:
    decision = evaluate_request(
        sec_fetch_site="whatever", origin=None, client_header=None, host=HOST
    )
    assert not decision.allowed


@pytest.mark.parametrize("value", ["", "   ", "bad value", "x" * 65, "-lead", "a/b"])
def test_malformed_client_header_counts_as_absent(value) -> None:
    assert not valid_client_id(value)
    decision = evaluate_request(
        sec_fetch_site="cross-site", origin=None, client_header=value, host=HOST
    )
    assert not decision.allowed


@pytest.mark.parametrize("value", ["lm-ui", "lm-classic", "lm-comfyui", "lm-extension", "my.script_1"])
def test_client_ids_accepted(value) -> None:
    assert valid_client_id(value)


def test_safari_extension_origin_allowed() -> None:
    assert "safari-web-extension" in EXTENSION_ORIGIN_SCHEMES
    assert evaluate_request(
        sec_fetch_site="cross-site",
        origin="safari-web-extension://abc",
        client_header=None,
        host=HOST,
    ).allowed


def test_header_with_other_local_port_is_blocked() -> None:
    decision = evaluate_request(
        sec_fetch_site="same-site",
        origin="http://127.0.0.1:3000",
        client_header="lm-ui",
        host=HOST,
    )
    assert not decision.allowed


def test_header_with_same_host_over_https_proxy_is_allowed() -> None:
    # TLS-terminating proxy: page origin https, backend sees the same host.
    assert evaluate_request(
        sec_fetch_site=None,
        origin="https://comfy.lan",
        client_header="lm-ui",
        host="comfy.lan",
    ).allowed


def test_empty_origin_is_treated_as_absent() -> None:
    assert evaluate_request(
        sec_fetch_site=None, origin="", client_header=None, host=HOST
    ).allowed


@pytest.mark.parametrize(
    "origin,host,expected",
    [
        ("http://127.0.0.1:8188", "127.0.0.1:8188", True),
        ("http://LOCALHOST:8188", "localhost:8188", True),
        ("http://example.com", "example.com:80", True),
        ("https://example.com", "example.com:443", True),
        ("http://example.com:8080", "example.com", False),
        ("http://[::1]:8188", "[::1]:8188", True),
        ("http://127.0.0.1:8189", "127.0.0.1:8188", False),
        ("http://127.0.0.1.evil.example:8188", "127.0.0.1:8188", False),
        ("null", "127.0.0.1:8188", False),
        ("file://", "127.0.0.1:8188", False),
        ("http://127.0.0.1:8188", None, False),
        ("http://[bad", "127.0.0.1:8188", False),
    ],
)
def test_origin_matches_host(origin, host, expected) -> None:
    assert origin_matches_host(origin, host) is expected
