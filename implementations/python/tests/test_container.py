"""The container: stored bytes, declared sizes, and every byte accounted for.

The kit's container cases are one line each here, because that is the whole
point of a record: `missing-entry` is `L0.ZIP.ENTRY_SET` carrying `MISSING`, and
a port that gets that wrong does not need to be told twice.
"""

from __future__ import annotations

import hashlib
import unittest
import zlib

from charter_verify import container, verify
from charter_verify.vocabulary import (
    DECODE_ERROR,
    EXTRA,
    MALFORMED,
    MISMATCH,
    MISSING,
    UNSUPPORTED_FEATURE,
    UNSUPPORTED_VERSION,
    VERIFIED,
)

from .support import (
    check,
    fails,
    fixture_bytes,
    fixture_parts,
    manifest_with_digest,
    artifact,
    skips,
    unsupported,
    CONTENT,
    PROVENANCE,
)


def u16(data: bytes, at: int) -> int:
    """A little-endian 16-bit field, as the ZIP format states it."""
    return int.from_bytes(data[at : at + 2], "little")


def u32(data: bytes, at: int) -> int:
    """A little-endian 32-bit field, as the ZIP format states it."""
    return int.from_bytes(data[at : at + 4], "little")


class EntriesTest(unittest.TestCase):
    def test_the_three_entries_are_stored_and_the_deflated_copy_verifies_identically(
        self,
    ) -> None:
        """A reader that assumed deflate fails on every fixture in the kit."""
        stored = container.walk(fixture_bytes("valid"))
        self.assertEqual([entry.method for entry in stored.entries], [0, 0, 0])
        deflated = container.walk(fixture_bytes("valid-deflate"))
        self.assertEqual([entry.method for entry in deflated.entries], [8, 8, 8])
        self.assertEqual(verify(fixture_bytes("valid")).verdict, VERIFIED)
        self.assertEqual(verify(fixture_bytes("valid-deflate")).verdict, VERIFIED)

    def test_an_entry_that_cannot_be_expanded_is_unsupported_never_a_pass(self) -> None:
        with self.assertRaises(Exception):
            # method 9 is not one this verifier implements
            container.decompress(container.walk(fixture_bytes("unsupported-method")).entries[0])
        self.assertEqual(
            fails(fixture_bytes("unsupported-method")), {"L0.ZIP.ENTRY_DATA": "UNSUPPORTED_FEATURE"}
        )
        self.assertEqual(verify(fixture_bytes("unsupported-method")).verdict, "INCOMPLETE")

    def test_an_entry_that_lies_about_its_method_is_a_decode_error(self) -> None:
        self.assertEqual(
            fails(fixture_bytes("stored-declared-deflated")),
            {"L0.ZIP.ENTRY_DATA": DECODE_ERROR},
        )

    def test_the_entry_set(self) -> None:
        for name, reason in (
            ("missing-manifest", "MISSING"),
            ("missing-entry", "MISSING"),
            ("missing-content", "MISSING"),
            ("duplicate-entry", "DUPLICATE"),
            ("extra-entry", "EXTRA"),
        ):
            with self.subTest(name):
                self.assertEqual(
                    check(fixture_bytes(name), "L0.ZIP.ENTRY_SET").reason_code, reason
                )

    def test_a_duplicate_name_reads_the_copy_the_file_states_first(self) -> None:
        """The kit's `duplicate-entry` case holds a second, empty `content.md`.

        Every other check passes on that artifact, which is only true of a reader
        that takes the first occurrence: take the second and the content hash
        fails as well. SPEC section 3 says a name identifies one entry and never
        says which bytes to read when a file breaks that rule.
        """
        walk = container.walk(fixture_bytes("duplicate-entry"))
        self.assertEqual(len(walk.named("content.md")), 2)
        self.assertEqual(walk.first("content.md").size, 158)
        self.assertEqual(fails(fixture_bytes("duplicate-entry")), {"L0.ZIP.ENTRY_SET": "DUPLICATE"})

    def test_sizes_and_crc_are_two_claims_not_one(self) -> None:
        self.assertEqual(
            fails(fixture_bytes("wrong-declared-size")), {"L0.ZIP.SIZES": "MISMATCH"}
        )
        self.assertEqual(
            fails(fixture_bytes("wrong-declared-crc")), {"L0.ZIP.CRC32": "MISMATCH"}
        )

    def test_the_crc32_of_the_fixture_is_the_one_the_headers_carry(self) -> None:
        walk = container.walk(fixture_bytes("valid"))
        for entry in walk.entries:
            data = container.decompress(entry)
            self.assertEqual(entry.crc32, zlib.crc32(data) & 0xFFFFFFFF)
            self.assertEqual(entry.size, len(data))
            self.assertEqual(entry.local["crc32"], entry.crc32)


