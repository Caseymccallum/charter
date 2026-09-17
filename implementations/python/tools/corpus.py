"""The container corpus: hand-mutated ZIP structure, asked of both implementations.

The conformance kit holds 54 artifacts and the probe holds 23 more, and between
them they ask about every *field* a document has. Neither reaches the container's
byte arithmetic. A field-level case can say "this digest is uppercase"; it cannot
say "this entry's declared compressed size is one byte more than the bytes after
it", because that is not a field of a document but an offset in a file, and two
ZIP walkers that agree on 54 fixtures and 212 field-level cases can still disagree
about it. That is what this corpus exists to find.

# A corpus, not a fuzzer

Every case here is one change to `vectors/out/valid.charter`, written by hand and
committed as bytes — an entry renamed, three entries reordered, a flag bit set
in one header and not the other, an offset pointed at the wrong record, a count
off by one — and one case changes two things, because its question is about a file
wrong in two places at once. The artifacts are under `vectors/container/out/`, the
answers the two implementations gave for them are in `vectors/container/expected.json`, and
`vectors/container/run.js` replays both against that record. Mutating the same
file with a *program* — a fuzzer — is the next step, and `tools/sweep.py`'s
docstring states the case for it; this file is what has to exist first, because a
fuzzer needs somewhere to put what it finds.

# What a case asks, and the rule that settles a disagreement

Each case carries the mutation, the question a reasonable reader should answer,
and the section of SPEC.md that answers it — or `null`, where section 3 is
silent and the question is a *finding* rather than a verdict. The first run of
this corpus produced disagreements, and every one of them was settled the way the
brief for this pass says: read the ZIP specification, read section 3, and if
section 3 is silent, amend section 3 and fix *both* implementations. The `note`
of each case says which of the two moved and why.

`--build` asks the reference command line and this repository's port about every
artifact and refuses to write a record when an answer contradicts the question
the case asks. It does *not* refuse on a disagreement between the two
implementations: a disagreement is the finding, the record holds both answers
side by side, and `run.js` reports it as a finding rather than as a failure. An
artifact whose recorded answer is not the answer the case asks for is a broken
fixture; an artifact the two implementations read differently is the reason this
directory exists.

Usage:
    python tools/corpus.py --build [--quiet]
    python tools/corpus.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import struct
import subprocess
import sys
import zlib

HERE = pathlib.Path(__file__).resolve()
PYTHON_DIR = HERE.parents[1]
REPO = HERE.parents[3]
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from tools.differential import (  # noqa: E402
    differences,
    port_tally,
    reference_tally,
)

BASE_PATH = REPO / "vectors" / "out" / "valid.charter"
OUT_DIR = REPO / "vectors" / "container" / "out"
RECORD_PATH = REPO / "vectors" / "container" / "expected.json"
REFERENCE = ["node", "cli/charter.js", "verify"]

CORPUS_NOTE = (
    "Every artifact here is one hand-written change to vectors/out/valid.charter — or, in "
    "one case, two, because its question is about a file that is wrong in two places at "
    "once — and the answers are the ones the two implementations gave for it. `expected` is the reference "
    "command line's answer, `port` is implementations/python's, and `agreement` says whether "
    "they are the same answer: where they are not, the case is the finding this corpus exists "
    "to produce, and `note` says which implementation moved and why. Each case also carries "
    "the question it asks and the section of SPEC.md that answers it, or null where the "
    "section is silent. Nothing here is a conformance kit: the kit is vectors/out/ and it "
    "enforces; this is a finding tool that records what both implementations said."
)

LOCAL = b"PK\x03\x04"
CENTRAL = b"PK\x01\x02"
EOCD = b"PK\x05\x06"

LOCAL_BYTES = 30
CENTRAL_BYTES = 46
EOCD_BYTES = 22

NAME_LEN_AT = 26  # in a local header
CENTRAL_NAME_LEN_AT = 28  # in a central directory record

# The fields of a local header and of a central directory record, by the offset
# ZIP puts them at. One table per record, named once, so a mutation says which
# field it changes rather than which number.
LOCAL_FIELDS = {
    "version_needed": 4,
    "flags": 6,
    "method": 8,
    "crc32": 14,
    "compressed_size": 18,
    "size": 22,
}
CENTRAL_FIELDS = {
    "version_made_by": 4,
    "version_needed": 6,
    "flags": 8,
    "method": 10,
    "crc32": 16,
    "compressed_size": 20,
    "size": 24,
    "name_len": 28,
    "extra_len": 30,
    "comment_len": 32,
    "disk": 34,
    "internal_attrs": 36,
    "external_attrs": 38,
    "header_offset": 42,
}


def u16(data: bytes, at: int) -> int:
    return struct.unpack_from("<H", data, at)[0]


def u32(data: bytes, at: int) -> int:
    return struct.unpack_from("<I", data, at)[0]


def w16(data: bytearray, at: int, value: int) -> None:
    struct.pack_into("<H", data, at, value)


def w32(data: bytearray, at: int, value: int) -> None:
    struct.pack_into("<I", data, at, value)


class Record:
    """One entry, as the two tables in the file describe it."""

    def __init__(self, data: bytes, central_at: int) -> None:
        self.central_at = central_at
        self.name_len = u16(data, central_at + CENTRAL_FIELDS["name_len"])
        self.name = data[central_at + CENTRAL_BYTES : central_at + CENTRAL_BYTES + self.name_len]
        self.central_end = central_at + CENTRAL_BYTES + self.name_len
        self.local_at = u32(data, central_at + CENTRAL_FIELDS["header_offset"])
        self.local_name_at = self.local_at + LOCAL_BYTES
        self.local_name_len = u16(data, self.local_at + NAME_LEN_AT)
        self.data_at = (
            self.local_name_at + self.local_name_len + u16(data, self.local_at + 28)
        )
        self.compressed = u32(data, central_at + CENTRAL_FIELDS["compressed_size"])
        self.data_end = self.data_at + self.compressed

    def local_field(self, name: str) -> int:
        """Where this entry's local copy of a field sits."""
        return self.local_at + LOCAL_FIELDS[name]

    def central_field(self, name: str) -> int:
        """Where this entry's central copy of a field sits."""
        return self.central_at + CENTRAL_FIELDS[name]

    def local_bytes(self, data: bytes) -> bytes:
        """The local header and the data it declares, as one run of bytes."""
        return data[self.local_at : self.data_end]

    def central_bytes(self, data: bytes) -> bytes:
        """The central directory record, as it stands."""
        return data[self.central_at : self.central_end]


class Archive:
    """The offsets a mutation addresses, read from the file's own bytes.

    This is not `charter_verify.container`: a corpus built by one of the two
    implementations under test would be a corpus that agrees with that
    implementation by construction. It is a locator, not a reader — it finds the
    end record, the central records and the local headers and hands back the
    offsets. Nothing here decides whether any of it is well formed.
    """

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.eocd = data.rfind(EOCD)
        if self.eocd < 0:
            raise SystemExit(f"{BASE_PATH.name} holds no end-of-central-directory record")
        self.entries_total = u16(data, self.eocd + 10)
        self.cd_size = u32(data, self.eocd + 12)
        self.cd_offset = u32(data, self.eocd + 16)
        self.entries = []
        at = self.cd_offset
        for _ in range(self.entries_total):
            record = Record(data, at)
            self.entries.append(record)
            at = record.central_end
        self.by_name = {record.name: record for record in self.entries}
        if at != self.eocd:
            raise SystemExit(
                f"{BASE_PATH.name}: the central directory ends at {at} and the end record "
                f"sits at {self.eocd}, so this corpus does not know how to mutate it"
            )

    def name(self, text: str) -> Record:
        try:
            return self.by_name[text.encode("utf-8")]
        except KeyError:
            raise SystemExit(f"{BASE_PATH.name} holds no entry named {text}") from None

    def eocd_field(self, name: str) -> int:
        """Where a field of the end record sits."""
        return self.eocd + {
            "disks": 4,
            "cd_disk": 6,
            "this_disk": 8,
            "total": 10,
            "cd_size": 12,
            "cd_offset": 16,
            "comment_len": 20,
        }[name]


