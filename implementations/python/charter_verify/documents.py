"""The manifest, the log, and the field rules for both. SPEC sections 5 and 7.

A manifest is one canonical JSON object with six fields; a log is one object
per LF-terminated line with seven. This module holds the rules about *values*:
which fields must be present, what type each has, how a timestamp is read, what
a digest looks like, how a key id is spelled. It holds no opinions about the
byte-level rules (that is `canonical`) and none about keys (that is `ed25519`).

Two splits are worth naming, because they are the ones a port can get wrong:

* **FIELDS versus EXTRA_FIELDS.** A field this version defines that is missing is
  MISSING: SPEC section 10 defines MISSING as "a required thing is absent", and a
  field nobody wrote is not a field whose spelling is wrong. A field that is
  there and wrongly typed is MALFORMED. A field this version does not define is
  UNKNOWN_FIELD. They are different complaints and the kit keeps them apart:
  `manifest-extra-field` is signed correctly and refused anyway.
* **PARSE versus CANONICAL.** `provenance.jsonl` is split on the byte 0x0A
  before any line is decoded. A verifier that read it through a text decoder
  would have already lost its ability to notice a CRLF, a missing final
  newline, or a byte order mark — and those are exactly the differences that
  change what the next entry's parent covers.
"""

from __future__ import annotations

import re
from typing import Any

from . import limits
from .errors import Refusal
from .vocabulary import LIMIT_EXCEEDED, MALFORMED, MISSING

FORMAT = "charter/0.1"
ALGORITHM = "ed25519"

MANIFEST_FIELDS = ("format", "title", "created_at", "content", "author", "signature")
# The fields L0.MANIFEST.FIELDS requires. `format` is not one of them: it has a
# check of its own, and SPEC section 5 says that check runs "before anything
# else", which it cannot do if FIELDS also owns it. A missing `format` is
# L0.FORMAT.IDENTIFIER's MISSING, not FIELDS' MALFORMED.
MANIFEST_REQUIRED = ("title", "created_at", "content", "author", "signature")
CONTENT_FIELDS = ("sha256",)
AUTHOR_FIELDS = ("name", "algorithm", "key_id", "public_key")
ENTRY_FIELDS = (
    "timestamp",
    "action",
    "summary",
    "author",
    "parent",
    "content_sha256",
    "signature",
)
ENTRY_AUTHOR_FIELDS = ("name", "key_id")
ACTIONS = ("create", "edit")

_TIMESTAMP = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")


class Manifest:
    """The six fields of a manifest, read and typed.

    The key, the signature and the content digest are kept as the *text* the
    file holds rather than decoded here. Decoding is the job of the check that
    consumes the value, because that is where the reason code belongs: a
    signature written with `=` padding is not a wrongly typed field, it is a
    signature that decodes to the same 64 bytes in a second spelling, and
    NON_CANONICAL_ENCODING says so. The kit settles the same question for the
    length rule: `manifest-signature-truncated` expects exactly one failure, on
    L1.MANIFEST.SIGNATURE, which could not be true if FIELDS measured it.
    """

    def __init__(self, value: dict) -> None:
        self.value = value
        self.format = value.get("format")
        self.title = value["title"]
        self.created_at = value["created_at"]
        self.content_sha256 = value["content"]["sha256"]
        self.author_name = value["author"]["name"]
        self.algorithm = value["author"]["algorithm"]
        self.key_id = value["author"]["key_id"]
        self.public_key_text = value["author"]["public_key"]
        self.signature_text = value["signature"]


class LogEntry:
    """One line of `provenance.jsonl`, read and typed, with its own bytes."""

    def __init__(self, value: dict, line: bytes) -> None:
        self.value = value
        self.line = line
        self.timestamp = value["timestamp"]
        self.action = value["action"]
        self.summary = value["summary"]
        self.author_name = value["author"]["name"]
        self.key_id = value["author"]["key_id"]
        self.parent = value["parent"]
        self.content_sha256 = value["content_sha256"]
        self.signature_text = value["signature"]


def is_digest(text: Any) -> bool:
    """64 lowercase hexadecimal characters, and nothing else."""
    return isinstance(text, str) and _DIGEST.match(text) is not None