class LayoutTest(unittest.TestCase):
    def test_the_truncation_neighbourhood(self) -> None:
        """Three points in it, each one FAIL and 29 checks never reached."""
        whole = fixture_bytes("valid")
        for cut, label in ((1, "truncated-last-byte"), (8, "truncated-eocd"), (40, "truncated-mid-header")):
            with self.subTest(label):
                data = whole[: len(whole) - cut]
                self.assertEqual(fails(data), {"L0.ZIP.READABLE": MALFORMED})
                self.assertEqual(skips(data), 29)
                self.assertEqual(verify(data).exit_code, 2)

    def test_a_text_file_is_not_a_container(self) -> None:
        self.assertEqual(fails(b"this is not a zip file, it only ends in .charter"), {"L0.ZIP.READABLE": MALFORMED})
        self.assertEqual(
            fails(fixture_bytes("not-a-zip")), {"L0.ZIP.READABLE": MALFORMED}
        )

    def test_an_archive_comment_is_bytes_where_the_format_puts_none(self) -> None:
        """No archive comment, and the rule behind it.

        A comment is bytes after the end record: a reader that stopped at the end
        record would never look at them, and a byte the reader never looks at is
        a byte a forged file can change for free.
        """
        parts = fixture_parts()
        walk = container.walk(artifact(parts))
        self.assertEqual(fails(artifact(parts)), {})
        # zipfile writes a comment after the end record's own fields.
        import io
        import zipfile

        buffer = io.BytesIO(artifact(parts))
        with zipfile.ZipFile(buffer, "a") as archive:
            archive.comment = b"written by something else"
        commented = buffer.getvalue()
        self.assertIn("L0.ZIP.LAYOUT", fails(commented))
        self.assertEqual(fails(commented)["L0.ZIP.LAYOUT"], EXTRA)
        self.assertEqual(len(walk.entries), 3)

    def test_a_local_header_that_disagrees_with_the_directory_is_a_mismatch(self) -> None:
        """The name in the local header is the name in the central directory.

        Both headers are well formed and they name the same bytes; what is wrong
        is that the two copies of one claim disagree, which is MISMATCH. This was
        MALFORMED until `vectors/container/` settled it: the corpus's
        `central-offset-to-other-header` case points a record at another entry's
        header, and the two implementations answered differently — see
        `implementations/python/README.md` and SPEC.md section 3.1.
        """
        data = bytearray(fixture_bytes("valid"))
        at = data.find(b"manifest.json", 30)
        data[at] = ord("M")
        self.assertEqual(fails(bytes(data)), {"L0.ZIP.READABLE": MISMATCH})

    def test_a_flag_word_the_two_headers_disagree_about_is_a_mismatch(self) -> None:
        """The reader has to agree with itself about flags before it reads anything.

        SPEC section 3.6 says so in as many words, and it is the corpus's
        `local-flag-allowed-bit-set` case: bit 0x0002 is one the format allows, so
        no check about *what the bit says* can refuse it — the disagreement is the
        whole defect, and it is a refusal rather than a reported failure.
        """
        data = bytearray(fixture_bytes("valid"))
        at = data.find(b"PK\x03\x04")
        self.assertEqual(u16(data, at + 6), 0x0800, "the fixture's flag word moved")
        data[at + 6 : at + 8] = (0x0802).to_bytes(2, "little")
        self.assertEqual(fails(bytes(data)), {"L0.ZIP.READABLE": MISMATCH})

    def test_a_zip64_end_record_and_a_second_disk_are_unproven_not_broken(self) -> None:
        """SPEC section 3.2: the reader does not guess at another reader's bytes."""
        data = bytearray(fixture_bytes("valid"))
        record = data.rfind(b"PK\x05\x06")
        for offset, value in ((record + 8, 0xFFFF), (record + 10, 0xFFFF)):
            data[offset : offset + 2] = value.to_bytes(2, "little")
        self.assertEqual(
            unsupported(bytes(data)), {"L0.ZIP.READABLE": UNSUPPORTED_VERSION}
        )
        self.assertEqual(verify(bytes(data)).verdict, "INCOMPLETE")
        separately = bytearray(fixture_bytes("valid"))
        record = separately.rfind(b"PK\x05\x06")
        separately[record + 4 : record + 6] = (1).to_bytes(2, "little")
        self.assertEqual(
            unsupported(bytes(separately)), {"L0.ZIP.READABLE": UNSUPPORTED_FEATURE}
        )

    def test_the_declared_extent_of_the_directory_is_read_too(self) -> None:
        """A byte the reader never looks at is a byte a forged file can change.

        The corpus's `eocd-cd-size-wrong` case: every record and offset is intact
        and the end record understates the directory by two bytes. Nothing else in
        the file notices, so `L0.ZIP.LAYOUT` is the check that has to.
        """
        data = bytearray(fixture_bytes("valid"))
        record = data.rfind(b"PK\x05\x06")
        declared = u32(data, record + 12)
        data[record + 12 : record + 16] = (declared - 2).to_bytes(4, "little")
        self.assertEqual(fails(bytes(data)), {"L0.ZIP.LAYOUT": MISMATCH})


