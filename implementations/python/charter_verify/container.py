"""The ZIP container, read as bytes. SPEC section 3.

Everything in this module is enforced by a check whose id starts with
`L0.ZIP.`, and the module itself is a parser: it answers questions about
structure, and the checks decide what the answers mean. Two of its rules are
worth naming up front because they are the ones a port gets wrong.

* **Entries are stored or raw-deflated, and nothing else.** The method field is
  read and the data is handed back exactly as the file holds it. A reader that
  assumed deflate fails on every fixture in the kit, and a reader that assumed
  stored quietly returns compressed bytes as if they were a document.
* **Every byte is looked at.** SPEC section 3.6 states the rule that closed the
  last hole in the reference: a byte the reader never looks at is a byte a
  forged file can change for free. So the local header, the extra fields, the
  central directory, the end record and the gap between them are all measured,
  and the results are handed to LAYOUT rather than discarded here.
"""

from __future__ import annotations

import zlib

from . import limits
from .errors import Refusal
from .vocabulary import DECODE_ERROR, LIMIT_EXCEEDED, MALFORMED, UNSUPPORTED_FEATURE

EOCD_SIGNATURE = b"PK\x05\x06"
CENTRAL_SIGNATURE = b"PK\x01\x02"
LOCAL_SIGNATURE = b"PK\x03\x04"

EOCD_BYTES = 22
CENTRAL_BYTES = 46
LOCAL_BYTES = 30

# The general purpose bits this version implements, and the ones it knows how
# not to implement. SPEC section 3.3.
ALLOWED_FLAGS = 0x0002 | 0x0004 | 0x0800
UNSUPPORTED_FLAGS = 0x0001 | 0x0008 | 0x0020 | 0x0040 | 0x2000

# The values a charter/0.1 file may hold in the fields ZIP leaves to a writer.
# SPEC section 3.6.
FIXED_VERSION_MADE_BY = 0x0014
FIXED_DOS_DATE = 0x0021
FIXED_DOS_TIME = 0x0000
REQUIRED_NAMES = ("manifest.json", "content.md", "provenance.jsonl")


class Entry:
    """One central directory record, with the local header it points at."""

    def __init__(
        self,
        *,
        name: bytes,
        central: dict,
        local: dict,
        header_offset: int,
        data_offset: int,
        data: bytes,
    ) -> None:
        self.name = name
        self.name_text = name.decode("utf-8", "replace")
        self.central = central
        self.local = local
        self.header_offset = header_offset
        self.data_offset = data_offset
        self.data = data

    # The facts the checks ask for, named once.
    @property
    def version_made_by(self) -> int:
        return self.central["version_made_by"]

    @property
    def version_needed(self) -> int:
        return self.central["version_needed"]

    @property
    def method(self) -> int:
        return self.central["method"]

    @property
    def flags(self) -> int:
        return self.central["flags"]

    @property
    def local_flags(self) -> int:
        return self.local["flags"]

    @property
    def crc32(self) -> int:
        return self.central["crc32"]

    @property
    def compressed_size(self) -> int:
        return self.central["compressed_size"]

    @property
    def size(self) -> int:
        return self.central["size"]

    @property
    def dos_date(self) -> int:
        return self.central["dos_date"]

    @property
    def dos_time(self) -> int:
        return self.central["dos_time"]

    @property
    def disk(self) -> int:
        return self.central["disk"]

    @property
    def internal_attrs(self) -> int:
        return self.central["internal_attrs"]

    @property
    def external_attrs(self) -> int:
        return self.central["external_attrs"]

    @property
    def comment_len(self) -> int:
        return self.central["comment_len"]

    @property
    def extra_len(self) -> int:
        return self.central["extra_len"]

    @property
    def local_extra_len(self) -> int:
        return self.local["extra_len"]

    @property
    def name_len(self) -> int:
        return self.central["name_len"]


class Container:
    """What a walk of the archive established, and nothing about meaning."""

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.size = len(data)
        self.entries: list[Entry] = []
        self.eocd_offset = 0
        self.eocd_comment_len = 0
        self.disk_number = 0
        self.cd_disk = 0
        self.entries_this_disk = 0
        self.entries_total = 0
        self.cd_offset = 0
        self.cd_size = 0
        self.cd_consumed = 0
        self.layout_pairs: list[tuple[str, int, int]] = []
        self.layout_end = 0

    def named(self, name: str) -> list[Entry]:
        """Every entry with this name, in the order the file holds them.

        The order matters and is not a detail: the kit's `duplicate-entry` case
        holds a second, empty `content.md` after the real one, and every other
        check passes, which is only true of a reader that takes the first
        occurrence. SPEC section 3 says a name identifies one entry and does not
        say which bytes a reader should take when a file breaks that rule. This
        implementation takes the one whose local header comes first in the file,
        because that is the byte order the file itself states.
        """
        return [entry for entry in self.entries if entry.name_text == name]

    def first(self, name: str) -> Entry | None:
        found = self.named(name)
        return found[0] if found else None


