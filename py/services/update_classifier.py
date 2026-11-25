"""Read-only classification of model updates for the modern UI's Updates page.

The classic update flag (``ModelUpdateRecord.has_update_for_base``) answers
"is there any remote version with a higher id on the same base?" from the
persisted ``is_in_library`` flags. In a real library that produces many false
positives:

1. variant files of the *same* release (fp8 / fp16 / gguf / remapped /
   high-noise and low-noise, extracted LoRA, ...) are offered as successors;
2. ``is_in_library`` is only refreshed on refresh/download/delete, so it can
   disagree with the scanner (the user owns v2.0, the flag says v1.0);
3. every local file of a model gets its own flag;
4. the version id is used as "newer", although Civitai ids do not follow the
   release order across parallel version lines;
5. a model without a record looks "up to date";
6. versions without a downloadable file count as updates.

This module answers the same question from the same data, but at read time
and with an explanation. It is pure: no Civitai requests, no database
writes. The caller passes the scanner items, the persisted update records and
the download-history version ids; the result is the JSON payload of
``GET /api/lm/{prefix}/updates/overview``.

Classification of one candidate (a remote version not owned by the user,
newer than the newest owned version of the same base model line):

* ``likely``   - the next version on the same base, nothing suspicious;
* ``possible`` - newer on the same base, but ambiguous (variant words in the
  name, a parallel line with another name, a lower version number, released
  within a day of the owned version, no release date, ...);
* ``variant``  - strong evidence that it is another file of a release the
  user already has (or of a sibling candidate). Hidden by default.

Independent of the confidence, ``hiddenBecause`` lists gates that keep a
candidate out of the default view (ignored, not downloadable, no files,
early access / paid when the settings hide them, already downloaded before,
other base model).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Any, Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set

from ..utils.paid_access import is_early_access_deadline_active, parse_civitai_timestamp

__all__ = [
    "CONFIDENCE_LIKELY",
    "CONFIDENCE_POSSIBLE",
    "CONFIDENCE_VARIANT",
    "REASON_CODES",
    "HIDDEN_CODES",
    "DESCRIPTION_MAX_CHARS",
    "NameSignature",
    "name_signature",
    "description_to_text",
    "collect_local_model_ids",
    "build_updates_overview",
]

# Longest changelog text a candidate carries in the overview (characters).
DESCRIPTION_MAX_CHARS = 1200
# Weight-file entries listed per candidate.
FILES_MAX_ENTRIES = 6

CONFIDENCE_LIKELY = "likely"
CONFIDENCE_POSSIBLE = "possible"
CONFIDENCE_VARIANT = "variant"

# Machine-readable reason codes (the UI maps them to text).
REASON_NEXT_VERSION = "next_version_same_base"
REASON_FORMAT_VARIANT = "looks_like_format_variant"
REASON_SAME_RELEASE = "same_release_variant"
REASON_SIBLING_VARIANT = "sibling_variant"
REASON_SAME_DAY_AS_OWNED = "same_day_as_owned"
REASON_PARALLEL_LINE = "parallel_line"
REASON_LOWER_VERSION_NUMBER = "lower_version_number"
REASON_SAME_VERSION_NUMBER = "same_version_number"
REASON_VARIANT_TOKENS = "variant_tokens"
REASON_UNKNOWN_RELEASE_DATE = "unknown_release_date"
REASON_UNKNOWN_BASE = "unknown_base"
REASON_OTHER_BASE = "other_base"
REASON_NEW_LABEL = "new_label"

REASON_CODES = (
    REASON_NEXT_VERSION,
    REASON_FORMAT_VARIANT,
    REASON_SAME_RELEASE,
    REASON_SIBLING_VARIANT,
    REASON_SAME_DAY_AS_OWNED,
    REASON_PARALLEL_LINE,
    REASON_LOWER_VERSION_NUMBER,
    REASON_SAME_VERSION_NUMBER,
    REASON_NEW_LABEL,
    REASON_VARIANT_TOKENS,
    REASON_UNKNOWN_RELEASE_DATE,
    REASON_UNKNOWN_BASE,
    REASON_OTHER_BASE,
)

HIDDEN_IGNORED = "ignored"
HIDDEN_OTHER_BASE = "other_base"
HIDDEN_NOT_DOWNLOADABLE = "not_downloadable"
HIDDEN_NO_FILES = "no_files"
HIDDEN_EARLY_ACCESS = "early_access"
HIDDEN_PAID = "paid"
HIDDEN_ALREADY_DOWNLOADED = "already_downloaded"

HIDDEN_CODES = (
    HIDDEN_IGNORED,
    HIDDEN_OTHER_BASE,
    HIDDEN_NOT_DOWNLOADABLE,
    HIDDEN_NO_FILES,
    HIDDEN_EARLY_ACCESS,
    HIDDEN_PAID,
    HIDDEN_ALREADY_DOWNLOADED,
)

TIER_LIKELY = "likely"
TIER_POSSIBLE = "possible"
TIER_HIDDEN = "hidden"

# Two versions released this close together are treated as one release.
SAME_RELEASE_WINDOW = timedelta(hours=24)
# Relative size difference under which two files count as "the same size".
SIZE_TOLERANCE = 0.03

# Words that describe a file format, precision, quantisation or flavour of a
# release rather than a new release. Matched as whole lowercase tokens.
VARIANT_TOKENS = frozenset(
    {
        # format / precision / quantisation
        "remap", "remapped", "int8", "int4", "nvfp4", "fp4", "fp8", "fp16",
        "fp32", "bf16", "nf4", "gguf", "svdq", "scaled", "e4m3fn", "e5m2",
        "pruned", "ema", "emaonly", "fp8e4m3fn", "8bit", "4bit", "convrot", "svdquant", "awq", "q8", "q6",
        "q5", "q4", "q3", "q2",
        # LoRA flavours of a checkpoint release
        "lora", "extracted", "extract",
        # add-ons of one release
        "plus", "bonus",
        # Wan high-noise / low-noise pairs
        "high", "low", "highnoise", "lownoise", "noise",
        # merge flavours
        "alt", "alternative", "special", "default", "cute", "matte",
    }
)

# GGUF quantisation labels such as q4_k_m / q5_k_s / q8_0 are taken out as a
# whole before tokenising, so their one-letter parts never reach the core.
_GGUF_QUANT = re.compile(r"(?<![a-z0-9])q\d(?:[_-]k(?:[_-][sml])?|[_-][01])?(?![a-z0-9])")
_QUANT_TOKEN = re.compile(r"^q\d(?:k|ks|km|kl|0|1)?$")

# Base-model words that often appear in version names ("Illustrious v2") but
# say nothing about the version line.
_BASE_WORDS = frozenset(
    {
        "il", "ill", "illu", "illust", "illustrious", "illustriousxl", "ilxl",
        "noob", "noobai", "pony", "pdxl", "sdxl", "xl", "sd", "sd1", "sd15",
        "flux", "anima", "krea", "krea2", "wan", "hunyuan", "qwen", "zit",
        "chroma", "base", "model", "version", "ver", "release", "update", "new",
    }
)

_VERSION_PATTERN = re.compile(
    r"(?:^|[^a-z0-9])v(?:er(?:sion)?)?[\s._-]?(\d+(?:\.\d+)*)",
    re.IGNORECASE,
)
_BARE_VERSION_PATTERN = re.compile(r"(?:^|[^a-z0-9.])(\d+(?:\.\d+)+)(?:$|[^0-9.a-z])")
# Parameter counts such as "2.9B" or "14b" name the base, not the version.
_PARAM_COUNT = re.compile(r"(?<![a-z0-9.])\d+(?:\.\d+)?b(?![a-z0-9])")
_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")
# A base word glued to a version number ("IllustriousV2", "animav2.0") is
# split before parsing. Only words of four or more letters: "ILv10" stays.
_GLUED_BASE_VERSION = re.compile(
    r"(?<![a-z0-9])(illustrious|anima|pony|noob|noobai|flux|sdxl|krea|chroma|qwen|hunyuan)"
    r"[\s._-]?v(?=\d)",
    re.IGNORECASE,
)
# Words that mark a pre-release. A candidate with the same version number
# that only drops such words ("v1.0 beta" -> "v1.0") is the final release.
PRERELEASE_TOKENS = frozenset(
    {"beta", "alpha", "wip", "preview", "rc", "test", "early", "pre", "experimental", "draft"}
)
# A Roman numeral token such as "xiv": a numbered successor without digits.
_ROMAN_NUMERAL = re.compile(r"^(?=[ivx]{2,5}$)x{0,2}(ix|iv|v?i{0,3})$")


@dataclass(frozen=True)
class NameSignature:
    """What a version name says: version number, variant words, the rest."""

    version: Optional[tuple]
    variant_tokens: frozenset
    core: tuple


def _parse_version_number(name: str) -> Optional[tuple]:
    match = _VERSION_PATTERN.search(name)
    if match is None:
        match = _BARE_VERSION_PATTERN.search(name)
    if match is None:
        return None
    parts = [int(part) for part in match.group(1).split(".") if part.isdigit()]
    while len(parts) > 1 and parts[-1] == 0:
        parts.pop()
    return tuple(parts) if parts else None


def name_signature(name: Optional[str], base_model: Optional[str] = None) -> NameSignature:
    """Split a version name into version number, variant tokens and core words."""

    text = _GLUED_BASE_VERSION.sub(r" v", (name or "").lower())
    text = _PARAM_COUNT.sub(" ", text)
    version = _parse_version_number(text)
    variant: Set[str] = set()
    for quant in _GGUF_QUANT.findall(text):
        variant.add(quant.replace("-", "_"))
    stripped = _GGUF_QUANT.sub(" ", text)
    stripped = _VERSION_PATTERN.sub(" ", stripped)
    stripped = _BARE_VERSION_PATTERN.sub(" ", stripped)
    base_tokens = set(_TOKEN_SPLIT.split((base_model or "").lower())) - {""}
    core: List[str] = []
    for token in _TOKEN_SPLIT.split(stripped):
        if not token:
            continue
        if token in VARIANT_TOKENS or _QUANT_TOKEN.match(token):
            variant.add(token)
            continue
        if token.isdigit():
            continue
        if token in _BASE_WORDS or token in base_tokens:
            continue
        # "v2" without separator was consumed above; tokens like "anima2"
        # carry a base word plus a number: drop them as base words too.
        alpha = token.rstrip("0123456789")
        if alpha and alpha != token and (alpha in _BASE_WORDS or alpha in base_tokens):
            continue
        core.append(token)
    return NameSignature(version=version, variant_tokens=frozenset(variant), core=tuple(core))


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------


def _to_int(value: Any) -> Optional[int]:
    try:
        if value is None or isinstance(value, bool):
            return None
        return int(value)
    except (TypeError, ValueError):
        return None


def _norm_base(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped.lower() or None


def _parse_date(value: Any) -> Optional[datetime]:
    if not value:
        return None
    parsed = parse_civitai_timestamp(value)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _sizes_close(a: Optional[int], b: Optional[int]) -> bool:
    if not a or not b or a <= 0 or b <= 0:
        return False
    return abs(a - b) / max(a, b) <= SIZE_TOLERANCE


def _within_window(a: Optional[datetime], b: Optional[datetime]) -> bool:
    if a is None or b is None:
        return False
    return abs(a - b) <= SAME_RELEASE_WINDOW


@dataclass
class _Version:
    """A version as the classifier sees it (DB data merged with local data)."""

    version_id: int
    name: Optional[str]
    base_model: Optional[str]
    released_at: Optional[str]
    size_bytes: Optional[int]
    record: Any = None  # ModelVersionRecord or None for local-only versions
    signature: NameSignature = field(default_factory=lambda: NameSignature(None, frozenset(), ()))

    @property
    def date(self) -> Optional[datetime]:
        return _parse_date(self.released_at)

    @property
    def norm_base(self) -> Optional[str]:
        return _norm_base(self.base_model)


def _is_newer(candidate: _Version, owned: _Version) -> tuple[bool, bool]:
    """Return ``(is_newer, by_date)``; the release date wins, the id breaks ties."""

    c_date, o_date = candidate.date, owned.date
    if c_date is not None and o_date is not None:
        if c_date != o_date:
            return c_date > o_date, True
        return candidate.version_id > owned.version_id, True
    return candidate.version_id > owned.version_id, False


def _newest(versions: Sequence[_Version]) -> Optional[_Version]:
    best: Optional[_Version] = None
    for version in versions:
        if best is None:
            best = version
            continue
        newer, _by_date = _is_newer(version, best)
        if newer:
            best = version
    return best


def _same_line_different_format(a: NameSignature, b: NameSignature) -> bool:
    """True when two names differ only in variant words (same core, same number)."""

    return (
        a.core == b.core
        and a.version == b.version
        and a.variant_tokens != b.variant_tokens
    )


def _version_lower(a: Optional[tuple], b: Optional[tuple]) -> bool:
    if a is None or b is None:
        return False
    return a < b


def _is_early_access_active(record: Any, now: Optional[datetime]) -> bool:
    if record is None:
        return False
    ends_at = getattr(record, "early_access_ends_at", None)
    if getattr(record, "is_paid", False) and not ends_at:
        return False
    if ends_at:
        return is_early_access_deadline_active(ends_at, now=now)
    return bool(getattr(record, "is_early_access", False))


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------


def _classify(
    candidate: _Version,
    *,
    owned_line: Sequence[_Version],
    newest_owned: _Version,
    siblings: Sequence[_Version],
    line_known: bool,
    newer_by_date: bool,
) -> tuple[str, str]:
    """Return ``(confidence, reason)`` for one same-base candidate."""

    sig = candidate.signature
    c_date = candidate.date

    # 1. Another format/precision of a version the user owns.
    for owned in owned_line:
        if _same_line_different_format(sig, owned.signature):
            return CONFIDENCE_VARIANT, REASON_FORMAT_VARIANT

    # 2. Released with an owned version, same size, and no higher version number.
    for owned in owned_line:
        if not _within_window(c_date, owned.date):
            continue
        higher_number = (
            sig.version is not None
            and owned.signature.version is not None
            and sig.version > owned.signature.version
        )
        if _sizes_close(candidate.size_bytes, owned.size_bytes) and not higher_number:
            return CONFIDENCE_VARIANT, REASON_SAME_RELEASE
        # Same drop, and the name adds a format/precision word: a variant.
        if sig.variant_tokens - owned.signature.variant_tokens and not higher_number:
            return CONFIDENCE_VARIANT, REASON_FORMAT_VARIANT

    # 3. A format sibling of another candidate from the same release. The
    #    file whose variant words match the owned file is the main one.
    owned_tokens = newest_owned.signature.variant_tokens
    for sibling in siblings:
        if sibling.version_id == candidate.version_id:
            continue
        if not _within_window(c_date, sibling.date):
            continue
        if not _same_line_different_format(sig, sibling.signature):
            continue
        if sig.variant_tokens == owned_tokens:
            continue
        if sig.variant_tokens and not sibling.signature.variant_tokens:
            return CONFIDENCE_VARIANT, REASON_FORMAT_VARIANT
        return CONFIDENCE_POSSIBLE, REASON_SIBLING_VARIANT

    if not line_known:
        return CONFIDENCE_POSSIBLE, REASON_UNKNOWN_BASE

    # 4. Released within a day after an owned version: probably the same drop.
    for owned in owned_line:
        if _within_window(c_date, owned.date):
            higher_number = (
                sig.version is not None
                and owned.signature.version is not None
                and sig.version > owned.signature.version
            )
            if not higher_number:
                return CONFIDENCE_POSSIBLE, REASON_SAME_DAY_AS_OWNED

    # 5. Another named line of the same model (style A vs style B): neither
    #    name's words contain the other's.
    owned_core = set(newest_owned.signature.core)
    cand_core = set(sig.core)
    if (
        cand_core
        and owned_core
        and not cand_core <= owned_core
        and not owned_core <= cand_core
    ):
        return CONFIDENCE_POSSIBLE, REASON_PARALLEL_LINE

    # 6. Released later but numbered lower than (or the same as) what the
    #    user has: a re-upload or another line, not a clear successor. The
    #    one exception: the same number that only drops pre-release words
    #    ("v1.0 beta" -> "v1.0") is the final release.
    if _version_lower(sig.version, newest_owned.signature.version):
        return CONFIDENCE_POSSIBLE, REASON_LOWER_VERSION_NUMBER
    if sig.version is not None and sig.version == newest_owned.signature.version:
        added = cand_core - owned_core
        removed = owned_core - cand_core
        if added or not removed or not removed <= PRERELEASE_TOKENS:
            return CONFIDENCE_POSSIBLE, REASON_SAME_VERSION_NUMBER

    # 6b. The owned version is named only by a number ("1.0") and the
    #     candidate brings new words without any number ("More Realism"):
    #     probably another style, not the next version. A Roman numeral
    #     ("XIV") still counts as a number.
    if (
        sig.version is None
        and cand_core - owned_core
        and not owned_core
        and newest_owned.signature.version is not None
        and not any(_ROMAN_NUMERAL.match(token) for token in sig.core)
    ):
        return CONFIDENCE_POSSIBLE, REASON_NEW_LABEL

    # 7. Variant words the owned file does not have.
    if sig.variant_tokens - owned_tokens:
        return CONFIDENCE_POSSIBLE, REASON_VARIANT_TOKENS

    # 8. Without dates only the id says "newer".
    if not newer_by_date:
        return CONFIDENCE_POSSIBLE, REASON_UNKNOWN_RELEASE_DATE

    return CONFIDENCE_LIKELY, REASON_NEXT_VERSION


def _hidden_because(
    candidate: _Version,
    *,
    model_ignored: bool,
    downloaded: Set[int],
    hide_early_access: bool,
    hide_paid: bool,
    now: Optional[datetime],
) -> tuple[List[str], bool, bool]:
    record = candidate.record
    hidden: List[str] = []
    if model_ignored or (record is not None and getattr(record, "should_ignore", False)):
        hidden.append(HIDDEN_IGNORED)
    usage = getattr(record, "usage_control", None) if record is not None else None
    if usage is not None and usage != "Download":
        hidden.append(HIDDEN_NOT_DOWNLOADABLE)
    file_count = getattr(record, "file_count", None) if record is not None else None
    if file_count is not None and file_count <= 0:
        hidden.append(HIDDEN_NO_FILES)
    early_access = _is_early_access_active(record, now)
    paid = bool(getattr(record, "is_paid", False)) if record is not None else False
    if early_access and hide_early_access:
        hidden.append(HIDDEN_EARLY_ACCESS)
    if paid and hide_paid:
        hidden.append(HIDDEN_PAID)
    if candidate.version_id in downloaded:
        hidden.append(HIDDEN_ALREADY_DOWNLOADED)
    return hidden, early_access, paid


# --------------------------------------------------------------------------
# Payload
# --------------------------------------------------------------------------


def _local_version_fields(item: Mapping[str, Any]) -> tuple[Optional[str], Optional[str]]:
    civitai = item.get("civitai") if isinstance(item.get("civitai"), Mapping) else {}
    released = civitai.get("publishedAt") or civitai.get("createdAt")
    name = civitai.get("name")
    return (
        released if isinstance(released, str) else None,
        name if isinstance(name, str) else None,
    )


def _model_name(item: Mapping[str, Any]) -> Optional[str]:
    civitai = item.get("civitai") if isinstance(item.get("civitai"), Mapping) else {}
    model = civitai.get("model") if isinstance(civitai.get("model"), Mapping) else {}
    for value in (model.get("name"), item.get("model_name"), item.get("file_name")):
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _timestamp_to_iso(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    try:
        return (
            datetime.fromtimestamp(float(value), tz=timezone.utc)
            .isoformat()
            .replace("+00:00", "Z")
        )
    except (TypeError, ValueError, OverflowError, OSError):
        return None


class _TextExtractor(HTMLParser):
    """HTML -> plain text: block tags become line breaks, list items "- ".

    Script / style / template content is dropped; attributes are never read,
    so nothing of a link or image survives but its text.
    """

    _BLOCK = {"p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr", "blockquote", "pre", "hr"}
    _SKIP = {"script", "style", "template", "noscript", "iframe", "object"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: List[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:  # noqa: D401 - HTMLParser API
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_startendtag(self, tag: str, attrs) -> None:
        if tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def description_to_text(value: Any, limit: int = DESCRIPTION_MAX_CHARS) -> Optional[str]:
    """A version description (Civitai HTML) as plain text of at most ``limit``
    characters (plus an ellipsis), or None when nothing readable is left."""

    if not isinstance(value, str) or not value.strip():
        return None
    parser = _TextExtractor()
    try:
        parser.feed(value)
        parser.close()
    except Exception:  # pragma: no cover - HTMLParser is lenient
        return None
    text = _CONTROL_CHARS.sub("", "".join(parser.parts))
    lines = [re.sub(r"[ \t ]+", " ", line).strip() for line in text.split("\n")]
    out: List[str] = []
    for line in lines:
        if not line and (not out or not out[-1]):
            continue
        out.append(line)
    text = "\n".join(out).strip()
    if not text:
        return None
    if len(text) > limit:
        cut = text[:limit]
        space = max(cut.rfind(" "), cut.rfind("\n"))
        if space > limit * 0.6:
            cut = cut[:space]
        text = cut.rstrip() + "…"
    return text


def _files_summary(raw: Any) -> List[Dict[str, Any]]:
    """The stored weight-file list (JSON) as payload entries; [] when unknown."""

    if not isinstance(raw, str) or not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    files: List[Dict[str, Any]] = []
    for entry in data[:FILES_MAX_ENTRIES]:
        if not isinstance(entry, Mapping):
            continue

        def text(key: str) -> Optional[str]:
            value = entry.get(key)
            return value if isinstance(value, str) and value else None

        size = entry.get("sizeBytes")
        files.append(
            {
                "type": text("type"),
                "format": text("format"),
                "precision": text("precision"),
                "size": text("size"),
                "sizeBytes": size if isinstance(size, int) and not isinstance(size, bool) else None,
                "primary": entry.get("primary") is True,
            }
        )
    return files


def _serialize_candidate(
    candidate: _Version,
    *,
    confidence: str,
    reason: str,
    hidden: List[str],
    early_access: bool,
    paid: bool,
    downloaded: Set[int],
    model_ignored: bool,
) -> Dict[str, Any]:
    record = candidate.record
    files = _files_summary(getattr(record, "files_meta", None) if record is not None else None)
    main_file = next((entry for entry in files if entry["primary"]), files[0] if files else None)
    return {
        "versionId": candidate.version_id,
        "name": candidate.name,
        "baseModel": candidate.base_model,
        "releasedAt": candidate.released_at,
        "sizeBytes": candidate.size_bytes,
        "fileCount": getattr(record, "file_count", None) if record is not None else None,
        "usageControl": getattr(record, "usage_control", None) if record is not None else None,
        "isEarlyAccess": early_access,
        "earlyAccessEndsAt": getattr(record, "early_access_ends_at", None) if record is not None else None,
        "isPaid": paid,
        "previewUrl": getattr(record, "preview_url", None) if record is not None else None,
        "hasBeenDownloaded": candidate.version_id in downloaded,
        "isIgnored": model_ignored or bool(getattr(record, "should_ignore", False)),
        "confidence": confidence,
        "reason": reason,
        "hiddenBecause": hidden,
        # Changelog and file format: filled by refreshes after the columns
        # existed (null / [] until the next "Check now").
        "description": description_to_text(
            getattr(record, "description", None) if record is not None else None
        ),
        "fileFormat": main_file["format"] if main_file else None,
        "precision": main_file["precision"] if main_file else None,
        "files": files,
    }


def _candidate_rank(entry: Mapping[str, Any]) -> tuple:
    order = {CONFIDENCE_LIKELY: 0, CONFIDENCE_POSSIBLE: 1, CONFIDENCE_VARIANT: 2}
    return (1 if entry["hiddenBecause"] else 0, order.get(entry["confidence"], 3))


def _group_tier(candidates: Sequence[Mapping[str, Any]]) -> str:
    visible = [c for c in candidates if not c["hiddenBecause"]]
    if any(c["confidence"] == CONFIDENCE_LIKELY for c in visible):
        return TIER_LIKELY
    if any(c["confidence"] == CONFIDENCE_POSSIBLE for c in visible):
        return TIER_POSSIBLE
    return TIER_HIDDEN


def _sort_key_newest(entry: Mapping[str, Any]) -> tuple:
    parsed = _parse_date(entry.get("releasedAt"))
    stamp = parsed.timestamp() if parsed else float("-inf")
    return (stamp, entry["versionId"])


def _item_ids(item: Any) -> tuple[Optional[int], Optional[int]]:
    if not isinstance(item, Mapping):
        return None, None
    civitai = item.get("civitai")
    if not isinstance(civitai, Mapping):
        return None, None
    return _to_int(civitai.get("modelId")), _to_int(civitai.get("id"))


def collect_local_model_ids(local_items: Iterable[Any]) -> List[int]:
    """Sorted Civitai model ids of the scanner items that carry a version id."""

    ids: Set[int] = set()
    for item in local_items:
        model_id, version_id = _item_ids(item)
        if model_id is not None and version_id is not None:
            ids.add(model_id)
    return sorted(ids)


def build_updates_overview(
    *,
    model_type: str,
    local_items: Iterable[Mapping[str, Any]],
    records: Mapping[int, Any],
    downloaded_version_ids: Optional[Mapping[int, Iterable[int]]] = None,
    hide_early_access: bool = False,
    hide_paid: bool = False,
    preview_url_builder: Optional[Callable[[str], str]] = None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Build the updates overview payload (pure; see the module docstring)."""

    downloaded_map: Dict[int, Set[int]] = {
        int(model_id): {int(v) for v in ids}
        for model_id, ids in (downloaded_version_ids or {}).items()
    }

    # --- local items grouped by Civitai model id -------------------------
    items_by_model: Dict[int, List[Mapping[str, Any]]] = {}
    for item in local_items:
        model_id, version_id = _item_ids(item)
        if model_id is None or version_id is None:
            continue
        items_by_model.setdefault(model_id, []).append(item)

    groups: List[Dict[str, Any]] = []
    untracked = 0
    never_checked = 0
    checked_stamps: List[float] = []
    up_to_date_lines = 0

    for model_id in sorted(items_by_model):
        items = items_by_model[model_id]
        record = records.get(model_id)
        if record is None:
            untracked += 1
            continue
        last_checked = getattr(record, "last_checked_at", None)
        if last_checked is None:
            never_checked += 1
        else:
            checked_stamps.append(float(last_checked))
        model_ignored = bool(getattr(record, "should_ignore_model", False))
        downloaded = downloaded_map.get(model_id, set())

        remote: Dict[int, Any] = {}
        for version in getattr(record, "versions", None) or []:
            remote[int(version.version_id)] = version

        # Read-time ownership: the scanner decides, not the persisted flag.
        owned_ids: Set[int] = set()
        for item in items:
            owned_ids.add(int(_to_int(item["civitai"].get("id"))))

        # One _Version per owned version, preferring DB data, else local data.
        owned_versions: Dict[int, _Version] = {}
        line_of_version: Dict[int, Optional[str]] = {}
        cards_by_line: Dict[Optional[str], List[Dict[str, Any]]] = {}
        line_labels: Dict[Optional[str], str] = {}
        preview_level: Dict[Optional[str], int] = {}
        for item in items:
            version_id = int(_to_int(item["civitai"].get("id")))
            db_version = remote.get(version_id)
            local_released, local_name = _local_version_fields(item)
            local_base = item.get("base_model") if isinstance(item.get("base_model"), str) else None
            base_label = (local_base or "").strip() or (
                getattr(db_version, "base_model", None) if db_version is not None else None
            )
            line = _norm_base(base_label)
            line_of_version.setdefault(version_id, line)
            if line not in line_labels and base_label:
                line_labels[line] = base_label.strip()
            if version_id not in owned_versions:
                name = (getattr(db_version, "name", None) if db_version is not None else None) or local_name
                released = (
                    getattr(db_version, "released_at", None) if db_version is not None else None
                ) or local_released
                size = (
                    getattr(db_version, "size_bytes", None) if db_version is not None else None
                ) or _to_int(item.get("size"))
                owned_versions[version_id] = _Version(
                    version_id=version_id,
                    name=name,
                    base_model=base_label,
                    released_at=released,
                    size_bytes=size,
                    record=db_version,
                    signature=name_signature(name, base_label),
                )
            preview = item.get("preview_url") or ""
            preview_url = preview_url_builder(preview) if (preview_url_builder and preview) else (preview or None)
            level = _to_int(item.get("preview_nsfw_level")) or 0
            preview_level[line] = max(preview_level.get(line, 0), level)
            owned = owned_versions[version_id]
            cards_by_line.setdefault(line, []).append(
                {
                    "filePath": item.get("file_path"),
                    "fileName": item.get("file_name"),
                    "folder": item.get("folder") or "",
                    "baseModel": base_label,
                    "versionId": version_id,
                    "versionName": owned.name,
                    "releasedAt": owned.released_at,
                    "sizeBytes": _to_int(item.get("size")) or owned.size_bytes,
                    "previewUrl": preview_url,
                    "previewNsfwLevel": level,
                }
            )

        model_name = _model_name(items[0])
        local_lines = list(cards_by_line.keys())
        local_line_set = {line for line in local_lines if line is not None}

        # Newest owned per line, and over the whole model (for other-base).
        owned_by_line: Dict[Optional[str], List[_Version]] = {}
        for version_id, owned in owned_versions.items():
            owned_by_line.setdefault(line_of_version.get(version_id), []).append(owned)
        newest_by_line = {line: _newest(owned_by_line[line]) for line in owned_by_line}
        newest_overall = _newest(list(owned_versions.values()))
        line_for_other_base: Optional[str] = None
        if newest_overall is not None:
            line_for_other_base = line_of_version.get(newest_overall.version_id)

        remote_versions = [
            _Version(
                version_id=int(v.version_id),
                name=v.name,
                base_model=v.base_model,
                released_at=v.released_at,
                size_bytes=v.size_bytes,
                record=v,
                signature=name_signature(v.name, v.base_model),
            )
            for v in remote.values()
            if int(v.version_id) not in owned_ids
        ]

        for line in local_lines:
            newest_owned = newest_by_line.get(line)
            if newest_owned is None:
                continue
            owned_line = owned_by_line.get(line, [])
            line_known = line is not None

            same_base: List[tuple[_Version, bool]] = []
            other_base: List[_Version] = []
            for version in remote_versions:
                v_base = version.norm_base
                if line_known and v_base == line:
                    newer, by_date = _is_newer(version, newest_owned)
                    if newer:
                        same_base.append((version, by_date))
                elif not line_known:
                    if v_base is None or v_base not in local_line_set:
                        newer, by_date = _is_newer(version, newest_owned)
                        if newer:
                            same_base.append((version, by_date))
                elif (
                    line == line_for_other_base
                    and v_base not in local_line_set
                    and newest_overall is not None
                ):
                    newer, _by_date = _is_newer(version, newest_overall)
                    if newer:
                        other_base.append(version)

            siblings = [version for version, _ in same_base]
            candidates: List[Dict[str, Any]] = []
            for version, by_date in same_base:
                confidence, reason = _classify(
                    version,
                    owned_line=owned_line,
                    newest_owned=newest_owned,
                    siblings=siblings,
                    line_known=line_known,
                    newer_by_date=by_date,
                )
                hidden, early_access, paid = _hidden_because(
                    version,
                    model_ignored=model_ignored,
                    downloaded=downloaded,
                    hide_early_access=hide_early_access,
                    hide_paid=hide_paid,
                    now=now,
                )
                candidates.append(
                    _serialize_candidate(
                        version,
                        confidence=confidence,
                        reason=reason,
                        hidden=hidden,
                        early_access=early_access,
                        paid=paid,
                        downloaded=downloaded,
                        model_ignored=model_ignored,
                    )
                )
            for version in other_base:
                hidden, early_access, paid = _hidden_because(
                    version,
                    model_ignored=model_ignored,
                    downloaded=downloaded,
                    hide_early_access=hide_early_access,
                    hide_paid=hide_paid,
                    now=now,
                )
                candidates.append(
                    _serialize_candidate(
                        version,
                        confidence=CONFIDENCE_POSSIBLE,
                        reason=REASON_OTHER_BASE,
                        hidden=[HIDDEN_OTHER_BASE, *hidden],
                        early_access=early_access,
                        paid=paid,
                        downloaded=downloaded,
                        model_ignored=model_ignored,
                    )
                )

            if not candidates:
                up_to_date_lines += 1
                continue

            # Newest first inside each rank, best rank first.
            candidates.sort(key=_sort_key_newest, reverse=True)
            candidates.sort(key=_candidate_rank)
            tier = _group_tier(candidates)
            cards = sorted(
                cards_by_line[line], key=lambda card: (card.get("filePath") or "")
            )
            groups.append(
                {
                    "key": f"{model_id}:{line or ''}",
                    "modelId": model_id,
                    "modelName": model_name,
                    "baseModel": line_labels.get(line),
                    "tier": tier,
                    "isIgnored": model_ignored,
                    "lastCheckedAt": _timestamp_to_iso(last_checked),
                    "ownedVersionIds": sorted(
                        v.version_id for v in owned_line
                    ),
                    "newestOwned": {
                        "versionId": newest_owned.version_id,
                        "name": newest_owned.name,
                        "releasedAt": newest_owned.released_at,
                        "sizeBytes": newest_owned.size_bytes,
                    },
                    "previewNsfwLevel": preview_level.get(line, 0),
                    "localCards": cards,
                    "candidates": candidates,
                }
            )

    totals = {TIER_LIKELY: 0, TIER_POSSIBLE: 0, TIER_HIDDEN: 0}
    for group in groups:
        totals[group["tier"]] += 1
    # Likely first, then possible, then hidden; newest candidate first inside.
    tier_order = {TIER_LIKELY: 0, TIER_POSSIBLE: 1, TIER_HIDDEN: 2}
    groups.sort(
        key=lambda g: (
            tier_order[g["tier"]],
            -(_sort_key_newest(g["candidates"][0])[0] if g["candidates"] else 0),
            (g.get("modelName") or "").lower(),
        )
    )

    local_models = len(items_by_model)
    tracked = local_models - untracked
    return {
        "success": True,
        "modelType": model_type,
        "settings": {
            "hideEarlyAccessUpdates": bool(hide_early_access),
            "hidePaidUpdates": bool(hide_paid),
        },
        "totals": {
            "likely": totals[TIER_LIKELY],
            "possible": totals[TIER_POSSIBLE],
            "hidden": totals[TIER_HIDDEN],
            "groups": len(groups),
            "upToDate": up_to_date_lines,
        },
        "models": {
            "local": local_models,
            "tracked": tracked,
            "checked": len(checked_stamps),
            "untracked": untracked,
            "neverChecked": never_checked,
        },
        "unchecked": untracked + never_checked,
        "oldestCheckedAt": _timestamp_to_iso(min(checked_stamps)) if checked_stamps else None,
        "newestCheckedAt": _timestamp_to_iso(max(checked_stamps)) if checked_stamps else None,
        "groups": groups,
    }
