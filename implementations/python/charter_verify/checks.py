"""The thirty checks, in the order SPEC section 10 fixes, and what each needs.

Three ideas hold this module together, and they are the three the kit is
actually testing.

**A check is a question, and a fact is a question shared by several checks.**
`ctx.manifest_fields()` is asked for by nine checks; it is computed once, and
its failure is *reported once*, by the check that owns it. Every other check
that needed it is SKIP, because the fact it needed is the fact that is missing.
The kit compares the number of checks that were never reached, so this is not a
presentation detail: it is the difference between 12 skips and 11.

**A check that could not run is SKIP, never PASS.** Every fact either answers or
raises `Blocked` naming the check that owns the failure, and the runner turns
that into the owner's FAIL and everyone else's SKIP.

**Prerequisites are stated per check, not inferred from the order.** FORMAT
appears third-from-last in the L0 group and is refused together with everything
after it; MANIFEST.PARSE is asked for by FORMAT and reports the failure itself.
The dependency graph below is the part of this specification that the spec
describes only as "something it depends on failed" — see the README.
"""

from __future__ import annotations

import hashlib
import zlib

from . import base64url, canonical, container, documents, ed25519, limits
from .container import Container, Entry
from .documents import LogEntry, Manifest
from .errors import Blocked, Blocker, Refusal
from .vocabulary import (
    DECODE_ERROR,
    EXTRA,
    FAIL,
    MALFORMED,
    MISMATCH,
    MISSING,
    DUPLICATE,
    NON_CANONICAL,
    NON_CANONICAL_ENCODING,
    OK,
    PASS,
    SKIP,
    UNKNOWN_FIELD,
    UNSUPPORTED,
    UNSUPPORTED_FEATURE,
    UNSUPPORTED_VERSION,
    VERSION_GATE,
)

CONTENT = "content.md"
MANIFEST = "manifest.json"
PROVENANCE = "provenance.jsonl"

READABLE = "L0.ZIP.READABLE"
VERSION = "L0.ZIP.VERSION"
FLAGS = "L0.ZIP.FLAGS"
LAYOUT = "L0.ZIP.LAYOUT"
METADATA = "L0.ZIP.METADATA"
ENTRY_SET = "L0.ZIP.ENTRY_SET"
ENTRY_DATA = "L0.ZIP.ENTRY_DATA"
SIZES = "L0.ZIP.SIZES"
CRC32 = "L0.ZIP.CRC32"
FORMAT_IDENTIFIER = VERSION_GATE
MANIFEST_PARSE = "L0.MANIFEST.PARSE"
MANIFEST_CANONICAL = "L0.MANIFEST.CANONICAL"
MANIFEST_FIELDS = "L0.MANIFEST.FIELDS"
MANIFEST_EXTRA_FIELDS = "L0.MANIFEST.EXTRA_FIELDS"
CONTENT_UTF8 = "L0.CONTENT.UTF8"
CONTENT_HASH = "L0.CONTENT.HASH"
PROVENANCE_PARSE = "L0.PROVENANCE.PARSE"
PROVENANCE_CANONICAL = "L0.PROVENANCE.CANONICAL"
PROVENANCE_FIELDS = "L0.PROVENANCE.FIELDS"
PROVENANCE_EXTRA_FIELDS = "L0.PROVENANCE.EXTRA_FIELDS"
PROVENANCE_NONEMPTY = "L0.PROVENANCE.NONEMPTY"
PROVENANCE_CONTENT_HASH_FORMAT = "L0.PROVENANCE.CONTENT_HASH_FORMAT"
MANIFEST_KEY_ID = "L1.MANIFEST.KEY_ID"
MANIFEST_SIGNATURE = "L1.MANIFEST.SIGNATURE"
FIRST_AUTHOR = "L1.PROVENANCE.FIRST_AUTHOR"
KEYS = "L1.PROVENANCE.KEYS"
SIGNATURES = "L1.PROVENANCE.SIGNATURES"
FIRST_PARENT_NULL = "L2.CHAIN.FIRST_PARENT_NULL"
LINKS = "L2.CHAIN.LINKS"
HEAD_MATCHES_CONTENT = "L2.CHAIN.HEAD_MATCHES_CONTENT"


class Outcome:
    """What one check has to say: a status, a reason code, and prose."""

    def __init__(self, status: str, reason: str, detail: str) -> None:
        self.status = status
        self.reason = reason
        self.detail = detail


def passed(detail: str) -> Outcome:
    return Outcome(PASS, OK, detail)


def failed(reason: str, detail: str) -> Outcome:
    return Outcome(FAIL, reason, detail)


def unsupported(reason: str, detail: str) -> Outcome:
    return Outcome(UNSUPPORTED, reason, detail)