def _u16(data: bytes, at: int) -> int:
    return int.from_bytes(data[at : at + 2], "little")


def _u32(data: bytes, at: int) -> int:
    return int.from_bytes(data[at : at + 4], "little")


def walk(data: bytes) -> Container:
    """Walk the archive, or refuse it. SPEC section 3.1.

    A refusal here is `L0.ZIP.READABLE` and it stops everything: there is no
    container to read, so nothing inside it has been examined. Every other
    complaint about the container is a fact this function records for a check
    that has a name for it.
    """
    container = Container(data)
    if len(data) > limits.FILE_BYTES:
        raise Refusal(
            LIMIT_EXCEEDED,
            f"the file is {len(data)} bytes, and the ceiling for one artifact is "
            f"{limits.FILE_BYTES}",
        )

    # A single end-of-central-directory record, found by scanning backwards
    # over at most 65,535 bytes, and the file ends where it ends.
    earliest = max(0, len(data) - limits.EOCD_SEARCH_BYTES - EOCD_BYTES)
    at = data.rfind(EOCD_SIGNATURE, earliest)
    if at < 0:
        raise Refusal(
            MALFORMED,
            "no end-of-central-directory record is within 65,535 bytes of the end "
            "of the file, so this is not a ZIP archive this verifier can walk",
        )
    if at + EOCD_BYTES > len(data):
        raise Refusal(
            MALFORMED,
            f"the end record at offset {at} runs past the end of the file: the file "
            "is short of its own directory",
        )
    container.eocd_offset = at
    container.disk_number = _u16(data, at + 4)
    container.cd_disk = _u16(data, at + 6)
    container.entries_this_disk = _u16(data, at + 8)
    container.entries_total = _u16(data, at + 10)
    container.cd_size = _u32(data, at + 12)
    container.cd_offset = _u32(data, at + 16)
    container.eocd_comment_len = _u16(data, at + 20)
    if at + EOCD_BYTES + container.eocd_comment_len > len(data):
        raise Refusal(
            MALFORMED,
            f"the end record declares a {container.eocd_comment_len}-byte comment, "
            "and the file does not hold that many bytes after it",
        )

    # The central directory lies inside the file.
    if (
        container.cd_offset > len(data)
        or container.cd_offset + container.cd_size > len(data)
    ):
        raise Refusal(
            MALFORMED,
            f"the central directory is declared at offset {container.cd_offset} and "
            f"{container.cd_size} bytes long, and the file is {len(data)} bytes",
        )

    # It declares exactly as many entries as it contains, and each record
    # points at a local header whose name is byte-for-byte the record's name.
    at = container.cd_offset
    for _ in range(container.entries_total):
        if at + CENTRAL_BYTES > len(data) or data[at : at + 4] != CENTRAL_SIGNATURE:
            raise Refusal(
                MALFORMED,
                f"the central directory declares {container.entries_total} entr(ies) "
                f"and holds no record at offset {at}",
            )
        record = _central_record(data, at)
        name_end = at + CENTRAL_BYTES + record["name_len"]
        if name_end + record["extra_len"] + record["comment_len"] > len(data):
            raise Refusal(
                MALFORMED,
                f"the central directory record at offset {at} runs past the end of "
                "the file",
            )
        if record["name_len"] > limits.ENTRY_NAME_BYTES:
            raise Refusal(
                LIMIT_EXCEEDED,
                f"an entry name is {record['name_len']} bytes, and the ceiling for "
                f"one name is {limits.ENTRY_NAME_BYTES}",
            )
        name = data[at + CENTRAL_BYTES : name_end]
        local, data_offset = _local_header(data, record["header_offset"], name)
        if (
            record["compressed_size"] > limits.ENTRY_COMPRESSED_BYTES
            or local["compressed_size"] > limits.ENTRY_COMPRESSED_BYTES
        ):
            raise Refusal(
                LIMIT_EXCEEDED,
                f"{name!r} declares {record['compressed_size']} compressed byte(s), "
                f"and the ceiling for one entry is {limits.ENTRY_COMPRESSED_BYTES}",
            )
        end = data_offset + record["compressed_size"]
        if end > len(data):
            raise Refusal(
                MALFORMED,
                f"{name!r} declares {record['compressed_size']} bytes of data at "
                f"offset {data_offset}, and the file ends at {len(data)}",
            )
        container.entries.append(
            Entry(
                name=name,
                central=record,
                local=local,
                header_offset=record["header_offset"],
                data_offset=data_offset,
                data=data[data_offset:end],
            )
        )
        at = name_end + record["extra_len"] + record["comment_len"]
    container.cd_consumed = at - container.cd_offset
    _record_layout(container, at)
    return container