def check_timestamp(text: Any, what: str) -> str:
    """ISO 8601 UTC at second precision, validated by arithmetic.

    "A verifier that consulted the host's timezone rules could answer
    differently on two machines, and this format fixes UTC, so there is nothing
    for a timezone to resolve." February gets 29 days in a leap year, and
    nothing here reads a clock.
    """
    if not isinstance(text, str):
        raise Refusal(MALFORMED, f"{what} is not a string")
    match = _TIMESTAMP.match(text)
    if match is None:
        raise Refusal(
            MALFORMED,
            f"{what} is {text!r}, and this format writes YYYY-MM-DDTHH:MM:SSZ",
        )
    year, month, day, hour, minute, second = (int(part) for part in match.groups())
    if not 1 <= month <= 12:
        raise Refusal(MALFORMED, f"{what} names month {month}, and months run 1 to 12")
    if not 1 <= day <= _days_in(year, month):
        raise Refusal(
            MALFORMED,
            f"{what} names day {day} of month {month} in {year}, which has "
            f"{_days_in(year, month)} day(s)",
        )
    if hour > 23 or minute > 59 or second > 59:
        raise Refusal(
            MALFORMED,
            f"{what} is {text!r}, and hours, minutes and seconds are bounded at 23, "
            "59 and 59",
        )
    return text


def _days_in(year: int, month: int) -> int:
    if month == 2:
        return 29 if _leap(year) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def _leap(year: int) -> bool:
    return year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)


def read_manifest(value: dict) -> Manifest:
    """The fields of a manifest, present and typed. L0.MANIFEST.FIELDS.

    What this check does **not** do is judge the spelling of the values: an
    uppercase digest, a padded signature and a key of the wrong length all pass
    here, and the checks that read those values report what is wrong with them.
    SPEC section 5's table said otherwise and was amended; the recorded answer
    for `manifest-signature-truncated` had already contradicted it.

    What it does mean by "present" is that absence is its own answer: a field
    that is not in the object is MISSING, and only a field that is there and
    cannot be used is MALFORMED. Section 10 gives the two codes one meaning each,
    and a reader that reported a malformation for a string it never read would be
    describing a value nobody wrote.
    """
    for field in MANIFEST_REQUIRED:
        if field not in value:
            raise Refusal(MISSING, f"the manifest carries no {field!r} field")
    title = value["title"]
    if not isinstance(title, str) or title == "":
        raise Refusal(MALFORMED, "manifest.title is not a non-empty string")
    check_timestamp(value["created_at"], "manifest.created_at")

    content = value["content"]
    if not isinstance(content, dict):
        raise Refusal(MALFORMED, "manifest.content is not an object")
    if "sha256" not in content:
        raise Refusal(MISSING, "manifest.content carries no 'sha256' field")
    if not isinstance(content["sha256"], str):
        raise Refusal(MALFORMED, "manifest.content.sha256 is not a string")

    author = value["author"]
    if not isinstance(author, dict):
        raise Refusal(MALFORMED, "manifest.author is not an object")
    for field in AUTHOR_FIELDS:
        if field not in author:
            raise Refusal(MISSING, f"manifest.author carries no {field!r} field")
    name = author["name"]
    if not isinstance(name, str) or name == "":
        raise Refusal(MALFORMED, "manifest.author.name is not a non-empty string")
    if author["algorithm"] != ALGORITHM:
        raise Refusal(
            MALFORMED,
            f"manifest.author.algorithm is {author['algorithm']!r}, and this version "
            f"defines exactly one value, {ALGORITHM!r}",
        )
    if not isinstance(author["key_id"], str):
        raise Refusal(MALFORMED, "manifest.author.key_id is not a string")
    if not isinstance(author["public_key"], str):
        raise Refusal(MALFORMED, "manifest.author.public_key is not a string")

    if not isinstance(value["signature"], str):
        raise Refusal(MALFORMED, "manifest.signature is not a string")
    return Manifest(value)


