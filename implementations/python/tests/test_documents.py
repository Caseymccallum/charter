"""The field rules of the manifest and the log. SPEC sections 5 and 7."""

from __future__ import annotations

import unittest

from charter_verify import base64url, canonical, documents, ed25519
from charter_verify.errors import Refusal
from charter_verify.vocabulary import (
    MALFORMED,
    MISSING,
    NON_CANONICAL_ENCODING,
    UNKNOWN_FIELD,
)

from .support import fixture_parts


def reason_of(function, *arguments) -> str:
    with unittest.TestCase().assertRaises(Refusal) as caught:
        function(*arguments)
    return caught.exception.reason


class TimestampTest(unittest.TestCase):
    """Validated by arithmetic, not by a clock and not by the host's timezone."""

    def test_the_bounds(self) -> None:
        for text in (
            "2026-01-01T00:00:00Z",
            "2024-02-29T23:59:59Z",  # a leap year
            "2000-02-29T00:00:00Z",  # divisible by 400
            "0000-01-01T00:00:00Z",
        ):
            with self.subTest(text):
                self.assertEqual(documents.check_timestamp(text, "a time"), text)

    def test_the_refusals(self) -> None:
        for text in (
            "2023-02-29T00:00:00Z",  # not a leap year
            "1900-02-29T00:00:00Z",  # divisible by 100 and not 400
            "2026-01-01",  # the kit's manifest-field-unreadable case
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:60:00Z",
            "2026-01-01T00:00:60Z",
            "2026-13-01T00:00:00Z",
            "2026-00-01T00:00:00Z",
            "2026-01-32T00:00:00Z",
            "2026-01-01T00:00:00+00:00",  # UTC is fixed, so there is no offset
            "2026-01-01t00:00:00z",
            "2026-01-01T00:00:00.000Z",
        ):
            with self.subTest(text):
                self.assertEqual(reason_of(documents.check_timestamp, text, "a time"), MALFORMED)

    def test_sixty_seconds_is_not_a_leap_second_here(self) -> None:
        self.assertEqual(
            reason_of(documents.check_timestamp, "2016-12-31T23:59:60Z", "a time"),
            MALFORMED,
        )


class KeyIdTest(unittest.TestCase):
    def test_the_derivation_is_the_one_the_fixture_records(self) -> None:
        """If this is wrong, every key-id check fails and it looks like signatures.

        SPEC section 8: `key_id = "ed25519:" + lowercase hex SHA-256 of the 32
        public key bytes`, and nothing is truncated.
        """
        parts = fixture_parts()
        manifest = documents.read_manifest(
            canonical.parse_document(parts["manifest.json"])
        )
        public_key = base64url.decode(manifest.public_key_text, "public_key")
        self.assertEqual(len(public_key), 32)
        self.assertEqual(ed25519.derive_key_id(public_key), manifest.key_id)
        self.assertEqual(len(manifest.key_id), len("ed25519:") + 64)
        self.assertTrue(manifest.key_id.startswith("ed25519:"))

    def test_a_different_key_derives_a_different_id(self) -> None:
        first = bytes(32)
        second = bytes(32)
        second = bytes([1]) + second[1:]
        self.assertNotEqual(ed25519.derive_key_id(first), ed25519.derive_key_id(second))


class Base64UrlTest(unittest.TestCase):
    """Canonical base64url has one spelling per byte string. SPEC section 8."""

    def test_round_trip(self) -> None:
        for size in (0, 1, 2, 3, 32, 64, 65):
            with self.subTest(size):
                data = bytes(range(size))
                self.assertEqual(base64url.decode(base64url.encode(data)), data)
                self.assertNotIn("=", base64url.encode(data))

    def test_padding_is_a_second_spelling(self) -> None:
        self.assertEqual(reason_of(base64url.decode, "AA=="), NON_CANONICAL_ENCODING)

    def test_a_non_zero_trailing_bit_pattern_is_a_second_spelling(self) -> None:
        """The classic `AB` versus `AA` ambiguity.

        One byte is 8 bits, and base64url spells it with two characters: 12 bits,
        of which the last 4 must be zero. `AA` is the one spelling of b"\\x00";
        `AB` is not.
        """
        self.assertEqual(base64url.decode("AA"), b"\x00")
        self.assertEqual(reason_of(base64url.decode, "AB"), NON_CANONICAL_ENCODING)

    def test_characters_outside_the_alphabet_are_not_a_spelling(self) -> None:
        """Every way a string fails to be the one spelling carries one code.

        `A!`, `A+A`, `A/A` and `AAAAA` are not four kinds of malformation: none of
        them is the one spelling of a byte string, and SPEC section 5's rule is
        "the string is not the one spelling this format fixes for that value,
        whatever the reason it is not". A length that no byte string is spelled
        with is a reason like any other. MALFORMED is for the length of the *value*
        — 63 bytes where a signature needs 64 — which is the caller's complaint,
        because the caller is the one that knows what its algorithm needs.
        """
        for text in ("A!", "A+A", "A/A", "AAAAA"):
            with self.subTest(text):
                self.assertEqual(
                    reason_of(base64url.decode, text), NON_CANONICAL_ENCODING
                )

    def test_the_empty_string_is_one_spelling_and_not_a_refusal(self) -> None:
        """It is the one spelling of the empty byte string.

        Whether a signature may be one is a question about length, and
        `L1.MANIFEST.SIGNATURE` answers it MALFORMED; a refusal here would be this
        module answering a question about the alphabet with the code for a
        value of the wrong length.
        """
        self.assertEqual(base64url.decode(""), b"")