def _central_record(data: bytes, at: int) -> dict:
    """The central directory record at this offset, field by field."""
    return {
        "version_made_by": _u16(data, at + 4),
        "version_needed": _u16(data, at + 6),
        "flags": _u16(data, at + 8),
        "method": _u16(data, at + 10),
        "dos_time": _u16(data, at + 12),
        "dos_date": _u16(data, at + 14),
        "crc32": _u32(data, at + 16),
        "compressed_size": _u32(data, at + 20),
        "size": _u32(data, at + 24),
        "name_len": _u16(data, at + 28),
        "extra_len": _u16(data, at + 30),
        "comment_len": _u16(data, at + 32),
        "disk": _u16(data, at + 34),
        "internal_attrs": _u16(data, at + 36),
        "external_attrs": _u32(data, at + 38),
        "header_offset": _u32(data, at + 42),
    }


def _local_header(data: bytes, at: int, name: bytes) -> tuple[dict, int]:
    """The local header this record points at, and where its data starts."""
    if at + LOCAL_BYTES > len(data) or data[at : at + 4] != LOCAL_SIGNATURE:
        raise Refusal(
            MALFORMED,
            f"a central directory record points at offset {at}, where there is no "
            "local header",
        )
    name_len = _u16(data, at + 26)
    extra_len = _u16(data, at + 28)
    end = at + LOCAL_BYTES + name_len + extra_len
    if end > len(data):
        raise Refusal(
            MALFORMED,
            f"the local header at offset {at} runs past the end of the file",
        )
    local_name = data[at + LOCAL_BYTES : at + LOCAL_BYTES + name_len]
    if local_name != name:
        raise Refusal(
            MALFORMED,
            f"the central directory names {name!r} and the local header it points at "
            f"names {local_name!r}",
        )
    return (
        {
            "version_needed": _u16(data, at + 4),
            "flags": _u16(data, at + 6),
            "method": _u16(data, at + 8),
            "dos_time": _u16(data, at + 10),
            "dos_date": _u16(data, at + 12),
            "crc32": _u32(data, at + 14),
            "compressed_size": _u32(data, at + 18),
            "size": _u32(data, at + 22),
            "name_len": name_len,
            "extra_len": extra_len,
        },
        end,
    )


def _record_layout(container: Container, cd_end: int) -> None:
    """Account for every byte, in the order SPEC section 3.4 fixes.

    The pairs are (what, from, to) spans over the file, recorded rather than
    judged: LAYOUT compares the union of them against the whole file and
    reports EXTRA for anything left over. A reader that only walked the central
    directory would leave the gap between the last entry and the directory
    unaccounted, and that gap is where a second copy of a document fits.
    """
    spans: list[tuple[str, int, int]] = []
    by_offset = sorted(container.entries, key=lambda entry: entry.header_offset)
    for entry in by_offset:
        header_end = entry.data_offset
        spans.append((f"the local header of {entry.name_text}", entry.header_offset, header_end))
        if entry.data:
            spans.append(
                (f"the data of {entry.name_text}", header_end, header_end + len(entry.data))
            )
    spans.append(("the central directory", container.cd_offset, cd_end))
    spans.append(
        ("the end record", container.eocd_offset, container.eocd_offset + EOCD_BYTES)
    )
    if container.eocd_comment_len:
        spans.append(
            (
                "an archive comment",
                container.eocd_offset + EOCD_BYTES,
                container.eocd_offset + EOCD_BYTES + container.eocd_comment_len,
            )
        )
    container.layout_pairs = spans
    container.layout_end = cd_end


def decompress(entry: Entry) -> bytes:
    """The bytes the entry holds, expanded the way its method declares.

    Stored entries are handed back as they are; raw-deflated entries are
    inflated with the window `deflate-raw` names in the reference, which is the
    same window Python's raw deflate decoder uses. Anything else is refused with
    UNSUPPORTED_FEATURE by the caller, not here: an entry this verifier cannot
    expand is an entry it cannot judge, and that is a statement about the
    verifier rather than about the file.
    """
    if entry.method == 0:
        return entry.data
    if entry.method == 8:
        try:
            return zlib.decompress(entry.data, -zlib.MAX_WBITS)
        except zlib.error as problem:
            raise Refusal(
                DECODE_ERROR,
                f"{entry.name_text} is declared raw-deflated and does not inflate "
                f"({problem})",
            ) from None
    raise Refusal(
        UNSUPPORTED_FEATURE,
        f"{entry.name_text} declares compression method {entry.method}, and "
        "charter/0.1 defines 0 (stored) and 8 (raw deflate)",
    )
