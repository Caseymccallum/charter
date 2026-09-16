"""The cases the kit does not cover, frozen as tests.

Every assertion here started life as a differential probe: an artifact built by
hand, given to the reference CLI and to this verifier, and compared check by
check. The probes are how the disagreements that mattered were found — the digest,
key and signature *spelling* rules, the check that owns `format`, and the code an
absent field carries — and this file is where those answers live now, so that a
later change cannot quietly drift back.

Each test names the spec section it comes from, and says plainly when the spec
was silent and a probe decided it.
"""

from __future__ import annotations

import unittest

from charter_verify import base64url, canonical

from .support import (
    check,
    fails,
    fixture_parts,
    first_log_line,
    manifest_change,
    manifest_text,
    skips,
    with_log,
    with_manifest,
)


class FormatFieldTest(unittest.TestCase):
    """SPEC section 5: `format` is checked "before anything else"."""

    def test_a_missing_format_is_format_identifier_s_own_missing(self) -> None:
        data = manifest_change(lambda value: value.pop("format"))
        self.assertEqual(fails(data), {"L0.FORMAT.IDENTIFIER": "MISSING"})
        self.assertEqual(check(data, "L0.MANIFEST.FIELDS").status, "SKIP")
        self.assertEqual(skips(data), 19)

    def test_a_format_that_is_not_a_string_is_its_own_malformed(self) -> None:
        data = manifest_change(lambda value: value.__setitem__("format", 1))
        self.assertEqual(fails(data), {"L0.FORMAT.IDENTIFIER": "MALFORMED"})
        self.assertEqual(skips(data), 19)


class EncodingOwnerTest(unittest.TestCase):
    """The spelling of a value is checked where the value is used.

    SPEC section 5's table had these rules on L0.MANIFEST.FIELDS and was wrong
    about it: the recorded answer for the kit's `manifest-signature-truncated`
    expects L1.MANIFEST.SIGNATURE to be the only failure, which cannot be true of
    a verifier that measures the signature in FIELDS. The rest of the division
    came from probes.
    """

    def test_an_uppercase_digest_is_a_second_spelling_not_a_field_error(self) -> None:
        data = manifest_change(
            lambda value: value["content"].__setitem__(
                "sha256", value["content"]["sha256"].upper()
            )
        )
        self.assertEqual(check(data, "L0.MANIFEST.FIELDS").status, "PASS")
        self.assertEqual(fails(data)["L0.CONTENT.HASH"], "NON_CANONICAL_ENCODING")
        self.assertEqual(
            fails(data)["L2.CHAIN.HEAD_MATCHES_CONTENT"], "NON_CANONICAL_ENCODING"
        )
        self.assertEqual(check(data, "L1.MANIFEST.SIGNATURE").status, "FAIL")
        self.assertEqual(skips(data), 0)

    def test_a_key_of_the_wrong_length_fails_key_id_and_the_manifest_signature(
        self,
    ) -> None:
        data = manifest_change(
            lambda value: value["author"].__setitem__(
                "public_key", base64url.encode(bytes(31))
            )
        )
        self.assertEqual(check(data, "L0.MANIFEST.FIELDS").status, "PASS")
        self.assertEqual(
            fails(data),
            {"L1.MANIFEST.KEY_ID": "MALFORMED", "L1.MANIFEST.SIGNATURE": "MALFORMED"},
        )
        self.assertEqual(skips(data), 3)
        for id in (
            "L1.PROVENANCE.FIRST_AUTHOR",
            "L1.PROVENANCE.KEYS",
            "L1.PROVENANCE.SIGNATURES",
        ):
            with self.subTest(id):
                self.assertEqual(check(data, id).status, "SKIP")

    def test_a_key_that_does_not_derive_its_key_id_blocks_nothing(self) -> None:
        """The other half of the same rule, and the kit records it.

        A key that decodes and is 32 bytes is *usable*: the entry checks compare
        against it and pass or fail on their own, which is what the recorded
        `key-id-not-derived` and `manifest-public-key-swapped` cases show.
        """
        data = manifest_change(
            lambda value: value["author"].__setitem__(
                "public_key",
                value["author"]["public_key"][:-1]
                + base64url.ALPHABET[
                    base64url.ALPHABET.index(value["author"]["public_key"][-1]) + 1
                ],
            )
        )
        self.assertEqual(
            fails(data),
            {
                "L1.MANIFEST.KEY_ID": "NON_CANONICAL_ENCODING",
                "L1.MANIFEST.SIGNATURE": "NON_CANONICAL_ENCODING",
            },
        )
        self.assertEqual(skips(data), 3)

    def test_a_padded_signature_is_a_second_spelling(self) -> None:
        value = canonical.parse_document(fixture_parts()["manifest.json"])["signature"]
        data = manifest_change(
            lambda manifest: manifest.__setitem__("signature", value + "=")
        )
        self.assertEqual(fails(data), {"L1.MANIFEST.SIGNATURE": "NON_CANONICAL_ENCODING"})
        self.assertEqual(skips(data), 0)