def spliced(data: bytes, at: int, remove: int, insert: bytes) -> bytearray:
    """The archive with a run of bytes replaced by another run."""
    return bytearray(data[:at] + insert + data[at + remove :])



# ------------------------------------------------------------------ #
# The mutations. Each takes the located archive and returns the bytes #
# of one artifact, with everything it did not name left alone.        #
# ------------------------------------------------------------------ #

def renamed(base: Archive, from_name: str, to_name: str) -> bytes:
    """One entry's name, in both copies, so only the set of names changes."""
    source = from_name.encode("utf-8")
    target = to_name.encode("utf-8")
    if len(source) != len(target):
        raise SystemExit("a rename in this corpus keeps the name the same length")
    record = base.name(from_name)
    out = bytearray(base.data)
    out[record.local_name_at : record.local_name_at + len(source)] = target
    out[
        record.central_at + CENTRAL_BYTES : record.central_at + CENTRAL_BYTES + len(source)
    ] = target
    return bytes(out)


def filed(base: Archive, order: list) -> bytes:
    """Every entry, in this order, in the file and in the directory.

    The local headers, their data and the directory records are the same bytes;
    what changes is where each one sits and the offset its record names. A writer
    that listed `content.md` first would produce exactly this file.
    """
    body, central = [], []
    at = 0
    for text in order:
        record = base.name(text)
        local = record.local_bytes(base.data)
        entry = bytearray(record.central_bytes(base.data))
        w32(entry, CENTRAL_FIELDS["header_offset"], at)
        body.append(local)
        central.append(bytes(entry))
        at += len(local)
    return _written(base, body, central, at)


def _written(base: Archive, body: list, central: list, cd_offset: int) -> bytes:
    """The body, the directory, and an end record that describes both."""
    directory = b"".join(central)
    end = bytearray(base.data[base.eocd : base.eocd + EOCD_BYTES])
    w16(end, 8, len(central))
    w16(end, 10, len(central))
    w32(end, 12, len(directory))
    w32(end, 16, cd_offset)
    return bytes(b"".join(body) + directory + bytes(end))


def permuted(base: Archive, order: list) -> bytes:
    """The directory in another order, with the body and every offset untouched."""
    directory = b"".join(base.name(text).central_bytes(base.data) for text in order)
    return bytes(base.data[: base.cd_offset] + directory + base.data[base.eocd :])



def _fourth(base: Archive, name: bytes, payload: bytes, local_at: int):
    """The two records a fourth entry needs, every field but its own copied."""
    first = base.entries[0]
    version = u16(base.data, first.central_field("version_needed"))
    flags = u16(base.data, first.central_field("flags"))
    method = u16(base.data, first.central_field("method"))
    made_by = u16(base.data, first.central_field("version_made_by"))
    stamp_time = u16(base.data, first.central_at + 12)
    stamp_date = u16(base.data, first.central_at + 14)
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    header = struct.pack(
        "<IHHHHHIIIHH", 0x04034B50, version, flags, method, stamp_time, stamp_date, crc,
        len(payload), len(payload), len(name), 0,
    ) + name
    record = struct.pack(
        "<IHHHHHHIIIHHHHHII", 0x02014B50, made_by, version, flags, method, stamp_time,
        stamp_date, crc, len(payload), len(payload), len(name), 0, 0, 0, 0, 0, local_at,
    ) + name
    return header, record


def counted_entry(base: Archive, name: bytes, payload: bytes) -> bytes:
    """A fourth entry: a local header and its data, and a record that names it."""
    header, record = _fourth(base, name, payload, base.cd_offset)
    shift = len(header) + len(payload)
    with_body = spliced(base.data, base.cd_offset, 0, header + payload)
    directory_at = base.eocd + shift
    out = spliced(bytes(with_body), directory_at, 0, record)
    eocd_at = directory_at + len(record)
    w16(out, eocd_at + 8, base.entries_total + 1)
    w16(out, eocd_at + 10, base.entries_total + 1)
    w32(out, eocd_at + 12, base.cd_size + len(record))
    w32(out, eocd_at + 16, base.cd_offset + shift)
    return bytes(out)


def uncounted_entry(base: Archive, name: bytes, payload: bytes) -> bytes:
    """A local header and its data that no table in the file names."""
    header, _ = _fourth(base, name, payload, base.cd_offset)
    shift = len(header) + len(payload)
    out = spliced(base.data, base.cd_offset, 0, header + payload)
    w32(out, base.eocd + shift + 16, base.cd_offset + shift)
    return bytes(out)


def twice_in_the_directory(base: Archive, text: str) -> bytes:
    """One local header, named by two records in the directory."""
    record = base.name(text)
    length = record.central_end - record.central_at
    out = spliced(base.data, base.eocd, 0, record.central_bytes(base.data))
    eocd_at = base.eocd + length
    w16(out, eocd_at + 8, base.entries_total + 1)
    w16(out, eocd_at + 10, base.entries_total + 1)
    w32(out, eocd_at + 12, base.cd_size + length)
    return bytes(out)



def local_field(base: Archive, text: str, field: str, value: int) -> bytes:
    """One field of one entry's local header, and nothing else."""
    record = base.name(text)
    out = bytearray(base.data)
    write = w32 if field in ("crc32", "compressed_size", "size") else w16
    write(out, record.local_field(field), value)
    return bytes(out)


def central_field(base: Archive, text: str, field: str, value: int, both: bool = False) -> bytes:
    """One field of one entry's directory record, and its local copy if asked."""
    record = base.name(text)
    out = bytearray(base.data)
    write = w32 if field in ("crc32", "compressed_size", "size", "header_offset") else w16
    write(out, record.central_field(field), value)
    if both:
        write(out, record.local_field(field), value)
    return bytes(out)


def _every_flags(base: Archive, value: int) -> bytes:
    """One flag word, in every entry's two copies: a change every check can see."""
    out = bytearray(base.data)
    for record in base.entries:
        w16(out, record.local_field("flags"), value)
        w16(out, record.central_field("flags"), value)
    return bytes(out)


def end_record(base: Archive, field: str, value: int) -> bytes:
    """One field of the end-of-central-directory record."""
    out = bytearray(base.data)
    write = w32 if field in ("cd_size", "cd_offset") else w16
    write(out, base.eocd_field(field), value)
    return bytes(out)


def zip64_marker(base: Archive) -> bytes:
    """An end record that says the real counts are in a ZIP64 record elsewhere."""
    out = bytearray(end_record(base, "total", 0xFFFF))
    w16(out, base.eocd_field("this_disk"), 0xFFFF)
    return bytes(out)


def appended(base: Archive, extra: bytes) -> bytes:
    """Bytes after the end record, which no field of the file mentions."""
    return bytes(base.data + extra)


def local_extra_field(base: Archive, text: str, extra: bytes, declared: int) -> bytes:
    """One entry's local header, carrying an extra field and declaring it wrongly.

    The bytes are inserted where ZIP puts an extra field — between the name and the
    data — so everything after them moves, and every offset the file states about
    those bytes is moved with them: a later entry's header offset, and the
    directory's own offset in the end record. The declared length is the caller's,
    and that is the case: the header and the file then disagree about where the
    entry's data begins, without anything else in the file being wrong.
    """
    record = base.name(text)
    at = record.local_at + LOCAL_BYTES + record.local_name_len
    out = spliced(base.data, at, 0, extra)
    moved = len(extra)
    w16(out, record.local_at + 28, declared)
    for other in base.entries:
        if other.local_at > at:
            w32(
                out,
                other.central_at + moved + CENTRAL_FIELDS["header_offset"],
                other.local_at + moved,
            )
    w32(out, base.eocd + moved + 16, base.cd_offset + moved)
    return bytes(out)