class Context:
    """The artifact, and every fact the checks ask of it, computed once."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.size = len(data)
        self._answers: dict = {}
        self._blocked: dict = {}

    def _ask(self, key, produce):
        if key in self._answers:
            return self._answers[key]
        if key in self._blocked:
            raise self._blocked[key]
        try:
            answer = produce()
        except Blocked as blocked:
            self._blocked[key] = blocked
            raise
        self._answers[key] = answer
        return answer

    # --- the container ---------------------------------------------------

    def container(self) -> Container:
        """The walked archive. L0.ZIP.READABLE."""

        def produce() -> Container:
            try:
                return container.walk(self.data)
            except Refusal as refusal:
                # The walk refuses in three voices. The bytes are not a container
                # this verifier can read (MALFORMED), they are a container whose
                # size exceeds a declared ceiling (LIMIT_EXCEEDED, a FAIL by
                # section 3.7), or they are a container that uses something this
                # verifier does not implement (an archive that says it is disk 1 of
                # a set, or that its real counts are in a ZIP64 record). The third
                # is UNSUPPORTED and not a failure: the artifact is not broken, it
                # is one whose bytes this reader will not guess at.
                status = (
                    UNSUPPORTED
                    if refusal.reason in (UNSUPPORTED_VERSION, UNSUPPORTED_FEATURE)
                    else FAIL
                )
                raise Blocked(
                    Blocker(READABLE, status, refusal.reason, refusal.detail)
                ) from None

        return self._ask("container", produce)

    def entry(self, name: str) -> Entry:
        """The entry a name identifies, or a blocker owned by ENTRY_SET."""

        def produce() -> Entry:
            found = self.container().first(name)
            if found is None:
                raise Blocked(
                    Blocker(
                        ENTRY_SET,
                        FAIL,
                        MISSING,
                        f"{name} is not one of the entries the archive holds",
                    )
                )
            return found

        return self._ask(("entry", name), produce)

    def decoded(self, entry: Entry) -> bytes:
        """The bytes an entry holds, expanded. L0.ZIP.ENTRY_DATA."""

        def produce() -> bytes:
            try:
                return container.decompress(entry)
            except Refusal as refusal:
                status = (
                    UNSUPPORTED if refusal.reason == UNSUPPORTED_FEATURE else FAIL
                )
                raise Blocked(
                    Blocker(ENTRY_DATA, status, refusal.reason, refusal.detail)
                ) from None

        return self._ask(("decoded", entry.header_offset, entry.name_text), produce)

    def entry_bytes(self, name: str) -> bytes:
        """The bytes of the entry a name identifies."""
        return self.decoded(self.entry(name))

    # --- the manifest ----------------------------------------------------

    def manifest_bytes(self) -> bytes:
        return self.entry_bytes(MANIFEST)

    def manifest_value(self) -> dict:
        """The manifest, parsed. L0.MANIFEST.PARSE."""

        def produce() -> dict:
            data = self.manifest_bytes()
            try:
                value = canonical.parse_document(data)
            except Refusal as refusal:
                raise Blocked(
                    Blocker(MANIFEST_PARSE, FAIL, refusal.reason, refusal.detail)
                ) from None
            if not isinstance(value, dict):
                raise Blocked(
                    Blocker(
                        MANIFEST_PARSE,
                        FAIL,
                        MALFORMED,
                        "manifest.json parses to a value that is not a JSON object",
                    )
                )
            return value

        return self._ask("manifest_value", produce)

    def version_gate(self) -> None:
        """The format version gate, and the field it reads. SPEC section 5.

        "format is checked before anything else, and a value this verifier does
        not implement produces UNSUPPORTED and stops the manifest checks.
        Applying the rules of charter/0.1 to a file that declares charter/0.2
        would be inventing a verdict."

        Three ways this gate stops the document layer, and the reference states
        all three: a `format` that is absent is MISSING, one that is not a string
        is MALFORMED, and one this verifier does not implement is
        UNSUPPORTED_VERSION. FIELDS is skipped in every case rather than
        reporting a second complaint about the same field, which is why
        L0.MANIFEST.FIELDS does not own `format` — the check that runs "before
        anything else" has to be the one that says so.

        A manifest that could not be *read* is not this gate's business. The gate
        only fires on a version it has in hand and does not implement; a parse
        failure is MANIFEST.PARSE's to report, and it must not swallow the checks
        that never needed the manifest in the first place — which is why
        `manifest-too-large` passes CONTENT.UTF8 while FORMAT and eleven others
        are skipped.
        """

        def produce() -> None:
            try:
                value = self.manifest_value()
            except Blocked:
                return
            if "format" not in value:
                raise Blocked(
                    Blocker(
                        FORMAT_IDENTIFIER,
                        FAIL,
                        MISSING,
                        "the manifest carries no 'format' field",
                    )
                )
            field = value["format"]
            if not isinstance(field, str):
                raise Blocked(
                    Blocker(
                        FORMAT_IDENTIFIER,
                        FAIL,
                        MALFORMED,
                        f"manifest.format is {type(field).__name__}, and it is a string",
                    )
                )
            if field != documents.FORMAT:
                raise Blocked(
                    Blocker(
                        FORMAT_IDENTIFIER,
                        UNSUPPORTED,
                        UNSUPPORTED_VERSION,
                        f"manifest.format is {field!r}, and this verifier implements "
                        f"only {documents.FORMAT!r}",
                    )
                )

        self._ask("version_gate", produce)

    def manifest_fields(self) -> Manifest:
        """The six fields, typed. L0.MANIFEST.FIELDS."""

        def produce() -> Manifest:
            self.version_gate()
            value = self.manifest_value()
            try:
                return documents.read_manifest(value)
            except Refusal as refusal:
                raise Blocked(
                    Blocker(MANIFEST_FIELDS, FAIL, refusal.reason, refusal.detail)
                ) from None

        return self._ask("manifest_fields", produce)

    def manifest_key(self) -> bytes:
        """The author's public key, decoded and measured. L1.MANIFEST.KEY_ID.

        The *spelling* and the *length* of the key are this check's business
        rather than FIELDS': a key that decodes to 31 bytes, or one whose last
        character carries a non-zero trailing bit pattern, is a key the reader
        cannot use, and the checks that would use it say so by being skipped.
        Every check that needs the key comes through here, which is why the
        reference skips FIRST_AUTHOR, KEYS and SIGNATURES when the key does not
        decode — and why it does *not* skip them when the key decodes fine and
        merely does not derive the key id beside it.
        """

        def produce() -> bytes:
            manifest = self.manifest_fields()
            try:
                public_key = base64url.decode(manifest.public_key_text, "public_key")
            except Refusal as refusal:
                raise Blocked(
                    Blocker(MANIFEST_KEY_ID, FAIL, refusal.reason, refusal.detail)
                ) from None
            if len(public_key) != 32:
                raise Blocked(
                    Blocker(
                        MANIFEST_KEY_ID,
                        FAIL,
                        MALFORMED,
                        f"manifest.author.public_key decodes to {len(public_key)} "
                        "byte(s), and an Ed25519 public key is 32",
                    )
                )
            return public_key

        return self._ask("manifest_key", produce)

    # --- the content -----------------------------------------------------

    def content_bytes(self) -> bytes:
        """The bytes of `content.md`, exactly as the file holds them."""

        def produce() -> bytes:
            self.version_gate()
            return self.entry_bytes(CONTENT)

        return self._ask("content_bytes", produce)

    # --- the log ---------------------------------------------------------

    def log_lines(self) -> list:
        """`provenance.jsonl` as lines, each with the LF that closed it."""

        def produce() -> list:
            self.version_gate()
            data = self.entry_bytes(PROVENANCE)
            try:
                return documents.split_log(data)
            except Refusal as refusal:
                raise Blocked(
                    Blocker(PROVENANCE_PARSE, FAIL, refusal.reason, refusal.detail)
                ) from None

        return self._ask("log_lines", produce)

    def log_values(self) -> list:
        """Every line as (bytes, value). L0.PROVENANCE.PARSE."""

        def produce() -> list:
            out = []
            for number, line in enumerate(self.log_lines(), start=1):
                try:
                    value = canonical.parse_document(
                        line, ceiling=limits.PROVENANCE_LINE_BYTES
                    )
                except Refusal as refusal:
                    raise Blocked(
                        Blocker(
                            PROVENANCE_PARSE,
                            FAIL,
                            refusal.reason,
                            f"line {number}: {refusal.detail}",
                        )
                    ) from None
                if not isinstance(value, dict):
                    raise Blocked(
                        Blocker(
                            PROVENANCE_PARSE,
                            FAIL,
                            MALFORMED,
                            f"line {number} of the log is not a JSON object",
                        )
                    )
                out.append((line, value))
            return out

        return self._ask("log_values", produce)

    def log_entries(self) -> list:
        """Every entry, typed. L0.PROVENANCE.FIELDS."""

        def produce() -> list:
            out = []
            for line, value in self.log_values():
                try:
                    out.append(documents.read_entry(value, line))
                except Refusal as refusal:
                    raise Blocked(
                        Blocker(
                            PROVENANCE_FIELDS, FAIL, refusal.reason, refusal.detail
                        )
                    ) from None
            return out

        return self._ask("log_entries", produce)

    def log_first(self) -> LogEntry:
        """The first entry, or a blocker owned by L0.PROVENANCE.NONEMPTY."""

        def produce() -> LogEntry:
            entries = self.log_entries()
            if not entries:
                raise Blocked(
                    Blocker(
                        PROVENANCE_NONEMPTY,
                        FAIL,
                        MISSING,
                        "provenance.jsonl holds no first entry to compare with the "
                        "manifest",
                    )
                )
            return entries[0]

        return self._ask("log_first", produce)

    def log_head(self) -> LogEntry:
        """The last entry, or a blocker owned by L0.PROVENANCE.NONEMPTY."""

        def produce() -> LogEntry:
            entries = self.log_entries()
            if not entries:
                raise Blocked(
                    Blocker(
                        PROVENANCE_NONEMPTY,
                        FAIL,
                        MISSING,
                        "provenance.jsonl holds no entry, so there is no head to "
                        "compare with the manifest",
                    )
                )
            return entries[-1]

        return self._ask("log_head", produce)

    # --- the artifact summary, for the JSON form -------------------------

    def summary(self):
        """What the file claims, or None when it cannot be read that far.

        The reference prints a summary object for every artifact whose manifest
        can be read, parsed, and holds well-formed fields — and prints `null`
        for one whose manifest is missing, unreadable, too large, unreadable as
        fields, or of a version this verifier does not implement. That rule is
        observable in the reference CLI and is nowhere in the spec; the README
        records it as one of the things the CLI's shape states and the prose
        does not.
        """
        try:
            manifest = self.manifest_fields()
        except Blocked:
            return None
        entries = 0
        try:
            entries = len(self.log_values())
        except Blocked:
            entries = 0
        return {
            "format": manifest.format,
            "title": manifest.title,
            "created_at": manifest.created_at,
            "author_name": manifest.author_name,
            "author_key_id": manifest.key_id,
            "entries": entries,
            "head_content_sha256": manifest.content_sha256,
        }


# --- the checks themselves -----------------------------------------------


def check_readable(ctx: Context) -> Outcome:
    walk = ctx.container()
    return passed(
        f"the central directory lists {len(walk.entries)} entr(ies) and its end "
        f"record sits at offset {walk.eocd_offset}"
    )


def check_version(ctx: Context) -> Outcome:
    """No ZIP64, no multi-disk. SPEC 3.2.

    The end record's own disk and ZIP64 facts are the legibility gate's: an
    archive that says it is one disk of a set, or that its real counts are in a
    ZIP64 record, does not describe bytes this reader can walk, so `READABLE`
    reports it and this check is SKIP (section 10.1). What is left here is what an
    *entry* declares it needs, read from the copy of that claim in the central
    directory: it is the copy section 3.5 makes authoritative for every claim the
    file states twice, and the local header's copy is left to `L0.ZIP.METADATA`,
    which is the check that reports the copies disagreeing. Reading both copies
    here would report a feature level the entry may not need — and would answer a
    question the defect has not established, since two copies that disagree do not
    say what the entry needs. A feature level above 20 is a version this verifier
    does not implement, which is UNSUPPORTED_VERSION rather than
    UNSUPPORTED_FEATURE. A bare 0xFFFFFFFF in a size field is not ZIP64 (the ZIP64
    marker is the version, or the extra field beside it): it is a number above the
    ceiling in section 3.7, and the check that would read the bytes reports
    LIMIT_EXCEEDED.
    """
    walk = ctx.container()
    highest = 0
    for entry in walk.entries:
        needed = entry.version_needed
        highest = max(highest, needed)
        if needed > 20:
            return unsupported(
                UNSUPPORTED_VERSION,
                f"{entry.name_text} needs ZIP feature level {needed // 10}.{needed % 10}, "
                "and this verifier implements 2.0",
            )
    return passed(f"the highest ZIP feature level any entry needs is {highest // 10}")


def check_flags(ctx: Context) -> Outcome:
    walk = ctx.container()
    for entry in walk.entries:
        for word in (entry.flags, entry.local_flags):
            if word & container.UNSUPPORTED_FLAGS:
                return unsupported(
                    UNSUPPORTED_FEATURE,
                    f"{entry.name_text} sets general purpose bit(s) "
                    f"0x{word & container.UNSUPPORTED_FLAGS:04x}, which describe a "
                    "feature this verifier does not implement",
                )
    for entry in walk.entries:
        for word in (entry.flags, entry.local_flags):
            if word & ~container.ALLOWED_FLAGS:
                return failed(
                    EXTRA,
                    f"{entry.name_text} sets general purpose bit(s) "
                    f"0x{word & ~container.ALLOWED_FLAGS:04x}, and charter/0.1 defines "
                    "exactly three",
                )
    return passed(
        f"all {len(walk.entries)} entries set only the bits charter/0.1 allows"
    )


def check_layout(ctx: Context) -> Outcome:
    """Every byte accounted for, in the order SPEC 3.4 fixes.

    The entries are walked in *file* order, which is not necessarily the order the
    central directory lists them in: ZIP fixes no order for the directory, so the
    rule is about the byte ranges and not about the table. An overlap (a range
    that begins before the one before it ends) is two claims about one range of
    bytes, which is MISMATCH; a gap (a range that begins later) is bytes where the
    format does not put them, which is EXTRA. The three facts of the end record
    are then compared against the ranges: the size the directory declares against
    the size its records use, the offset it declares against where the ranges end,
    and its own position against where the directory ends — a byte none of those
    looks at is a byte a forged file can change for free.
    """
    walk = ctx.container()
    expected = 0
    for name, start, end in walk.entry_spans:
        if start < expected:
            return failed(
                MISMATCH,
                f"{name} begins at offset {start}, inside the range another part of the "
                f"file already claims (which ends at {expected})",
            )
        if start > expected:
            return failed(
                EXTRA,
                f"{start - expected} byte(s) sit between the end of the previous entry "
                f"({expected}) and the start of {name} ({start}), and the format accounts "
                "for every byte",
            )
        expected = end
    if walk.cd_consumed != walk.cd_size:
        return failed(
            MISMATCH,
            f"the end record declares a {walk.cd_size}-byte central directory and its "
            f"records use {walk.cd_consumed}",
        )
    if walk.cd_offset > expected:
        return failed(
            EXTRA,
            f"the central directory starts at offset {walk.cd_offset}, and the bytes "
            f"before it are accounted for up to {expected}",
        )
    if walk.cd_offset < expected:
        return failed(
            MISMATCH,
            f"the entries' ranges end at offset {expected} and the central directory "
            f"declares that it starts at {walk.cd_offset}, so the last "
            f"{expected - walk.cd_offset} byte(s) of an entry's data and the directory "
            "are two claims about the same bytes",
        )
    expected = walk.cd_offset + walk.cd_size
    if walk.eocd_offset != expected:
        return failed(
            EXTRA,
            f"the end record sits at offset {walk.eocd_offset} and the central directory "
            f"ends at {expected}",
        )
    expected = walk.eocd_offset + container.EOCD_BYTES
    if walk.eocd_comment_len:
        return failed(
            EXTRA,
            f"the end record carries a {walk.eocd_comment_len}-byte archive comment, "
            "and charter/0.1 has no archive comment",
        )
    if expected != walk.size:
        return failed(
            EXTRA,
            f"the file is {walk.size} bytes and the format accounts for {expected}, so "
            f"{walk.size - expected} byte(s) appear where the format does not put them",
        )
    return passed(f"every one of the {walk.size} bytes is accounted for")


def check_metadata(ctx: Context) -> Outcome:
    walk = ctx.container()
    for entry in walk.entries:
        if entry.version_made_by != container.FIXED_VERSION_MADE_BY:
            return failed(
                MISMATCH,
                f"{entry.name_text} was made by version 0x{entry.version_made_by:04x}, "
                "and charter/0.1 fixes that field at 0x0014",
            )
        if entry.disk != 0:
            return failed(
                MISMATCH,
                f"{entry.name_text} declares disk {entry.disk}, and charter/0.1 fixes "
                "that field at 0",
            )
        if entry.internal_attrs != 0 or entry.external_attrs != 0:
            return failed(
                MISMATCH,
                f"{entry.name_text} declares file attributes, and charter/0.1 fixes "
                "both attribute fields at 0",
            )
        for copy, where in (
            (entry.central, "central directory"),
            (entry.local, "local header"),
        ):
            if (
                copy["dos_date"] != container.FIXED_DOS_DATE
                or copy["dos_time"] != container.FIXED_DOS_TIME
            ):
                return failed(
                    MISMATCH,
                    f"{entry.name_text} carries a clock reading in its {where}, and a "
                    "file whose bytes are the record cannot also carry one",
                )
        for field, label in (
            ("version_needed", "version needed"),
            ("method", "compression method"),
            ("crc32", "CRC-32"),
            ("compressed_size", "compressed size"),
            ("size", "uncompressed size"),
            ("dos_date", "DOS date"),
            ("dos_time", "DOS time"),
        ):
            if entry.central[field] != entry.local[field]:
                return failed(
                    MISMATCH,
                    f"{entry.name_text} states its {label} twice and the two copies "
                    f"disagree ({entry.central[field]} and {entry.local[field]})",
                )
    return passed(
        f"all {len(walk.entries)} entries declare the version, method, CRC-32, sizes, "
        "and DOS stamp the format fixes, twice over"
    )


def check_entry_set(ctx: Context) -> Outcome:
    walk = ctx.container()
    counts: dict = {}
    for entry in walk.entries:
        counts[entry.name_text] = counts.get(entry.name_text, 0) + 1
    for required in container.REQUIRED_NAMES:
        if counts.get(required, 0) == 0:
            return failed(
                MISSING,
                f"the archive holds no {required}, and a charter holds exactly the "
                "three entries the format names",
            )
    for name, count in counts.items():
        if count > 1:
            return failed(
                DUPLICATE,
                f"{count} entries are named {name}, and a name identifies one entry — a "
                "reader that took the other copy would be reading a different document",
            )
    extras = [name for name in counts if name not in container.REQUIRED_NAMES]
    if extras:
        return failed(
            EXTRA,
            f"the archive holds {', '.join(sorted(extras))}, and charter/0.1 defines "
            "exactly three entries",
        )
    return passed(
        f"exactly the {len(container.REQUIRED_NAMES)} required entries are present: "
        + ", ".join(container.REQUIRED_NAMES)
    )


def check_entry_data(ctx: Context) -> Outcome:
    walk = ctx.container()
    for entry in walk.entries:
        ctx.decoded(entry)
    return passed(
        f"all {len(walk.entries)} entries decode from the stored or deflated bytes "
        "their headers declare"
    )


def check_sizes(ctx: Context) -> Outcome:
    """The declared uncompressed size, and the bytes.

    Only the directory's copy is read here. When the two copies of the size
    disagree, the requirement that is broken is "both copies of a claim agree",
    which is `L0.ZIP.METADATA`'s — reading the local copy here too would report
    one defect twice and take the complaint away from the check that owns it.

    An entry whose bytes cannot be read has no size to compare, and that is a
    fact about *that entry* rather than about this check. The entries that can be
    read are still measured, because a check that measured something and found a
    defect reports the defect: hiding it behind the one entry it could not read
    would be a verdict that reads worse than the file. A check whose requirement
    is about every entry is SKIP only when every answer it gave was "not
    measurable", which is SPEC section 10.1's rule about a fact that names one
    entry.
    """
    walk = ctx.container()
    unreadable = None
    for entry in walk.entries:
        try:
            data = ctx.decoded(entry)
        except Blocked as blocked:
            if unreadable is None:
                unreadable = blocked
            continue
        if len(data) != entry.size:
            return failed(
                MISMATCH,
                f"{entry.name_text} declares {entry.size} uncompressed byte(s) and "
                f"holds {len(data)}",
            )
    if unreadable is not None:
        raise unreadable
    return passed("every entry declares the uncompressed size it has")


def check_crc32(ctx: Context) -> Outcome:
    """The declared CRC-32, and the bytes, for the same reason and the same copy.

    An entry that cannot be read is skipped the way `check_sizes` skips it, and
    for the same reason: the checks that can be answered are answered.
    """
    walk = ctx.container()
    unreadable = None
    for entry in walk.entries:
        try:
            data = ctx.decoded(entry)
        except Blocked as blocked:
            if unreadable is None:
                unreadable = blocked
            continue
        actual = zlib.crc32(data) & 0xFFFFFFFF
        if actual != entry.crc32:
            return failed(
                MISMATCH,
                f"{entry.name_text} declares CRC-32 0x{entry.crc32:08x} and holds "
                f"0x{actual:08x}",
            )
    if unreadable is not None:
        raise unreadable
    return passed("every entry declares the CRC-32 of the bytes it holds")


def check_format(ctx: Context) -> Outcome:
    ctx.version_gate()
    value = ctx.manifest_value()
    return passed(f"manifest.format is {value['format']!r}")


def check_manifest_parse(ctx: Context) -> Outcome:
    value = ctx.manifest_value()
    return passed(
        f"manifest.json is one JSON object with {len(value)} field(s), and it is the "
        "only parse of these bytes this verifier accepts"
    )


def check_manifest_canonical(ctx: Context) -> Outcome:
    ctx.version_gate()
    value = ctx.manifest_value()
    data = ctx.manifest_bytes()
    try:
        expected = canonical.canonical_document(value)
    except Refusal as refusal:
        return failed(refusal.reason, refusal.detail)
    if data != expected:
        return failed(
            NON_CANONICAL,
            f"manifest.json is {len(data)} bytes, and the canonical form of the value "
            f"it parses to, closed by one LF, is {len(expected)} bytes",
        )
    return passed(
        f"manifest.json is {len(data)} bytes: the canonical form of its value and one LF"
    )


def check_manifest_fields(ctx: Context) -> Outcome:
    manifest = ctx.manifest_fields()
    return passed(
        f"the manifest names {manifest.title!r} by {manifest.author_name}, signed "
        f"{manifest.created_at}"
    )


def check_manifest_extra_fields(ctx: Context) -> Outcome:
    ctx.version_gate()
    value = ctx.manifest_value()
    unknown = documents.manifest_unknown_fields(value)
    if unknown:
        return failed(
            UNKNOWN_FIELD,
            f"the manifest carries {', '.join(sorted(unknown))}, and a field nobody "
            "interprets is a field that can be changed without changing the verdict",
        )
    return passed("the manifest carries no field this verifier has no rule for")


def check_content_utf8(ctx: Context) -> Outcome:
    data = ctx.content_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        return failed(
            NON_CANONICAL,
            "content.md begins with a UTF-8 byte order mark, and the bytes of the file "
            "are the content: a mark a reader agreed to ignore would be content some "
            "readers count",
        )
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as problem:
        return failed(
            DECODE_ERROR,
            f"content.md is not valid UTF-8 ({problem.reason} at byte {problem.start})",
        )
    return passed(
        f"content.md is {len(data)} byte(s) of valid UTF-8 and carries no byte order mark"
    )


def check_content_hash(ctx: Context) -> Outcome:
    data = ctx.content_bytes()
    manifest = ctx.manifest_fields()
    declared = manifest.content_sha256
    actual = hashlib.sha256(data).hexdigest()
    if not documents.is_digest(declared):
        return failed(
            NON_CANONICAL_ENCODING,
            f"manifest.content.sha256 is {declared!r}, which is not the one spelling "
            "of a SHA-256 digest: 64 lowercase hexadecimal characters",
        )
    if actual != declared:
        return failed(
            MISMATCH,
            f"SHA-256 of content.md is {actual}, and the manifest declares {declared}",
        )
    return passed(f"SHA-256 of content.md is {actual}")


def check_provenance_parse(ctx: Context) -> Outcome:
    values = ctx.log_values()
    return passed(
        f"provenance.jsonl is {len(values)} JSON object(s), one per LF-terminated line"
    )


def check_provenance_canonical(ctx: Context) -> Outcome:
    ctx.version_gate()
    values = ctx.log_values()
    for number, (line, value) in enumerate(values, start=1):
        try:
            expected = canonical.canonical_document(value)
        except Refusal as refusal:
            return failed(refusal.reason, refusal.detail)
        if line + b"\n" != expected:
            return failed(
                NON_CANONICAL,
                f"line {number} is not the canonical form of the object it parses to, "
                "closed by one LF",
            )
    return passed(
        f"every one of the {len(values)} line(s) is the canonical form of the object it "
        "parses to, each closed by one LF"
    )


def check_provenance_fields(ctx: Context) -> Outcome:
    ctx.log_entries()
    return passed("every entry carries the seven fields, correctly typed and encoded")


def check_provenance_extra_fields(ctx: Context) -> Outcome:
    ctx.version_gate()
    values = ctx.log_values()
    for number, (line, value) in enumerate(values, start=1):
        unknown = documents.entry_unknown_fields(value)
        if unknown:
            return failed(
                UNKNOWN_FIELD,
                f"line {number} carries {', '.join(sorted(unknown))}, and a field this "
                "version has no rule for is refused rather than ignored",
            )
    return passed("the log carries no field this verifier has no rule for")


def check_provenance_nonempty(ctx: Context) -> Outcome:
    values = ctx.log_values()
    if not values:
        return failed(
            MISSING,
            "provenance.jsonl holds no entries, and an artifact that records nothing "
            "about where it came from is refused",
        )
    return passed(f"provenance.jsonl holds {len(values)} entry(ies)")


def check_provenance_content_hash_format(ctx: Context) -> Outcome:
    """Every entry declares a digest. L0.PROVENANCE.CONTENT_HASH_FORMAT.

    The code follows the state of the field rather than a constant here: a field
    that is not in the entry is MISSING, a string that is there and is not the one
    spelling of a digest is NON_CANONICAL_ENCODING, and a value that is there and
    is not a string at all is MALFORMED — the field is present and does not hold
    the JSON value the table names, which is a different sentence from "this is
    not the one spelling of a digest" (SPEC section 5's second paragraph). The
    MISSING reading came from a probe asking this exact question: the reference
    used to report a spelling problem for a field that was not there.
    """
    ctx.version_gate()
    values = ctx.log_values()
    for number, (line, value) in enumerate(values, start=1):
        if "content_sha256" not in value:
            return failed(
                MISSING,
                f"line {number} carries no content_sha256 field, and a digest that "
                "is not there is not a digest spelled wrongly",
            )
        digest = value["content_sha256"]
        if not isinstance(digest, str):
            return failed(
                MALFORMED,
                f"line {number} declares content_sha256 of type "
                f"{type(digest).__name__}, and this field is a string",
            )
        if not documents.is_digest(digest):
            return failed(
                NON_CANONICAL_ENCODING,
                f"line {number} declares content_sha256 {digest!r}, which is not the "
                "one spelling of a SHA-256 digest: 64 lowercase hexadecimal characters",
            )
    return passed("every content_sha256 in the log is a 64-character lowercase digest")


# --- L1: the key, and the signatures over the bytes of section 4.1 ---------


def check_manifest_key_id(ctx: Context) -> Outcome:
    public_key = ctx.manifest_key()
    manifest = ctx.manifest_fields()
    derived = ed25519.derive_key_id(public_key)
    if derived != manifest.key_id:
        return failed(
            MISMATCH,
            f"manifest.author.key_id is {manifest.key_id}, and the key it carries "
            f"derives {derived}",
        )
    return passed(
        f"manifest.author.key_id is the derivation of the public key beside it, {derived}"
    )


def check_manifest_signature(ctx: Context) -> Outcome:
    manifest = ctx.manifest_fields()
    try:
        signature = base64url.decode(manifest.signature_text, "signature")
    except Refusal as refusal:
        return failed(refusal.reason, refusal.detail)
    if len(signature) != 64:
        return failed(
            MALFORMED,
            f"manifest.signature decodes to {len(signature)} byte(s), and an Ed25519 "
            "signature is 64: this is not a signature that failed, it is not a signature",
        )
    try:
        public_key = ctx.manifest_key()
    except Blocked as blocked:
        if blocked.blocker.owner != MANIFEST_KEY_ID:
            raise
        # A key that does not decode, or is the wrong length. The signature
        # cannot be checked against it, so this requirement does not hold: the
        # reference reports it here rather than skipping, and the reason code is
        # the key's own. What *is* skipped is the entry-level checks, which have
        # no key identity to compare against.
        return failed(blocked.blocker.reason, blocked.blocker.detail)
    try:
        message = canonical.signing_input(manifest.value)
    except Refusal as refusal:
        return failed(refusal.reason, refusal.detail)
    if not ed25519.available():
        return unsupported(
            UNSUPPORTED_FEATURE,
            "this runtime cannot verify Ed25519 signatures, and verification that did "
            "not happen is not verification that succeeded",
        )
    if not ed25519.verify(public_key, signature, message):
        return failed(
            MISMATCH,
            "manifest.signature is not this key's signature over the canonical manifest "
            "without its signature field, followed by one LF",
        )
    return passed(
        "manifest.signature is a valid ed25519 signature over the canonical manifest "
        f"without its signature field, followed by one LF ({len(message)} bytes)"
    )


def check_first_author(ctx: Context) -> Outcome:
    first = ctx.log_first()
    ctx.manifest_key()
    manifest = ctx.manifest_fields()
    if first.key_id != manifest.key_id:
        return failed(
            MISMATCH,
            f"the first entry names {first.key_id}, and the key this artifact carries is "
            f"{manifest.key_id}",
        )
    return passed(f"the first entry names {first.key_id}, the key the manifest carries")


def check_keys(ctx: Context) -> Outcome:
    entries = ctx.log_entries()
    ctx.manifest_key()
    manifest = ctx.manifest_fields()
    for number, entry in enumerate(entries, start=1):
        if entry.key_id != manifest.key_id:
            return failed(
                MISMATCH,
                f"entry {number} names {entry.key_id}, and the key this artifact carries "
                f"is {manifest.key_id}",
            )
    return passed(
        f"all {len(entries)} entries name the one key this artifact carries, "
        f"{manifest.key_id}"
    )


def check_signatures(ctx: Context) -> Outcome:
    entries = ctx.log_entries()
    public_key = ctx.manifest_key()
    if not ed25519.available():
        return unsupported(
            UNSUPPORTED_FEATURE,
            "this runtime cannot verify Ed25519 signatures, and verification that did "
            "not happen is not verification that succeeded",
        )
    for number, entry in enumerate(entries, start=1):
        try:
            signature = base64url.decode(entry.signature_text, "signature")
        except Refusal as refusal:
            return failed(refusal.reason, refusal.detail)
        if len(signature) != 64:
            return failed(
                MALFORMED,
                f"entry {number}'s signature decodes to {len(signature)} byte(s), and "
                "an Ed25519 signature is 64",
            )
        try:
            message = canonical.signing_input(entry.value)
        except Refusal as refusal:
            return failed(refusal.reason, refusal.detail)
        if not ed25519.verify(public_key, signature, message):
            return failed(
                MISMATCH,
                f"entry {number} is not signed by the key this artifact carries, over "
                "its canonical form without its signature field and one LF",
            )
    return passed(
        f"each of the {len(entries)} entries is signed by the key this artifact carries"
    )


# --- L2: the chain --------------------------------------------------------

# SPEC section 9: "parent of entry n is the SHA-256 of line n-1 as it stands in
# the file: the canonical JSON of that entry, plus the one LF that closes it."
# The hash is taken over the bytes the file holds, not over the canonical form
# of the value: CANONICAL is a different check with a different reason code, and
# a log that is not canonical still has to have its links measured against what
# is actually there.


def check_first_parent_null(ctx: Context) -> Outcome:
    first = ctx.log_first()
    if first.parent is not None:
        return failed(
            MISMATCH,
            f"the first entry declares parent {first.parent}, so the chain starts in "
            "the middle of another one",
        )
    return passed("the first entry declares no parent, so the chain starts here")


def check_links(ctx: Context) -> Outcome:
    entries = ctx.log_entries()
    for index in range(1, len(entries)):
        declared = entries[index].parent
        if declared is None:
            return failed(
                MISMATCH,
                f"entry {index + 1} declares no parent, and only the first entry of "
                "a chain may start from nothing",
            )
        # This check reads the parent, so the parent's spelling is this check's to
        # report: a string that is not 64 lowercase hex characters is
        # NON_CANONICAL_ENCODING rather than a link that does not match, because
        # the two are different complaints about different things (SPEC section 5).
        if not documents.is_digest(declared):
            return failed(
                NON_CANONICAL_ENCODING,
                f"entry {index + 1} declares parent {declared!r}, which is not the "
                "one spelling of a SHA-256 digest: 64 lowercase hexadecimal characters",
            )
        expected = hashlib.sha256(entries[index - 1].line + b"\n").hexdigest()
        if declared != expected:
            return failed(
                MISMATCH,
                f"entry {index + 1} declares parent {declared}, and the "
                f"line before it hashes to {expected}",
            )
    return passed(
        f"each of the {max(len(entries) - 1, 0)} link(s) from one entry to the line "
        "before it matches"
    )


def check_head_matches_content(ctx: Context) -> Outcome:
    head = ctx.log_head()
    manifest = ctx.manifest_fields()
    declared = manifest.content_sha256
    if not documents.is_digest(declared) or not documents.is_digest(head.content_sha256):
        return failed(
            NON_CANONICAL_ENCODING,
            "the last entry declares content_sha256 "
            f"{head.content_sha256!r} and the manifest declares {declared!r}, and one "
            "of them is not the one spelling of a SHA-256 digest",
        )
    if head.content_sha256 != declared:
        return failed(
            MISMATCH,
            f"the last entry declares content_sha256 {head.content_sha256}, and the "
            f"manifest declares {declared} for content.md",
        )
    return passed(
        f"the last entry's content_sha256, {head.content_sha256}, is the digest the "
        "manifest declares for content.md"
    )


# --- the registry ---------------------------------------------------------

# SPEC section 10: "The 30 checks, in the order they always appear in a verdict",
# and "every verdict contains all 30 entries with this order, so two verdicts can
# be compared line by line and two runs over one artifact are byte-identical."
#
# The requirement text is the spec's own table, trimmed to one line each. The
# spec says prose may be reworded between releases and reason codes may not, so
# these strings are allowed to differ from the reference's and the ids are not.
CHECKS = (
    (READABLE, "L0", "The artifact is a ZIP archive whose central directory this verifier can walk.", check_readable),
    (VERSION, "L0", "The archive needs no ZIP feature level above the one implemented here (no ZIP64, one disk).", check_version),
    (FLAGS, "L0", "No entry sets a general purpose bit other than the UTF-8 name flag and the two deflate level hints.", check_flags),
    (LAYOUT, "L0", "Every byte of the file is accounted for by a header, an entry, or the central directory: nothing precedes, follows, or overlaps.", check_layout),
    (METADATA, "L0", "The container declares nothing about a host system, a disk, a clock, or file attributes, and each local header repeats the claims in the central directory.", check_metadata),
    (ENTRY_SET, "L0", "Exactly the three required entries are present, under exactly those names, with no duplicates.", check_entry_set),
    (ENTRY_DATA, "L0", "Every entry is stored or raw-deflated, and its bytes decode.", check_entry_data),
    (SIZES, "L0", "Every entry declares the uncompressed size it actually has.", check_sizes),
    (CRC32, "L0", "Every entry declares the CRC-32 of the bytes it actually holds.", check_crc32),
    (FORMAT_IDENTIFIER, "L0", 'manifest.format is exactly "charter/0.1".', check_format),
    (MANIFEST_PARSE, "L0", "manifest.json is one well-formed JSON object: no duplicate keys, no floats, no unpaired surrogates.", check_manifest_parse),
    (MANIFEST_CANONICAL, "L0", "The bytes of manifest.json are exactly the canonical form of its value followed by one LF.", check_manifest_canonical),
    (MANIFEST_FIELDS, "L0", "The required manifest fields are present, correctly typed, and canonically encoded.", check_manifest_fields),
    (MANIFEST_EXTRA_FIELDS, "L0", "manifest.json carries no field this verifier has no rule for.", check_manifest_extra_fields),
    (CONTENT_UTF8, "L0", "content.md is valid UTF-8 and does not begin with a byte order mark.", check_content_utf8),
    (CONTENT_HASH, "L0", "SHA-256 of the bytes of content.md equals manifest.content.sha256.", check_content_hash),
    (PROVENANCE_PARSE, "L0", "provenance.jsonl is one JSON object per line, each line terminated by exactly one LF.", check_provenance_parse),
    (PROVENANCE_CANONICAL, "L0", "Each provenance line is exactly the canonical form of its value followed by one LF.", check_provenance_canonical),
    (PROVENANCE_FIELDS, "L0", "The required provenance fields are present, correctly typed, and canonically encoded.", check_provenance_fields),
    (PROVENANCE_EXTRA_FIELDS, "L0", "provenance.jsonl carries no field this verifier has no rule for.", check_provenance_extra_fields),
    (PROVENANCE_NONEMPTY, "L0", "provenance.jsonl holds at least one entry.", check_provenance_nonempty),
    (PROVENANCE_CONTENT_HASH_FORMAT, "L0", "Every entry's content_sha256 is 64 lowercase hexadecimal characters.", check_provenance_content_hash_format),
    (MANIFEST_KEY_ID, "L1", "manifest.author.key_id is the derivation of manifest.author.public_key.", check_manifest_key_id),
    (MANIFEST_SIGNATURE, "L1", "manifest.signature verifies over the canonical manifest without its signature field.", check_manifest_signature),
    (FIRST_AUTHOR, "L1", "The first provenance entry names the same author key as the manifest.", check_first_author),
    (KEYS, "L1", "Every provenance entry names the one key this artifact carries.", check_keys),
    (SIGNATURES, "L1", "Every provenance entry signature verifies over its canonical form.", check_signatures),
    (FIRST_PARENT_NULL, "L2", "The first entry's parent is null.", check_first_parent_null),
    (LINKS, "L2", "Each entry's parent equals the SHA-256 of the previous line as it stands in the file.", check_links),
    (HEAD_MATCHES_CONTENT, "L2", "The last entry's content_sha256 equals manifest.content.sha256.", check_head_matches_content),
)


class CheckResult:
    """One check's answer, in the shape a verdict reports it."""

    def __init__(self, id: str, level: str, requirement: str, outcome: Outcome) -> None:
        self.id = id
        self.level = level
        self.requirement = requirement
        self.status = outcome.status
        self.reason_code = outcome.reason
        self.detail = outcome.detail


def run(data: bytes) -> list:
    """Every check's answer, and nothing about the artifact as a whole."""
    results, _ = examine(data)
    return results


def examine(data: bytes):
    """Every check, in the fixed order, with the prerequisite rules applied.

    Returns the results and the context they were answered from, so that the
    artifact summary a JSON verdict carries is read out of the same walk rather
    than computed a second time by a second reader.
    """
    ctx = Context(data)
    results = []
    for id, level, requirement, check in CHECKS:
        try:
            outcome = check(ctx)
        except Blocked as blocked:
            blocker = blocked.blocker
            if blocker.owner == id:
                # This check owns the fact that failed, so it reports it.
                outcome = Outcome(blocker.status, blocker.reason, blocker.detail)
            else:
                outcome = Outcome(
                    SKIP,
                    blocker.skip_reason(),
                    f"something this check needs did not hold: {blocker.detail}",
                )
        results.append(CheckResult(id, level, requirement, outcome))
    return results, ctx