class LogReadingTest(unittest.TestCase):
    def test_a_log_line_that_is_not_an_object_makes_nonempty_unproven(self) -> None:
        """At-least-one-entry is about entries, not about lines.

        SPEC section 7 says a log with no entries "is a file that records
        nothing, and a reader deserves to be told which of the two happened" —
        and for a file whose one line is `[1,2]`, the two are "it holds no
        entries" and "its one line is not an entry". The reference reports PARSE
        and skips NONEMPTY, which is the reading this port follows.
        """
        data = with_log(b"[1,2]\n")
        self.assertEqual(fails(data), {"L0.PROVENANCE.PARSE": "MALFORMED"})
        self.assertEqual(check(data, "L0.PROVENANCE.NONEMPTY").status, "SKIP")
        self.assertEqual(skips(data), 11)

    def test_a_crlf_line_parses_and_is_then_not_canonical(self) -> None:
        data = with_log(first_log_line().replace(b"\n", b"\r\n"))
        self.assertEqual(check(data, "L0.PROVENANCE.PARSE").status, "PASS")
        self.assertEqual(
            check(data, "L0.PROVENANCE.CANONICAL").reason_code, "NON_CANONICAL"
        )

    def test_a_digest_that_is_there_and_misspelled_is_non_canonical(self) -> None:
        """A digest that is present and not the one spelling: section 5's rule.

        The log's digest is read by L0.PROVENANCE.CONTENT_HASH_FORMAT, and the
        code for a string that is not 64 lowercase hex characters is
        NON_CANONICAL_ENCODING whatever the reason — here, uppercase. A check does
        not get to answer "malformed" for a value it can read.
        """
        value = canonical.parse_document(first_log_line())
        value["content_sha256"] = value["content_sha256"].upper()
        data = with_log(canonical.canonical_document(value))
        self.assertEqual(check(data, "L0.PROVENANCE.FIELDS").status, "PASS")
        self.assertEqual(
            fails(data)["L0.PROVENANCE.CONTENT_HASH_FORMAT"], "NON_CANONICAL_ENCODING"
        )

    def test_a_digest_of_the_wrong_length_is_non_canonical_too(self) -> None:
        """Length is not the axis MALFORMED sits on, and section 5 now says so.

        Section 5's table used to put "does not decode, or has the wrong length"
        under MALFORMED, and both implementations have always answered
        NON_CANONICAL_ENCODING for a digest of 63 characters: a string that is not
        the one spelling of a digest is not a digest spelled wrongly, it is not a
        spelling of a digest at all. The table and the two paragraphs under it
        were amended in step 7 to say what both readings already do; no fixture
        covers this input, which is why it is frozen here rather than in the kit.
        """
        value = canonical.parse_document(first_log_line())
        value["content_sha256"] = value["content_sha256"][:-1]
        data = with_log(canonical.canonical_document(value))
        self.assertEqual(check(data, "L0.PROVENANCE.FIELDS").status, "PASS")
        self.assertEqual(
            fails(data)["L0.PROVENANCE.CONTENT_HASH_FORMAT"], "NON_CANONICAL_ENCODING"
        )

        short = manifest_change(
            lambda value: value["content"].__setitem__(
                "sha256", value["content"]["sha256"][:-1]
            )
        )
        self.assertEqual(fails(short)["L0.CONTENT.HASH"], "NON_CANONICAL_ENCODING")
        self.assertEqual(
            fails(short)["L2.CHAIN.HEAD_MATCHES_CONTENT"], "NON_CANONICAL_ENCODING"
        )