def rewritten(base: Archive, changes: list) -> bytes:
    """Several fields of several entries, each written in both copies of its header.

    The corpus's discipline is one mutation per artifact, and this is that one
    mutation when a case needs two: the changes are named together and each is
    applied to the bytes the one before it produced, so what the case states is
    the pair rather than a nest of calls.
    """
    data = base.data
    for text, field, value in changes:
        data = central_field(Archive(data), text, field, value, both=True)
    return bytes(data)



def local_name_length(base: Archive, text: str, declared: int) -> bytes:
    """One entry's local header, declaring a name length its name does not have.

    Nothing moves: the bytes are where they were and the header states a length
    the name beside it does not have, so the two copies of that name disagree and
    the place the reader looks for the entry's data moves with the claim rather
    than with the file.
    """
    record = base.name(text)
    out = bytearray(base.data)
    w16(out, record.local_at + NAME_LEN_AT, declared)
    return bytes(out)


def byte_removed(base: Archive, at: int) -> bytes:
    """One byte taken out of the file, and nothing else changed at all."""
    return bytes(spliced(base.data, at, 1, b""))


def name_byte(base: Archive, text: str, index: int, value: int) -> bytes:
    """One byte of one entry's name, in both copies, so the two still agree."""
    record = base.name(text)
    out = bytearray(base.data)
    out[record.local_name_at + index] = value
    out[record.central_at + CENTRAL_BYTES + index] = value
    return bytes(out)



# ------------------------------------------------------------------ #
# The cases. One mutation each, with the question it asks and the     #
# section of SPEC.md that answers it — or None, where the section is  #
# silent and the question is a finding rather than a verdict.         #
# ------------------------------------------------------------------ #