def read_entry(value: dict, line: bytes) -> LogEntry:
    """The seven fields of one line, present and typed. L0.PROVENANCE.FIELDS.

    As in the manifest, the spelling of `content_sha256`, of `parent` and of the
    signature is the business of the check that consumes it, and a field that is
    not in the object is MISSING rather than MALFORMED: absence has its own reason
    code, and the check that reads the value reports the same one when it goes
    looking for a value that is not there (SPEC sections 5, 7 and 10).
    """
    for field in ENTRY_FIELDS:
        if field not in value:
            raise Refusal(MISSING, f"a provenance entry carries no {field!r} field")
    check_timestamp(value["timestamp"], "a provenance entry's timestamp")
    if value["action"] not in ACTIONS:
        raise Refusal(
            MALFORMED,
            f"a provenance entry's action is {value['action']!r}, and this version "
            "defines 'create' and 'edit'",
        )
    summary = value["summary"]
    if not isinstance(summary, str) or summary == "":
        raise Refusal(MALFORMED, "a provenance entry's summary is not a non-empty string")
    author = value["author"]
    if not isinstance(author, dict):
        raise Refusal(MALFORMED, "a provenance entry's author is not an object")
    for field in ENTRY_AUTHOR_FIELDS:
        if field not in author:
            raise Refusal(MISSING, f"a provenance entry's author carries no {field!r}")
    name = author["name"]
    if not isinstance(name, str) or name == "":
        raise Refusal(MALFORMED, "a provenance entry's author.name is not a non-empty string")
    if not isinstance(author["key_id"], str):
        raise Refusal(MALFORMED, "a provenance entry's author.key_id is not a string")
    parent = value["parent"]
    if parent is not None and not isinstance(parent, str):
        raise Refusal(MALFORMED, "a provenance entry's parent is neither null nor a string")
    if not isinstance(value["content_sha256"], str):
        raise Refusal(MALFORMED, "a provenance entry's content_sha256 is not a string")
    if not isinstance(value["signature"], str):
        raise Refusal(MALFORMED, "a provenance entry's signature is not a string")
    return LogEntry(value, line)


def unknown_fields(value: dict, defined: tuple, path: str = "") -> list[str]:
    """Every field this version has no rule for, at any depth.

    SPEC section 5 states the rule as "any field this document does not define",
    and the kit's `manifest-extra-field` and `entry-extra-field` cases are both
    top-level. The nested reading — `author`'s "exactly name, algorithm, key_id,
    public_key" and `content`'s "only field is sha256" — is a guess recorded in
    the README, and it gives the two checks non-overlapping jobs: FIELDS asks
    whether the fields it knows are present and well formed, EXTRA_FIELDS asks
    whether anything else is there.
    """
    problems: list[str] = []
    for field in value:
        if field not in defined:
            problems.append(f"{path}{field}" if path else field)
    return problems


def manifest_unknown_fields(value: dict) -> list[str]:
    """Every field a manifest carries that this version has no rule for."""
    problems = unknown_fields(value, MANIFEST_FIELDS)
    content = value.get("content")
    if isinstance(content, dict):
        problems += unknown_fields(content, CONTENT_FIELDS, "content.")
    author = value.get("author")
    if isinstance(author, dict):
        problems += unknown_fields(author, AUTHOR_FIELDS, "author.")
    return problems


def entry_unknown_fields(value: dict) -> list[str]:
    """Every field a provenance entry carries that this version has no rule for."""
    problems = unknown_fields(value, ENTRY_FIELDS)
    author = value.get("author")
    if isinstance(author, dict):
        problems += unknown_fields(author, ENTRY_AUTHOR_FIELDS, "author.")
    return problems


def split_log(data: bytes) -> list[bytes]:
    """`provenance.jsonl` as lines, each without the LF that closed it.

    The file is split on the byte 0x0A before any line is decoded, and three
    things about the result are PARSE's business rather than the reader's: the
    file ends with an LF, no line is empty, and every line is a JSON object.
    An empty file is none of those problems: it is a log that records nothing,
    which is a separate check with a separate name.
    """
    if data == b"":
        return []
    if not data.endswith(b"\n"):
        raise Refusal(
            MALFORMED,
            "the file does not end with an LF, so its last line is not a line this "
            "format terminated",
        )
    if data.count(b"\n") > limits.PROVENANCE_ENTRIES + 1:
        raise Refusal(
            LIMIT_EXCEEDED,
            f"the file holds more than {limits.PROVENANCE_ENTRIES} lines, which is "
            "the ceiling for one log",
        )
    lines = data.split(b"\n")[:-1]
    if len(lines) > limits.PROVENANCE_ENTRIES:
        raise Refusal(
            LIMIT_EXCEEDED,
            f"the log holds {len(lines)} entries, and the ceiling is "
            f"{limits.PROVENANCE_ENTRIES}",
        )
    for number, line in enumerate(lines, start=1):
        if line == b"":
            raise Refusal(MALFORMED, f"line {number} of the log is empty")
        if len(line) > limits.PROVENANCE_LINE_BYTES:
            raise Refusal(
                LIMIT_EXCEEDED,
                f"line {number} of the log is {len(line)} bytes, and the ceiling for "
                f"one line is {limits.PROVENANCE_LINE_BYTES}",
            )
    return lines