class LineEndingTest(unittest.TestCase):
    """Read the file as bytes, hash the bytes, normalise nothing."""

    def test_a_document_whose_bytes_are_crlf_is_the_document(self) -> None:
        parts = fixture_parts()
        crlf = b"# Charter\r\n\r\nA document.\r\n"
        parts[CONTENT] = crlf
        parts["manifest.json"] = manifest_with_digest(
            parts, hashlib.sha256(crlf).hexdigest()
        )
        verdict = verify(artifact(parts))
        self.assertNotIn("L0.CONTENT.HASH", fails(artifact(parts)))
        self.assertEqual(
            check(artifact(parts), "L0.CONTENT.UTF8").status, "PASS"
        )
        self.assertEqual(verdict.artifact["head_content_sha256"], hashlib.sha256(crlf).hexdigest())

    def test_the_same_bytes_with_the_lf_digest_declared_do_not_match(self) -> None:
        parts = fixture_parts()
        crlf = b"# Charter\r\n\r\nA document.\r\n"
        parts[CONTENT] = crlf
        parts["manifest.json"] = manifest_with_digest(
            parts, hashlib.sha256(crlf.replace(b"\r\n", b"\n")).hexdigest()
        )
        self.assertEqual(
            fails(artifact(parts))["L0.CONTENT.HASH"], "MISMATCH"
        )

    def test_a_crlf_log_line_is_not_the_canonical_form_of_its_value(self) -> None:
        """What catches CRLF is CANONICAL, not PARSE, and the spec does not say so.

        PARSE tolerates whitespace — SPEC section 4 says so for the manifest and
        section 7's list of PARSE failures does not include "a line with a stray
        carriage return". So the CRLF below parses, and the check that refuses it
        is the canonical-byte rule, whose reason code is NON_CANONICAL. The
        README records this as a finding: the fixture `unterminated-log` covers a
        missing LF and nothing in the kit covers a CRLF.

        The line is also `{"a":1}`, which is not an entry: every field the format
        requires is absent from it, and FIELDS reports MISSING, because that is
        what a required thing that is not there carries (SPEC sections 5, 7, 10).
        """
        parts = fixture_parts()
        lines = b'{"a":1}\r\n'
        parts[PROVENANCE] = lines
        self.assertEqual(check(artifact(parts), "L0.PROVENANCE.PARSE").status, "PASS")
        self.assertEqual(
            check(artifact(parts), "L0.PROVENANCE.CANONICAL").reason_code,
            "NON_CANONICAL",
        )
        self.assertEqual(
            check(artifact(parts), "L0.PROVENANCE.FIELDS").reason_code, MISSING
        )


if __name__ == "__main__":
    unittest.main()