def cases() -> list:
    base = Archive(BASE_PATH.read_bytes())
    content = base.name("content.md")
    manifest = base.name("manifest.json")
    flags = u16(base.data, content.central_field("flags"))
    payload = b"Not part of the format.\n"
    listed = [
        {
            "name": "entry-name-uppercase",
            "mutation": "`manifest.json` is renamed `MANIFEST.JSON` in the local header and in the directory record, so both copies still agree and only the set of names changed.",
            "question": "The format names three entries and says a name identifies one entry. An archive whose names are the right names in the wrong case holds no `manifest.json`: is that the entry set's problem, and is it MISSING or EXTRA?",
            "spec": "3.4",
            "bytes": renamed(base, "manifest.json", "MANIFEST.JSON"),
        },
        {
            "name": "entry-order-reordered",
            "mutation": "The three entries are written in the order `content.md`, `provenance.jsonl`, `manifest.json`, in the body and in the directory, with every offset adjusted so the file is consistent.",
            "question": "Section 3.4 fixes the order of the *categories* — header, data, directory, end record — and says nothing about the order of the entries themselves. Is a file whose entries appear in another order, described correctly by its own directory, still a charter?",
            "spec": "3.4",
            "bytes": filed(base, ["content.md", "provenance.jsonl", "manifest.json"]),
        },
        {
            "name": "entry-central-order-swapped",
            "mutation": "The three records in the central directory are written in the order `provenance.jsonl`, `content.md`, `manifest.json`. The body, the offsets and the end record are untouched.",
            "question": "A writer that sorts its directory by name, or by anything else, produces this file. Does the format require the directory to list the entries in the order their local headers appear in the file?",
            "spec": "3.4",
            "bytes": permuted(base, ["provenance.jsonl", "content.md", "manifest.json"]),
        },
        {
            "name": "entry-fourth-unknown",
            "mutation": "A fourth entry, `attachments/note.txt`, is added: a local header and its data after the last entry, a record for it in the directory, and the end record's counts, size and offset adjusted.",
            "question": "The format defines exactly three entries. Which check refuses a fourth, and with which reason code?",
            "spec": "3.4",
            "bytes": counted_entry(base, b"attachments/note.txt", payload),
        },
        {
            "name": "entry-central-record-twice",
            "mutation": "A second copy of `manifest.json`'s directory record is inserted before the end record, with the counts and the directory size adjusted to match. Both records name the same one local header.",
            "question": "Two entries whose local headers claim the same offset: the second record describes bytes the first one already claims. Is that a range that overlaps another (a MISMATCH between two claims) or bytes where the format does not put them (EXTRA)?",
            "spec": "3.4",
            "bytes": twice_in_the_directory(base, "manifest.json"),
        },
        {
            "name": "flag-word-above-the-format",
            "mutation": "Both copies of every entry's header set general purpose bit 0x0010 as well as the UTF-8 name bit: a bit that is neither one of the three charter/0.1 allows nor one of the five that describe a feature with a name.",
            "question": "The two copies agree, so no refusal applies; the bit is not one the format defines a meaning for, so no reader implements it either. Which reason code does `L0.ZIP.FLAGS` give a bit this format has no room for, and does the artifact come back broken or unproven?",
            "spec": "3.3",
            "bytes": _every_flags(base, flags | 0x0010),
        },
        {
            "name": "local-compressed-size-off-by-one",
            "mutation": "`content.md`'s *local* header declares one byte more of compressed data than `content.md` holds. The directory record still declares the real size.",
            "question": "ZIP states the compressed size twice. The bytes the entry holds are the ones the directory names, and the local header says another number: which check owns the disagreement?",
            "spec": "3.6",
            "bytes": local_field(
                base, "content.md", "compressed_size", content.compressed + 1
            ),
        },
        {
            "name": "local-uncompressed-size-off-by-one",
            "mutation": "`content.md`'s local header declares one byte more of data than it holds uncompressed. The directory record still declares the real size.",
            "question": "The same disagreement, about the other size. Section 3.5 makes the declared *uncompressed* size a claim about the bytes; does the local copy's disagreement with the directory belong to the check that measures the bytes, or to the check that compares the two copies?",
            "spec": "3.6",
            "bytes": local_field(
                base, "content.md", "size", u32(base.data, content.central_field("size")) + 1
            ),
        },
        {
            "name": "local-method-deflate-declared",
            "mutation": "`content.md` is stored, and its local header declares method 8 (raw deflate). The directory record still declares method 0, and the bytes are untouched.",
            "question": "A reader that trusted the local header would try to inflate bytes that are not deflated. Which check refuses the two copies disagreeing about the method — and does the reader have to agree with itself about the method before it reads anything, the way it does about flags?",
            "spec": "3.6",
            "bytes": local_field(base, "content.md", "method", 8),
        },
        {
            "name": "local-crc-zeroed",
            "mutation": "`content.md`'s local header declares CRC-32 0. The directory record still declares the real checksum.",
            "question": "Zero is a valid CRC-32 and the wrong one. Is that the checksum check's complaint, the size check's, or the rule that the two copies of a claim agree?",
            "spec": "3.6",
            "bytes": local_field(base, "content.md", "crc32", 0),
        },
        {
            "name": "local-flag-allowed-bit-set",
            "mutation": "`content.md`'s local header sets general purpose bit 0x0002 as well as the UTF-8 name bit. The directory record keeps the flag word it had.",
            "question": "0x0002 is one of the three bits the format allows, so nothing about *what the bit says* is wrong; what is wrong is that the two headers disagree about it. Section 3.6 says the reader refuses on a flag disagreement rather than reporting it — is this archive broken, or unproven, or is every bit it sets acceptable?",
            "spec": "3.6",
            "bytes": local_field(base, "content.md", "flags", flags | 0x0002),
        },
        {
            "name": "local-flag-unsupported-bit-set",
            "mutation": "`content.md`'s local header sets general purpose bit 0x0001 (encryption) as well as the UTF-8 name bit. The directory record keeps the flag word it had.",
            "question": "Two readings of this file are possible: the reader refuses because the two flag words disagree, or it reads a flag word that describes encryption and reports a feature it does not implement. Which of the two is the reading the format requires, and which check carries the answer?",
            "spec": "3.6",
            "bytes": local_field(base, "content.md", "flags", flags | 0x0001),
        },
        {
            "name": "central-offset-to-other-header",
            "mutation": "`content.md`'s directory record points at `manifest.json`'s local header: the offset is 0, where a well-formed local header lives under another name.",
            "question": "Section 3.1 requires the local header's name to be byte-for-byte the directory's name. Two claims about one thing disagree — is that MALFORMED, the bytes not being what the format requires, or MISMATCH, a value not being the value it must be?",
            "spec": "3.1",
            "bytes": central_field(base, "content.md", "header_offset", manifest.local_at),
        },
        {
            "name": "central-offset-to-data",
            "mutation": "`content.md`'s directory record points at the first data byte of `manifest.json`, where there is no local header at all.",
            "question": "The offset names no header: there is no signature there and no name to compare. One FAIL and 29 checks that were never reached, with which reason code?",
            "spec": "3.1",
            "bytes": central_field(base, "content.md", "header_offset", manifest.data_at),
        },
        {
            "name": "central-offset-past-eof",
            "mutation": "`content.md`'s directory record points 64 bytes past the end of the file.",
            "question": "An offset that is inside the file's address space and outside its bytes. Which reason code does a reader that will not guess report?",
            "spec": "3.1",
            "bytes": central_field(
                base, "content.md", "header_offset", len(base.data) + 64
            ),
        },
        {
            "name": "local-extra-entry-uncounted",
            "mutation": "A local header and its data are inserted between the last entry and the directory, and the end record's directory offset is moved past them. No record in the directory names them.",
            "question": "This is the archive section 3.4 exists to refuse: a second document nobody's table mentions. Section 3.4 states why it matters and does not say whether a gap is EXTRA bytes or a MISMATCH; the answer is one of the two, and both readers have to give the same one.",
            "spec": "3.4",
            "bytes": uncounted_entry(base, b"notes.txt", payload),
        },
        {
            "name": "eocd-count-off-by-one",
            "mutation": "The end record declares four entries in total; three are in the directory and the third is followed by the end record itself.",
            "question": "Section 3.1 says the end record describes a directory that declares exactly as many entries as it contains. What does a reader do when the count and the bytes disagree?",
            "spec": "3.1",
            "bytes": end_record(base, "total", base.entries_total + 1),
        },
        {
            "name": "eocd-cd-offset-wrong",
            "mutation": "The end record declares the central directory four bytes further along than it is, so the first record the reader takes starts inside the real one.",
            "question": "The declared directory starts where no record starts. Is this the legibility gate's refusal or the layout check's failure, and does the same reason code come back from both implementations?",
            "spec": "3.1",
            "bytes": end_record(base, "cd_offset", base.cd_offset + 4),
        },
        {
            "name": "eocd-cd-size-wrong",
            "mutation": "The end record declares the central directory two bytes shorter than the records in it use. Every record, every offset and every count is otherwise exactly what it was.",
            "question": "The start and the end of the records themselves are fine; one number that describes their extent is not. A reader that reads the records and never the number sees a perfect file. Which check owns the declared extent of the directory, and is it a failure or a pass?",
            "spec": "3.4",
            "bytes": end_record(base, "cd_size", base.cd_size - 2),
        },
        {
            "name": "eocd-bytes-appended",
            "mutation": "Sixteen bytes of text follow the end record, and the end record's comment length stays zero, so nothing in the file claims them.",
            "question": "Section 3.4 says nothing sits after the end record and there is no archive comment. Bytes after the archive are the case that rule names; which reason code do both readers give them?",
            "spec": "3.4",
            "bytes": appended(base, b"0123456789abcdef"),
        },
        {
            "name": "eocd-zip64-marker",
            "mutation": "The end record's two entry counts are 0xFFFF, the value ZIP64 uses to say that the real counts are in a ZIP64 record this file does not carry.",
            "question": "Section 3.2 says this format implements no ZIP64 and reports it as UNSUPPORTED. Which check reports it when the marker is in the end record, and is the artifact broken or unproven?",
            "spec": "3.2",
            "bytes": zip64_marker(base),
        },
        {
            "name": "eocd-multi-disk",
            "mutation": "The end record declares that this archive is disk 1 of a set. Everything else in the file is the valid artifact.",
            "question": "Section 3.2 says the format is one disk and reports a multi-disk archive as UNSUPPORTED. The offsets in this file are usable by a single-disk reader, so a reader *can* walk it: does it walk it and report the disk facts from `L0.ZIP.VERSION`, or refuse at the gate?",
            "spec": "3.2",
            "bytes": end_record(base, "disks", 1),
        },
        {
            "name": "entry-version-needed-zip64",
            "mutation": "`content.md` declares in both copies of its header that it needs ZIP feature level 4.5 (version needed 45), which is the level ZIP64 was introduced at.",
            "question": "The archive is legible and the entry is readable, so this is `L0.ZIP.VERSION`'s row. Is a feature level the verifier does not implement UNSUPPORTED_VERSION or UNSUPPORTED_FEATURE, and does the answer have to be the same for both implementations?",
            "spec": "3.2",
            "bytes": central_field(base, "content.md", "version_needed", 45, both=True),
        },
        {
            "name": "central-compressed-size-past-eof",
            "mutation": "`content.md`'s directory record declares 100,000 bytes of compressed data, far more than the file holds after it.",
            "question": "The declared size is larger than the bytes remaining, and smaller than the format's ceiling for one entry, so both rules about it are in play. Which one decides, and does the local header's copy of the size matter here?",
            "spec": "3.1",
            "bytes": central_field(base, "content.md", "compressed_size", 100000),
        },
        {
            "name": "central-compressed-size-above-ceiling",
            "mutation": "Both copies of `content.md`'s header declare 0xFFFFFFFF compressed bytes: the value a ZIP64 writer would leave behind, and a number far above the ceiling section 3.7 sets for one entry.",
            "question": "Two rules could answer this and only one of them can be reported: the bytes the size names are not in the file, and the size is above the declared ceiling. Section 3.7 says a limit is checked before the work it bounds — but this file cannot be walked far enough to do that work. Which failure arrives, and is it LIMIT_EXCEEDED?",
            "spec": "3.1",
            "bytes": central_field(base, "content.md", "compressed_size", 0xFFFFFFFF, both=True),
        },
        {
            "name": "entry-uncompressed-size-above-ceiling",
            "mutation": "Both copies of `content.md`'s header declare 0xFFFFFFFF uncompressed bytes. The compressed size, the CRC-32 and the bytes themselves are untouched.",
            "question": "This one *can* be walked: the declared uncompressed size is a claim about bytes the file does not hold that many of, and it is above the ceiling. Section 3.7 says an entry's declared size is compared before it is inflated, so which check reports it, and which checks are left unproven behind it?",
            "spec": "3.7",
            "bytes": central_field(base, "content.md", "size", 0xFFFFFFFF, both=True),
        },
        {
            "name": "entry-extra-len-off-by-one",
            "mutation": "`provenance.jsonl`'s local header carries a four-byte extra field between its name and its data and declares `extra_len` 5, so the header says the entry's data begins one byte after where the file puts it. Every offset the insertion moved — the directory's own, in the end record — moved with it, so nothing else in the file is wrong.",
            "question": "The extra field is one byte shorter than the header declares it, so a reader that trusts the declared length reads one byte of the entry's data as part of the extra field and puts the entry's end one byte past where the file puts it. Is that end one byte inside the central directory, which makes the entry and the directory two claims about one byte, or is it a gap the format does not account for?",
            "spec": "3.4",
            "bytes": local_extra_field(base, "provenance.jsonl", b"UT\x00\x00", 5),
        },
        {
            "name": "entry-name-length-copies-differ",
            "mutation": "`content.md`'s local header declares `name_len` 11, where the name beside it is 10 bytes and the directory's record states 10, so the file states one name twice and states its length differently each time.",
            "question": "The name is stated twice with two lengths, and that length is also where a reader looks for the entry's data: the name comparison fails at the end of the name, and the size comparison would fail one byte later, at the end of the entry. Which of the two does the artifact reach, and does a reader that learns the first of them ever learn the second?",
            "spec": "3.1",
            "bytes": local_name_length(base, "content.md", 11),
        },
        {
            "name": "entry-byte-deleted-mid-directory",
            "mutation": "One byte is removed from the middle of the central directory — the first byte of the middle record's name — so every later record is one byte earlier while the count, every record's offset, and the size the directory declares for itself are exactly what they were.",
            "question": "Every number the file states about its directory still says what it said, and the bytes no longer hold three records. Does a reader that compares each record's name as it reads it report the name it was given, or report that the directory is not the shape the file declares?",
            "spec": "3.1",
            "bytes": byte_removed(base, content.central_at + CENTRAL_BYTES),
        },
        {
            "name": "entry-name-not-utf8",
            "mutation": "The first byte of `content.md`'s name, in the local header and in the directory record, is set to `0xFF`: a byte that cannot stand alone in UTF-8, so both copies still agree and the name is no longer a string.",
            "question": "The two copies agree, so no claim about this entry stands in two places with one of them false. Is a name whose bytes are not UTF-8 a name this reader has — one that is simply not one of the three — or is it a name the reader cannot read at all, which is a question about the archive rather than about the entry set?",
            "spec": "3.1",
            "bytes": name_byte(base, "content.md", 0, 0xFF),
        },
        {
            "name": "entry-version-needed-local-only",
            "mutation": "`content.md`'s local header declares feature level 0xFFFF, the ZIP64 marker, where the directory's record for the same entry states 20 (2.0), and the entry's bytes are stored exactly as they were.",
            "question": "One copy of the claim says the entry needs ZIP64 and the other says it needs nothing above 2.0. Is the answer a version this verifier does not implement, or is the value one nobody can establish — and which copy does the check read in the first place?",
            "spec": "3.2",
            "bytes": local_field(base, "content.md", "version_needed", 0xFFFF),
        },
        {
            "name": "central-extra-len-past-eof",
            "mutation": "The directory's record for `provenance.jsonl` declares 0xFFFF bytes of extra field, so the record's declared extent reaches far past the end of the file while the count, every offset, and the size the directory declares for itself are untouched.",
            "question": "Every field of the record is readable where the file puts it, and the bytes it says follow them are not in the file. Is that a record that runs past the file, which the gate refuses and nothing else can then say anything about, or a directory whose records use more bytes than the directory declares for itself?",
            "spec": "3.4",
            "bytes": central_field(base, "provenance.jsonl", "extra_len", 0xFFFF),
        },
        {
            "name": "unsupported-method-beside-a-wrong-size",
            "mutation": "Two entries are changed, and the case needs both: `content.md` declares 100 uncompressed bytes in both copies of its header where the entry holds 158, and `provenance.jsonl` declares compression method 12 in both copies, which charter/0.1 does not implement. One entry cannot be measured at all, and the other is measurable and wrong.",
            "question": "The file is wrong in two places that the same two checks would have to report. Does a check whose requirement is about every entry report the defect it measured, or does the unmeasurable entry leave it with no answer — and which of those is an absence of evidence?",
            "spec": None,
            "bytes": rewritten(
                base,
                [("content.md", "size", 100), ("provenance.jsonl", "method", 12)],
            ),
        },
        {
            "name": "local-extra-field-unread",
            "mutation": "`provenance.jsonl`'s local header carries a four-byte extra field between its name and its data and declares `extra_len` 4, which is the truth: the field is well formed, and every offset the insertion moved — the directory's own, in the end record — is moved with it.",
            "question": "A charter may carry an extra field, and no check reads what is in it: §3.4 puts an extra field in the list of things every byte of the file is accounted for by, and §3.6's rule says a byte the reader never looks at is a byte a forged file can change for free. Is this file a charter, and which of those two sentences does the artifact answer?",
            "spec": "3.6",
            "bytes": local_extra_field(base, "provenance.jsonl", b"UT\x00\x00", 4),
        },
    ]
    return [dict(case, **SETTLED[case["name"]]) for case in listed]