class ManifestFieldsTest(unittest.TestCase):
    def base(self) -> dict:
        from charter_verify import canonical

        return canonical.parse_document(fixture_parts()["manifest.json"])

    def test_the_fixture_manifest_is_the_six_fields(self) -> None:
        manifest = documents.read_manifest(self.base())
        self.assertEqual(manifest.format, "charter/0.1")
        self.assertEqual(manifest.algorithm, "ed25519")
        self.assertEqual(len(base64url.decode(manifest.signature_text)), 64)
        self.assertEqual(len(base64url.decode(manifest.public_key_text)), 32)

    def test_a_missing_field_is_missing_and_not_malformed(self) -> None:
        """Absence has its own code. SPEC section 10 gives MISSING one meaning.

        A field that is not in the object is not a field whose spelling is wrong,
        and the rule is stated where the manifest's fields are read (SPEC section
        5) rather than left to a reader to guess from the vocabulary alone.
        """
        value = self.base()
        del value["title"]
        self.assertEqual(reason_of(documents.read_manifest, value), MISSING)
        self.assertNotEqual(reason_of(documents.read_manifest, value), MALFORMED)

    def test_the_algorithm_is_an_enumeration_of_one(self) -> None:
        """A value this version does not define is UNKNOWN_FIELD, not MALFORMED.

        SPEC section 5: "An algorithm this version does not define is reported as
        a field value it does not define, not skipped over." The vocabulary's word
        for a thing the verifier has no rule for is UNKNOWN_FIELD, and this port
        answered MALFORMED for a value it could read perfectly well until the
        differential sweep asked it about `"rsa"`. A value that is not a string at
        all is the other sentence: the field is there and does not hold the JSON
        value the table names.
        """
        value = self.base()
        value["author"]["algorithm"] = "rsa"
        self.assertEqual(reason_of(documents.read_manifest, value), UNKNOWN_FIELD)
        value["author"]["algorithm"] = 1
        self.assertEqual(reason_of(documents.read_manifest, value), MALFORMED)

    def test_the_key_id_may_not_be_empty(self) -> None:
        """A key id is a name, and no other check reads it as a value.

        `L1.MANIFEST.KEY_ID` compares the key id against the derivation of the key
        beside it, so an empty one could be reported as a mismatch — but section
        5's table gives `author.key_id` "a non-empty string" to FIELDS, and the
        check that reads a value owns its *encoding* while the shape of a field
        nobody reads is FIELDS'.
        """
        value = self.base()
        value["author"]["key_id"] = ""
        self.assertEqual(reason_of(documents.read_manifest, value), MALFORMED)

    def test_the_title_may_not_be_empty(self) -> None:
        value = self.base()
        value["title"] = ""
        self.assertEqual(reason_of(documents.read_manifest, value), MALFORMED)

    def test_the_digest_shape_is_checked_where_the_digest_is_used(self) -> None:
        """FIELDS checks presence and type; the consumers check the spelling.

        SPEC section 5's table said FIELDS owned "64 lowercase hex characters",
        and was amended: a check that reports a wrongly spelled digest before
        anything has read the content cannot also be the check that reports a
        content-hash mismatch, and NON_CANONICAL_ENCODING — a reason code the
        spec lists and no rule used — is the code for "the same value, a second
        spelling" wherever the value is read.
        """
        value = self.base()
        value["content"]["sha256"] = value["content"]["sha256"].upper()
        self.assertEqual(
            documents.read_manifest(value).content_sha256, value["content"]["sha256"]
        )
        self.assertTrue(documents.is_digest("0" * 64))
        self.assertFalse(documents.is_digest("0" * 63))
        self.assertFalse(documents.is_digest("0" * 64 + "0"))
        self.assertFalse(documents.is_digest("A" * 64))

    def test_a_public_key_of_the_wrong_length_passes_fields_and_fails_key_id(self) -> None:
        value = self.base()
        value["author"]["public_key"] = base64url.encode(bytes(31))
        self.assertEqual(documents.read_manifest(value).key_id, value["author"]["key_id"])
        self.assertEqual(
            documents.read_manifest(value).public_key_text, value["author"]["public_key"]
        )

    def test_the_manifest_does_not_own_the_format_field(self) -> None:
        """FORMAT.IDENTIFIER runs "before anything else", including FIELDS."""
        value = self.base()
        del value["format"]
        self.assertEqual(documents.read_manifest(value).format, None)

    def test_unknown_fields_at_any_depth(self) -> None:
        """The reading the README records as a guess.

        SPEC section 5 says `author` is "an object with exactly name, algorithm,
        key_id, public_key" and `content` is "an object whose only field is
        sha256", and section 10 gives EXTRA_FIELDS the rule "no field this
        version has no rule for". Read together, a field the version does not
        define is UNKNOWN_FIELD wherever it sits, and FIELDS keeps the job of
        saying whether the fields it knows about are present and well formed.
        """
        value = self.base()
        self.assertEqual(documents.manifest_unknown_fields(value), [])
        value["extra"] = 1
        self.assertEqual(documents.manifest_unknown_fields(value), ["extra"])
        value = self.base()
        value["author"]["nickname"] = "Casey"
        self.assertEqual(documents.manifest_unknown_fields(value), ["author.nickname"])
        value = self.base()
        value["content"]["length"] = 158
        self.assertEqual(documents.manifest_unknown_fields(value), ["content.length"])