class IntegerSpellingTest(unittest.TestCase):
    def test_a_leading_zero_is_a_non_integer_number(self) -> None:
        """SPEC section 4.1 lists five violations and named the reason for four.

        The probe against the reference settled `01`: NON_INTEGER_NUMBER, the
        same family as `1.0`, `1e0` and `-0`. The spec now says so too.
        """
        data = with_manifest(manifest_text()[:-2] + ',"level":01}\n')
        self.assertEqual(fails(data), {"L0.MANIFEST.PARSE": "NON_INTEGER_NUMBER"})


class AbsentValueTest(unittest.TestCase):
    """A value that is absent, and the one code the vocabulary has for it.

    This is the tenth finding, and the first thing the probe found that was a
    *specification* question rather than a bug in one program. The probe
    `log-line-not-canonical` carries an entry with no `content_sha256` at all.
    Both implementations reported NON_CANONICAL_ENCODING from
    `L0.PROVENANCE.CONTENT_HASH_FORMAT`, whose own sentence said "absent
    (MISSING)" — the code and the sentence disagreed with each other, and with
    SPEC section 10, which defines MISSING as "a required thing is absent". The
    reference's manifest path had been reporting MISSING for an absent field all
    along; the log path was the outlier, and so was this port's manifest path.

    The rule is now stated in sections 5, 7 and 10 and both readings follow it: a
    field that is not there carries MISSING, and every check that required the
    value reports that same code — the check that asks whether the field is
    present and the check that reads it. One absence, one code, in as many checks
    as needed the value: that is what makes the recorded answer for the probe a
    single fact rather than two readings of it.

    Freezing it here is the point of committing the probe. A later release that
    went back to a spelling code for an absent field would have to change this
    test, the record and the spec together, in the open.
    """

    def test_an_absent_digest_is_missing_in_both_checks_that_required_it(self) -> None:
        data = with_log(b'{"action": "create"}\n')
        self.assertEqual(
            fails(data),
            {
                "L0.PROVENANCE.CANONICAL": "NON_CANONICAL",
                "L0.PROVENANCE.FIELDS": "MISSING",
                "L0.PROVENANCE.CONTENT_HASH_FORMAT": "MISSING",
            },
        )
        for id in ("L0.PROVENANCE.FIELDS", "L0.PROVENANCE.CONTENT_HASH_FORMAT"):
            with self.subTest(id):
                self.assertEqual(check(data, id).status, "FAIL")
                self.assertEqual(check(data, id).reason_code, "MISSING")
        self.assertEqual(skips(data), 6)

    def test_an_absent_manifest_field_is_missing(self) -> None:
        """The same rule where the manifest's fields are read.

        No fixture and no probe asks this, which is why it is frozen here: the
        reference reported MISSING for an absent manifest field and this port
        reported MALFORMED, and SPEC section 5 now states which one the format is.
        """
        data = manifest_change(lambda value: value.pop("title"))
        self.assertEqual(fails(data), {"L0.MANIFEST.FIELDS": "MISSING"})
        self.assertEqual(skips(data), 7)

    def test_an_absent_nested_field_is_missing_too(self) -> None:
        """`content.sha256` and `author.public_key` are fields like any other.

        The rule does not care how deep the missing field is: what is absent is
        absent, and FIELDS is the check that says so.
        """
        data = manifest_change(lambda value: value["content"].pop("sha256"))
        self.assertEqual(fails(data), {"L0.MANIFEST.FIELDS": "MISSING"})
        nested = manifest_change(lambda value: value["author"].pop("public_key"))
        self.assertEqual(fails(nested), {"L0.MANIFEST.FIELDS": "MISSING"})


if __name__ == "__main__":
    unittest.main()