SETTLED = {
    "entry-name-uppercase": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.ENTRY_SET": "MISSING"}},
        "note": "Both implementations agreed the first time. What the case separates is section 3.1's refusal from section 3.4's check: each local header still matches the name in the record that points at it, so the gate is happy, and `L0.ZIP.ENTRY_SET` is the check that reports the set of names — MISSING, its own requirement, which it reports before the extra name the archive also holds.",
    },
    "entry-order-reordered": {
        "asked": {"verdict": "VERIFIED"},
        "note": "Both agreed, and the agreement is the answer: the format fixes the order of the *kinds* of thing (header, data, directory, end record) and not the order of the entries, so a file whose entries are written in another order and described correctly by its own directory is a charter like any other. Section 3.4 now says so, because a reader could be forgiven for reading \"in that order\" as being about the entries.",
    },
    "entry-central-order-swapped": {
        "asked": {"verdict": "VERIFIED"},
        "note": "One of the first run's eleven disagreements: the reference came back BROKEN with `L0.ZIP.LAYOUT`=EXTRA and the port VERIFIED. ZIP fixes no order for the records in the directory, and a writer that sorts them by name produces exactly this file, so the reference was over-strict — its layout walk took the directory's order for the file's and read the first record's offset as a gap. Section 3.4 now states that the rule is about byte ranges, and `verifier/zip.js`'s `evaluateLayout` walks them in file order. No kit artifact moves: no case in the kit lists its records in another order than its entries.",
    },
    "entry-fourth-unknown": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.ENTRY_SET": "EXTRA"}},
        "note": "Both agreed: EXTRA, `L0.ZIP.ENTRY_SET`'s word for a name the format does not define. The kit's `extra-entry` asks the same question about `notes.txt`; this case asks it about a name that looks like a path, which the format has no concept of either.",
    },
    "entry-central-record-twice": {
        "asked": {
            "verdict": "BROKEN",
            "fail": {"L0.ZIP.ENTRY_SET": "DUPLICATE", "L0.ZIP.LAYOUT": "MISMATCH"},
        },
        "note": "Disagreed on the reason code: the reference reported `L0.ZIP.LAYOUT`=MISMATCH and the port EXTRA. Both saw the same thing — a second record naming the same local header, so two ranges claim the same bytes — and section 3.4 defined only EXTRA, \"bytes appear where the format does not put them\". Section 3.4 now distinguishes the two: a range that begins after the previous one ends is a gap and EXTRA, and a range that begins *inside* one already claimed is two claims about the same bytes and MISMATCH. The port's `check_layout` reports both.",
    },
    "flag-word-above-the-format": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.FLAGS": "EXTRA"}},
        "note": "Added in the same pass as the two flag cases below, and both implementations answered it the same way: a bit the format defines no meaning for is not a feature the reader declines (UNSUPPORTED) but a bit the format has no room for, which is EXTRA. It is the FAIL half of `L0.ZIP.FLAGS`, which the kit does not ask — `encrypted-flag` sets a bit the reader *does* know and reports UNSUPPORTED_FEATURE.",
    },
    "local-compressed-size-off-by-one": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.METADATA": "MISMATCH"}},
        "note": "Both agreed: MISMATCH from `L0.ZIP.METADATA`, the check that owns the agreement between the two copies of a claim. The compressed size is the field with no check of its own — section 3.5 makes the *uncompressed* size and the CRC-32 claims about the bytes — so this is the case where the agreement rule is the only thing between a reader and an entry whose data ends where its own local header says rather than where the directory says.",
    },
    "local-uncompressed-size-off-by-one": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.METADATA": "MISMATCH"}},
        "note": "Disagreed: both reported `L0.ZIP.METADATA`=MISMATCH and the port *also* reported `L0.ZIP.SIZES`=MISMATCH, because it measured the local header's copy of the size as well as the directory's. One edited header was reported twice, and by a check whose requirement — \"the declared size is the real one\" — is satisfied by the copy the file's own directory states. Section 3.5 now says that both `L0.ZIP.SIZES` and `L0.ZIP.CRC32` read the directory's copy and that the agreement between the copies is `L0.ZIP.METADATA`'s, and the port does.",
    },
    "local-method-deflate-declared": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.METADATA": "MISMATCH"}},
        "note": "Both agreed: MISMATCH from `L0.ZIP.METADATA`. Worth recording that the reader does *not* refuse this one, though a reader that trusted the local header would try to inflate stored bytes: the method is a claim the file makes twice, and two copies disagreeing is that check's sentence. The case is also the answer to \"why is the method not refused with the flags?\" — a reader that guesses wrong about a method fails to decode one entry, while a reader that guesses wrong about a flag word cannot know what it is reading at all.",
    },
    "local-crc-zeroed": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.METADATA": "MISMATCH"}},
        "note": "Disagreed in the same way as `local-uncompressed-size-off-by-one`: the reference reported `L0.ZIP.METADATA`=MISMATCH and the port reported that and `L0.ZIP.CRC32`=MISMATCH as well, because it read the local copy of the checksum too. Section 3.5's new paragraph settled it — both checks read the directory's copy — and the port's `check_crc32` now does.",
    },
    "local-flag-allowed-bit-set": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MISMATCH"}},
        "note": "The case that found the largest hole of the pass: the port came back VERIFIED. Every bit the file sets is one the format allows, so `L0.ZIP.FLAGS` had nothing to refuse, and the port never compared the two flag words — so an archive whose headers disagreed about a bit nobody minds was called a valid charter. Section 3.6 has said since the first pass that the reader \"has to agree with itself about flags before it can decode anything, and refuses there instead\", and the reference does; section 3.3 now puts that sentence where the flag word is described, and the port's walk refuses a disagreement with MISMATCH at `L0.ZIP.READABLE`.",
    },
    "local-flag-unsupported-bit-set": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MISMATCH"}},
        "note": "Disagreed too: the reference refused the disagreement (MISMATCH at the gate, 29 checks never reached) and the port read the local flag word, found encryption there, and reported `L0.ZIP.FLAGS`=UNSUPPORTED_FEATURE with nothing skipped. Both are recognisable readings, and sections 3.3 and 3.6 settle the order: a reader that has not agreed with itself about flags cannot say what it is reading, so the disagreement is the answer and what the bit says is nobody's question yet. The pair of flag cases is the two halves of that order.",
    },
    "central-offset-to-other-header": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MISMATCH"}},
        "note": "Both refused the file and disagreed about the word for it: the reference said `L0.ZIP.READABLE`=MISMATCH and the port MALFORMED. Section 3.1 named neither, so both were defensible; 3.1 now says MALFORMED is for bytes that are not the shape the format requires and MISMATCH is for a value the file states twice and states differently — a name in a record and a name in the header it points at are exactly that — and the port's `_local_header` uses MISMATCH.",
    },
    "central-offset-to-data": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Both agreed: MALFORMED. This is the boundary the case above draws, seen from the other side — the offset names no header at all, so there is no second claim to disagree with, and the bytes are simply not the shape the format requires.",
    },
    "central-offset-past-eof": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Both agreed: MALFORMED. There is nothing at that offset to compare a name or a flag word with, so the refusal is not about a disagreement.",
    },
    "local-extra-entry-uncounted": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.LAYOUT": "EXTRA"}},
        "note": "Both agreed: EXTRA. This is the archive section 3.4 exists for — a document no table in the file names, sitting between the last entry and the directory — and it is the case the reason code was written for: bytes the format does not account for.",
    },
    "eocd-count-off-by-one": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Both agreed: MALFORMED, section 3.1's sentence about declaring exactly as many entries as the directory contains. The two implementations arrive there by different roads — the reference compares the record's two counts with each other, the port reads the fourth record it was promised and finds the end record's signature where a directory record should be — and the reason code is what makes those the same answer.",
    },
    "eocd-cd-offset-wrong": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Both agreed: MALFORMED. The directory's offset is a claim in the file, and the first record it names does not begin where the file says it does.",
    },
    "eocd-cd-size-wrong": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.LAYOUT": "MISMATCH"}},
        "note": "Disagreed, and this is the case that closed the hole section 3.6's own rule names: the port came back VERIFIED. It read the directory's declared size and never compared it with the records inside it, so a byte nobody looks at could be changed for free — the exact thing the last paragraph of 3.6 is about. The reference has always reported `L0.ZIP.LAYOUT`=MISMATCH for it; section 3.4 now states the comparison among the three facts the layout rule reads, and the port's `check_layout` makes it.",
    },
    "eocd-bytes-appended": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.LAYOUT": "EXTRA"}},
        "note": "Both agreed: EXTRA. Both implementations find the end record by scanning backwards rather than trusting the file's length, which is why these bytes are reported as bytes after the archive rather than read as an archive comment.",
    },
    "eocd-zip64-marker": {
        "asked": {
            "verdict": "INCOMPLETE",
            "unsupported": {"L0.ZIP.READABLE": "UNSUPPORTED_VERSION"},
        },
        "note": "Disagreed, and on more than a word: the reference came back INCOMPLETE with `L0.ZIP.READABLE`=UNSUPPORTED_VERSION and the port came back BROKEN, its gate having reported MALFORMED. Section 3.2 said \"reports UNSUPPORTED for ZIP64\" without saying which check, and section 10.2 gave `L0.ZIP.VERSION` \"the end record's two version facts\" — a reading the port followed and the reference never did. The settled reading is the reference's, for section 10.1's reason: the fact VERSION needs is the walk, and a directory this reader will not interpret is a fact nobody established. Sections 3.2 and 10.2 now say so, and the port's walk detects the markers.",
    },
    "eocd-multi-disk": {
        "asked": {
            "verdict": "INCOMPLETE",
            "unsupported": {"L0.ZIP.READABLE": "UNSUPPORTED_FEATURE"},
        },
        "note": "Disagreed about which check answers. The offsets in this file are usable, so the port walked it — nothing skipped — and reported `L0.ZIP.VERSION`=UNSUPPORTED_FEATURE; the reference refused at the gate with the same code and left 29 checks unrun. Section 3.2 now settles it the reference's way: a file that says it is one disk of a set is a file whose offsets may belong to another disk, so there is nothing here to walk, and VERSION keeps the feature level an *entry* declares.",
    },
    "entry-version-needed-zip64": {
        "asked": {
            "verdict": "INCOMPLETE",
            "unsupported": {"L0.ZIP.VERSION": "UNSUPPORTED_VERSION"},
        },
        "note": "Disagreed on the reason code once the two cases above were settled: both implementations report `L0.ZIP.VERSION` and the reference says UNSUPPORTED_VERSION where the port said UNSUPPORTED_FEATURE. A feature level above 2.0 is a *version* this verifier does not implement, the same code 3.2 gives the ZIP64 marker in an end record; 3.2 now says the two are one voice, and the port's `check_version` uses it. The same edit removed the port's reading of a bare `0xFFFFFFFF` size field as ZIP64 — that is a ceiling, and section 3.7 gives it to the check that would read the bytes.",
    },
    "central-compressed-size-past-eof": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Both agreed: MALFORMED. The size is inside the format's ceiling for one entry, so the only rule it breaks is 3.1's — the bytes it names are not in the file.",
    },
    "central-compressed-size-above-ceiling": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Added in the same pass as the case below, and both implementations answer it the same way now that the port has stopped comparing an entry's ceiling inside its walk. It is the order of two rules: the bytes a size names are not in the file (3.1, the gate), and a size above a ceiling is refused before the work it bounds (3.7, the check that would do that work). The walk cannot reach the second question here, so the first is the answer — and 3.7 now says that LIMIT_EXCEEDED is for a size this verifier refuses to work on, not for a size the file cannot honour.",
    },
    "entry-uncompressed-size-above-ceiling": {
        "asked": {
            "verdict": "BROKEN",
            "fail": {"L0.ZIP.ENTRY_DATA": "LIMIT_EXCEEDED"},
        },
        "note": "Added with the case above, because this one *can* be walked and so reaches the ceiling: `L0.ZIP.ENTRY_DATA` reports LIMIT_EXCEEDED and the two checks that would measure the bytes are SKIP behind it, which is section 10.1 applied to a refusal. Section 3.7 said the ceiling is compared before the work it bounds and did not say which check carries the answer; it does now, and both implementations agree.",
    },
    "entry-extra-len-off-by-one": {
        "asked": {
            "verdict": "BROKEN",
            "fail": {"L0.ZIP.LAYOUT": "MISMATCH", "L0.ZIP.METADATA": "EXTRA"},
        },
        "note": "Both implementations agreed, and section 3.4 did not say which of its two sentences this is — which is what the case was built to find. Both reported `L0.ZIP.LAYOUT`=EXTRA, the code 3.4 gives a *gap*, because both compare the directory's declared offset with where the ranges end in one comparison with one code and no direction; `verifier/zip.js` even measured that difference with `Math.abs`, which is how a reader can tell the author knew it could be negative. The bytes here are not a gap: the last entry's declared data runs one byte into the directory, so the entry and the directory are two claims about one byte, which is 3.4's overlap and MISMATCH. Section 3.4 now states both directions — EXTRA when the ranges end before the directory, because the bytes between them and it are accounted for by nothing, and MISMATCH when a range ends after it — and `evaluateLayout` and the port's `check_layout` each report the direction they are in. The artifact has a second defect, and settling the case below is what named it: the header declares an extra field of its own, so `L0.ZIP.METADATA` also reports EXTRA (section 3.6), which is why the recorded answer carries two failing checks rather than one. The range failure is still the one this case is about, and it is still the one both implementations moved on.",
    },
    "entry-name-length-copies-differ": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MISMATCH"}},
        "note": "Both agreed the first time, and the agreement is the answer to the half of the question that a second artifact cannot ask: the artifact stops at the name. Section 3.1 already said the local header's name has to be the directory's name byte for byte, and that two claims about one fact which differ are MISMATCH, so what this case adds is the order — the data offset the declared length moves is never reached, because a reader that has not agreed with itself about the name does not know which bytes are the sizes. That is the same order 3.1 now fixes for the directory as a whole, one record down. Both directions were built by hand, 11 and 9 against the 10 the name has, and both land on MISMATCH at the gate with 29 checks never run.",
    },
    "entry-byte-deleted-mid-directory": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "MALFORMED"}},
        "note": "Disagreed, and it is the case this pass was told to expect: the reference came back MALFORMED and the port MISMATCH. The reference reads every record in the directory before it compares any record's name with the local header that record points at; the port compared each name as it walked, so it reported the name it read at an offset its own walk had already broken — a record whose position the file no longer states — and never said the plainer thing, which is that the directory does not hold the three records it declares. Section 3.1 now fixes the order, which is the order its own paragraph states, and the port's `walk` reads the whole directory in one pass and resolves local headers in a second. The other deletion points were built by hand too: a byte removed from the last record's name is MISMATCH in both implementations, because the walk finishes and the name it compares is one the file states.",
    },
    "entry-name-not-utf8": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.READABLE": "DECODE_ERROR"}},
        "note": "Found by hand while building the three cases above, and it was not a difference of wording: the reference refused at the gate with `L0.ZIP.READABLE`=DECODE_ERROR and 29 checks never run, and the port decoded the name with replacement characters, carried on, and reported `L0.ZIP.ENTRY_SET`=MISSING with 2 checks never run. No case in the kit or in the probe asks this, and section 3.1 did not answer it: it said the two copies of a name are compared byte for byte and said nothing about whether a name has to be a string at all. 3.1 now does, in the order the walk needs it — an entry's name is a UTF-8 string, DECODE_ERROR is the code when it is not, and the reason is that the entry set is a claim about names, so a reader that cannot read a name cannot say which entry it read — and the port decodes each record's name as it walks. The same sentence settles the variant where only the directory's copy is unreadable: the reference answers DECODE_ERROR before it compares the two copies, and so does the port now.",
    },
    "entry-version-needed-local-only": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.METADATA": "MISMATCH"}},
        "note": "Disagreed, and it is the same question one field over from the size and CRC-32 cases of the first pass: which copy of a repeated claim a check reads. The reference reported `L0.ZIP.METADATA`=MISMATCH and left `L0.ZIP.VERSION` passing, because it reads the directory's copy of the feature level; the port read `max(central, local)` and reported `L0.ZIP.VERSION`=UNSUPPORTED_VERSION as well, so one entry's local header could add a declaration of an unimplemented feature to a verdict that was already `BROKEN` for a different reason. Section 3.2 now says which copy — the directory's, which is the copy section 3.5 makes authoritative for every claim the file states twice, so two copies that disagree are METADATA's and a reader that took the higher of the two would report a level the entry may not need — and the port's `check_version` reads `entry.version_needed`. The direction is the part worth keeping: the two copies are not two opinions, they are one claim written twice, and a reader that picks the larger of them has invented a requirement.",
    },
    "central-extra-len-past-eof": {
        "asked": {
            "verdict": "BROKEN",
            "fail": {"L0.ZIP.LAYOUT": "MISMATCH", "L0.ZIP.METADATA": "EXTRA"},
        },
        "note": "The other family the sweep behind the fuzzer decision found, and the first case in this corpus where the reference had the better answer and the port refused too early. The reference walked all three records and reported `L0.ZIP.LAYOUT`=MISMATCH, because the size the directory declares for itself is what its records' extents have to add up to; the port refused at the gate with `L0.ZIP.READABLE`=MALFORMED for the record's declared extent, which is a complaint section 3.1 does not give the gate — the gate reads names, and the name here is exactly where the file says it is. Section 3.4 now says what \"the size its records use\" is (the fixed part, the name, and the extra field and the comment each record declares) and that a record whose extent reaches past the file is this check's number rather than the gate's, and the port's `walk` checks the name's end and no more. The port's answer also cost a verdict shape rather than only a word: MALFORMED with 29 checks never run against MISMATCH with none, which is the difference between an archive nobody read and one that was read and does not add up. The comment-length variant, and the same mutation on the middle record — where both implementations refuse with MALFORMED, because the next record is not where the file says it is — were built by hand as well. The declared field is a defect of its own since section 3.6 fixed it at zero bytes, so the recorded answer also carries `L0.ZIP.METADATA`=EXTRA, which is the case below's rule and not a second reading of this one's.",
    },
    "unsupported-method-beside-a-wrong-size": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.SIZES": "MISMATCH"}},
        "note": "The only case in this corpus whose answer is not section 3's, which is why its `spec` is null rather than a container section, and the third family the sweep behind the fuzzer decision found. Its question is about check statuses and section 10.1 answers it. The reference measured the entry it could read, found its declared size wrong, and reported `L0.ZIP.SIZES`=MISMATCH with 13 checks never reached; the port saw that one entry's bytes could not be read, gave up on the check, and reported `SKIP` — 14 skips against the reference's 13, and no word about the size that was wrong. That is not an absence of evidence, it is a *refusal* to report evidence the port had: the check ran, and it measured the entry that could be measured. Section 10.1 now says the rule one entry down from its own \"the gate is the fact, not the status\" — a fact that names one entry gates that entry and not the check that reads it, so SKIP means every answer was \"not measurable\" — and the port's `check_sizes` and `check_crc32` remember the first unreadable entry, keep measuring, report a defect they find, and re-raise the block only when they found none. The two-copy lie in this artifact is deliberate: both copies of both changed fields say the same thing, so `L0.ZIP.METADATA` passes and the case isolates the status question. Neither change alone disagrees between the implementations — the kit's `unsupported-method` is the one half and `wrong-declared-size` the other — which is what made the case unreachable by hand until the sweep.",
    },
    "local-extra-field-unread": {
        "asked": {"verdict": "BROKEN", "fail": {"L0.ZIP.METADATA": "EXTRA"}},
        "note": "The corpus's first recorded hole rather than a difference, and the case that settled it. Both implementations agreed when it was built, and the agreement was the finding: the file *verified*, because section 3.4 accounted for the extra field's bytes and no check read them, so four bytes a writer could fill with anything sat in a charter/0.1 artifact whose verdict never changed. Section 3.6's last paragraph was the sentence that argued with that, and the answer went where that sentence lives: 3.6's table now fixes the extra field — and a directory record's comment — at zero bytes, so a header that declares one is a defect, and `L0.ZIP.METADATA` is the check that reads the length, with reason EXTRA. EXTRA rather than MISMATCH because MISMATCH is a value that is not the one the format fixes *in a field the format has*, and EXTRA is the word section 3.3 already uses for a general purpose bit charter/0.1 has no room for; rather than UNSUPPORTED because an extra field needs nothing implemented, so that code would be a claim about the reader instead of about the file. Section 14 is the other half: an artifact that declares charter/0.1 and holds a shape charter/0.1 gives no rule to has no version to report — UNSUPPORTED_VERSION and UNSUPPORTED_FEATURE are not claims about the format — so the answer is the check that owns the shape and the code for a place the format puts nothing. Both implementations moved on this case and neither was wrong before it: the rule was what was missing. The field's identifier here is the extended-timestamp one, which is the joke: the fact section 3.6 removes is the fact this field carries.",
    },
}