class LogFieldsTest(unittest.TestCase):
    def lines(self) -> list:
        from charter_verify import canonical

        return [
            canonical.parse_document(line)
            for line in fixture_parts()["provenance.jsonl"].split(b"\n")
            if line
        ]

    def test_the_fixture_log_is_the_seven_fields(self) -> None:
        for value in self.lines():
            entry = documents.read_entry(value, b"")
            self.assertIn(entry.action, documents.ACTIONS)
            self.assertEqual(len(base64url.decode(entry.signature_text)), 64)

    def test_the_action_is_an_enumeration_of_two(self) -> None:
        """The same two answers as the manifest's algorithm.

        SPEC section 7 says "`"create"` or `"edit"`, and nothing else", and the
        code for a value this version does not define is the vocabulary's word for
        exactly that: UNKNOWN_FIELD. A value that is not a string is MALFORMED.
        """
        value = self.lines()[0]
        value["action"] = "delete"
        self.assertEqual(reason_of(documents.read_entry, value, b""), UNKNOWN_FIELD)
        value["action"] = 1
        self.assertEqual(reason_of(documents.read_entry, value, b""), MALFORMED)

    def test_an_entry_s_key_id_may_not_be_empty(self) -> None:
        value = self.lines()[1]
        value["author"]["key_id"] = ""
        self.assertEqual(reason_of(documents.read_entry, value, b""), MALFORMED)

    def test_a_parent_is_null_or_a_string(self) -> None:
        """The shape of a digest is LINKS' business, not FIELDS'."""
        value = self.lines()[1]
        value["parent"] = "not a digest"
        self.assertEqual(documents.read_entry(value, b"").parent, "not a digest")
        value["parent"] = None
        self.assertEqual(documents.read_entry(value, b"").parent, None)
        value["parent"] = 1
        self.assertEqual(reason_of(documents.read_entry, value, b""), MALFORMED)

    def test_a_summary_may_not_be_empty(self) -> None:
        value = self.lines()[1]
        value["summary"] = ""
        self.assertEqual(reason_of(documents.read_entry, value, b""), MALFORMED)

    def test_a_log_line_must_be_an_object(self) -> None:
        from charter_verify import canonical

        self.assertEqual(canonical.parse_document(b"[1,2,3]"), [1, 2, 3])


if __name__ == "__main__":
    unittest.main()