def digest(data: bytes) -> str:
    """The lowercase hex SHA-256 of some bytes, as the record states it."""
    return hashlib.sha256(data).hexdigest()


def ask_reference(path: pathlib.Path) -> dict:
    """The reference command line's answer, taken as a black box."""
    try:
        completed = subprocess.run(
            [*REFERENCE, str(path), "--json"],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError:
        raise SystemExit(
            "node was not found on PATH: --build records the reference command line's "
            "answers, so it needs one"
        ) from None
    if completed.returncode not in (0, 1, 2):
        raise SystemExit(
            f"the reference exited {completed.returncode} on {path.name}: "
            f"{completed.stderr.strip()[:400]}"
        )
    return json.loads(completed.stdout)


def contradictions(case: dict, expected: dict) -> list:
    """The ways the reference's answer is not the answer this case asks for."""
    asked = case.get("asked")
    if asked is None:
        return []
    problems = []
    if asked["verdict"] != expected["verdict"]:
        problems.append(
            f"{case['name']}: this case asks for {asked['verdict']}, and the reference "
            f"says {expected['verdict']}"
        )
    for group in ("fail", "unsupported"):
        for check_id, code in asked.get(group, {}).items():
            seen = expected[group].get(check_id)
            if seen != code:
                problems.append(
                    f"{case['name']}: this case asks for {check_id}={code}, and the "
                    f"reference reports {check_id}="
                    f"{seen if seen is not None else 'nothing'}"
                )
    return problems


def build(quiet: bool) -> int:
    """Write the artifacts and the record, or refuse and write nothing."""
    base_bytes = BASE_PATH.read_bytes()
    corpus = cases()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    entries = []
    problems = []
    findings = []
    for case in corpus:
        path = OUT_DIR / f"{case['name']}.charter"
        path.write_bytes(case["bytes"])
        expected = reference_tally(ask_reference(path))
        port = port_tally(case["bytes"])
        lines = differences(expected, port)
        problems.extend(contradictions(case, expected))
        if lines:
            findings.append((case["name"], lines))
        entries.append(
            {
                "name": case["name"],
                "file": f"out/{case['name']}.charter",
                "bytes": len(case["bytes"]),
                "sha256": digest(case["bytes"]),
                "mutation": case["mutation"],
                "question": case["question"],
                "spec": case["spec"],
                "asked": case.get("asked"),
                "agreement": not lines,
                "expected": expected,
                "port": port,
                "note": case.get("note", ""),
            }
        )
        if not quiet:
            failed = ", ".join(
                f"{cid}={code}" for cid, code in sorted(expected["fail"].items())
            )
            print(
                f"{case['name']:<36} {expected['verdict']:<11} "
                f"fail={len(expected['fail'])} unsupported={len(expected['unsupported'])} "
                f"skip={expected['skips']:<2} {'agreed' if not lines else 'DISAGREE'}  {failed}"
            )

    record = {
        "corpus": "charter container corpus",
        "format": "charter/0.1",
        "built_by": "implementations/python/tools/corpus.py --build",
        "base": {
            "file": "../out/valid.charter",
            "bytes": len(base_bytes),
            "sha256": digest(base_bytes),
        },
        "note": CORPUS_NOTE,
        "cases": entries,
    }
    RECORD_PATH.write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )

    for name, lines in findings:
        print("")
        for line in lines:
            print(f"{name}: {line}")
    if problems:
        print("")
        for problem in problems:
            print(problem)
    if not quiet:
        print("")
        print(
            f"{len(entries)} case(s) recorded in {RECORD_PATH.relative_to(REPO)}: "
            f"{len(entries) - len(findings)} the two implementations agree about, "
            f"{len(findings)} they do not."
        )
    if problems:
        print(
            f"\n{len(problems)} case(s) whose recorded answer is not the answer the case "
            "asks for. The record was written, and this is a finding to settle in SPEC.md "
            "rather than a record to trust."
        )
        return 1
    if findings:
        print(
            f"\n{len(findings)} case(s) the two implementations do not agree about. The "
            "record was written with both answers: a disagreement is the finding this "
            "corpus exists to produce, and settling it means amending SPEC.md section 3 "
            "and then fixing whichever implementation was wrong."
        )
        return 1
    return 0



def check() -> int:
    """Rebuild every artifact in memory and refuse if the record is stale."""
    if not RECORD_PATH.exists():
        print(f"{RECORD_PATH.relative_to(REPO)} does not exist: run --build first")
        return 1
    record = json.loads(RECORD_PATH.read_text(encoding="utf-8"))
    base_bytes = BASE_PATH.read_bytes()
    problems = []
    if record["base"]["sha256"] != digest(base_bytes):
        problems.append(
            "the base artifact is not the one this corpus was built from: "
            f"{BASE_PATH.relative_to(REPO)} is {digest(base_bytes)} and the record says "
            f"{record['base']['sha256']}"
        )
    recorded = {entry["name"]: entry for entry in record["cases"]}
    for case in cases():
        entry = recorded.pop(case["name"], None)
        if entry is None:
            problems.append(f"{case['name']}: the record does not name this case")
            continue
        if entry["mutation"] != case["mutation"] or entry["question"] != case["question"]:
            problems.append(f"{case['name']}: the record carries a different question")
        if entry["spec"] != case["spec"]:
            problems.append(f"{case['name']}: the record names a different section")
        if entry["asked"] != case.get("asked"):
            problems.append(f"{case['name']}: the record asks a different question")
        if entry["bytes"] != len(case["bytes"]) or entry["sha256"] != digest(case["bytes"]):
            problems.append(
                f"{case['name']}: the record describes {entry['bytes']} byte(s) and "
                f"{entry['sha256']}, and the mutation builds {len(case['bytes'])} byte(s) "
                f"and {digest(case['bytes'])}"
            )
        path = OUT_DIR / f"{case['name']}.charter"
        try:
            on_disk = path.read_bytes()
        except FileNotFoundError:
            problems.append(f"{case['name']}: {path.name} is not on disk")
            continue
        if on_disk != case["bytes"]:
            problems.append(f"{case['name']}: the file on disk is not the one the mutation builds")
    for name in sorted(recorded):
        problems.append(f"{name}: the record names a case that no longer exists")

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s): the corpus's artifacts and its record are not the same thing")
        return 1
    print(
        f"{len(record['cases'])} case(s): every artifact matches its mutation, and every "
        "question matches the record"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="the container corpus: its mutations, and its consistency check"
    )
    parser.add_argument("--build", action="store_true", help="write the artifacts and the record")
    parser.add_argument("--check", action="store_true", help="fail if the artifacts on disk are not what the mutations build")
    parser.add_argument("--quiet", action="store_true", help="print nothing but problems")
    arguments = parser.parse_args()
    if arguments.build == arguments.check:
        parser.error("pass exactly one of --build and --check")
    return build(arguments.quiet) if arguments.build else check()


if __name__ == "__main__":
    raise SystemExit(main())

