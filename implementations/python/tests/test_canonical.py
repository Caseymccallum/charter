"""Canonical JSON, both directions. SPEC section 4.

The two traps the brief names live here. Python's `json.dumps` is wrong by
default — `ensure_ascii=True`, `separators=(', ', ': ')`, and `sort_keys=True`
sorting by UTF-16 code unit — and Python's type system is wrong in the other
direction, because `isinstance(True, int)` is `True`. Every case below is one of
those, stated against the spec's own examples.
"""

from __future__ import annotations

import json
import unittest

from charter_verify import canonical
from charter_verify.errors import Refusal
from charter_verify.vocabulary import (
    DECODE_ERROR,
    DUPLICATE,
    MALFORMED,
    NON_INTEGER_NUMBER,
    NUMBER_OUT_OF_RANGE,
)

from .support import fixture_parts


def refusal(data: bytes) -> Refusal:
    with unittest.TestCase().assertRaises(Refusal) as caught:
        canonical.parse_document(data)
    return caught.exception


class WritingTest(unittest.TestCase):
    def test_keys_sort_by_code_point_not_by_utf16_code_unit(self) -> None:
        """The U+1F600 versus U+FFFF case from the reference's fuzz corpus.

        By code point, U+FFFF comes first. By UTF-16 code unit it does not,
        because U+1F600 is D83D DE00 and D83D < FFFF. RFC 8785 asks for the
        second order and this format asks for the first, so this one line is the
        whole difference between two implementations that both claim to be
        canonical.

        The brief for this port expected Python's `sort_keys=True` to get this
        wrong, the way a naive JavaScript `Object.keys().sort()` does. It does
        not: `json.dumps` sorts with Python's own string comparison, which is by
        code point, so here Python agrees with the spec by accident of its type
        system rather than by reading it. The assertions below say so, rather
        than pretending otherwise: the difference that remains is spacing and
        escaping, not order.
        """
        value = {"\U0001f600": 1, "\uffff": 2}
        mine = canonical.canonical_bytes(value)
        self.assertEqual(mine, '{"\uffff":2,"\U0001f600":1}'.encode("utf-8"))
        # The same order, from a library that was not told what order to use
        # beyond "sorted".
        theirs = json.dumps(
            value, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        )
        self.assertEqual(mine.decode("utf-8"), theirs)

    def test_python_json_is_wrong_by_default_in_the_other_two_ways(self) -> None:
        """`ensure_ascii=True` and `separators=(', ', ': ')` are the defaults."""
        value = {"title": "é", "b": 1}
        self.assertNotEqual(
            json.dumps(value, sort_keys=True),
            canonical.canonical_bytes(value).decode("utf-8"),
        )
        self.assertEqual(json.dumps({"title": "é"}), '{"title": "\\u00e9"}')

    def test_an_emoji_is_written_literally_and_python_escapes_it_by_default(self) -> None:
        value = {"title": "\U0001f600"}
        self.assertEqual(
            canonical.canonical_bytes(value), '{"title":"\U0001f600"}'.encode("utf-8")
        )
        self.assertIn("\\ud83d", json.dumps(value, separators=(",", ":")))

    def test_bool_is_not_an_integer(self) -> None:
        """`isinstance(True, int)` is True, so bool has to be answered first."""
        self.assertEqual(canonical.canonical_bytes({"a": True}), b'{"a":true}')
        self.assertEqual(canonical.canonical_bytes({"a": False}), b'{"a":false}')
        self.assertEqual(canonical.canonical_bytes({"a": None}), b'{"a":null}')

    def test_control_characters_use_the_short_escapes(self) -> None:
        self.assertEqual(
            canonical.canonical_bytes({"a": "\b\t\n\f\r\x00\x1f\\\"é/"}),
            b'{"a":"\\b\\t\\n\\f\\r\\u0000\\u001f\\\\\\"\xc3\xa9/"}',
        )

    def test_a_float_and_an_out_of_range_integer_are_refused_by_name(self) -> None:
        with self.assertRaises(Refusal) as caught:
            canonical.canonical_bytes({"a": 1.0})
        self.assertEqual(caught.exception.reason, NON_INTEGER_NUMBER)
        with self.assertRaises(Refusal) as caught:
            canonical.canonical_bytes({"a": 2**53})
        self.assertEqual(caught.exception.reason, NUMBER_OUT_OF_RANGE)

    def test_an_unpaired_surrogate_has_no_encoding(self) -> None:
        with self.assertRaises(Refusal) as caught:
            canonical.canonical_bytes({"a": "\ud800"})
        self.assertEqual(caught.exception.reason, MALFORMED)

    def test_the_document_ends_where_the_value_ends(self) -> None:
        self.assertEqual(canonical.canonical_document({"a": 1}), b'{"a":1}\n')
        self.assertEqual(
            canonical.signing_input({"a": 1, "signature": "x"}), b'{"a":1}\n'
        )


class ReadingTest(unittest.TestCase):
    def test_integer_rules(self) -> None:
        for spelling, reason in (
            (b'{"a":1.0}', NON_INTEGER_NUMBER),
            (b'{"a":1e0}', NON_INTEGER_NUMBER),
            (b'{"a":-0}', NON_INTEGER_NUMBER),
            (b'{"a":1e2}', NON_INTEGER_NUMBER),
            (b'{"a":9007199254740993}', NUMBER_OUT_OF_RANGE),
            (b'{"a":9007199254740992}', NUMBER_OUT_OF_RANGE),
        ):
            with self.subTest(spelling):
                self.assertEqual(refusal(spelling).reason, reason)

    def test_the_largest_integer_that_round_trips_is_accepted(self) -> None:
        self.assertEqual(
            canonical.parse_document(b'{"a":9007199254740991}'), {"a": 2**53 - 1}
        )

    def test_a_leading_zero_is_a_violation_of_the_integer_rules(self) -> None:
        """SPEC section 4.1 lists five violations and names the reason for four.

        `01` is in the list, and the sentence gives the first three
        NON_INTEGER_NUMBER and the last NUMBER_OUT_OF_RANGE, leaving `01` without
        a code. This is one of the ambiguities the README records; a probe
        against the reference decided it, and the constant in `canonical` is the
        answer.
        """
        self.assertEqual(refusal(b'{"a":01}').reason, canonical.LEADING_ZERO_REASON)

    def test_duplicate_keys_are_refused_rather_than_resolved(self) -> None:
        self.assertEqual(refusal(b'{"a":1,"a":2}').reason, DUPLICATE)

    def test_surrogates(self) -> None:
        for spelling in (b'{"a":"\\ud800"}', b'{"a":"\\udc00"}', b'{"a":"\\ud800x"}'):
            with self.subTest(spelling):
                self.assertEqual(refusal(spelling).reason, MALFORMED)
        # A correctly paired surrogate is one ordinary character.
        self.assertEqual(
            canonical.parse_document(b'{"a":"\\ud83d\\ude00"}'), {"a": "\U0001f600"}
        )

    def test_depth_and_trailing_bytes(self) -> None:
        self.assertEqual(refusal(b"[" * 66 + b"]" * 66).reason, MALFORMED)
        self.assertIsInstance(
            canonical.parse_document(b"[" * 64 + b"]" * 64), list
        )
        self.assertEqual(refusal(b'{"a":1} x').reason, MALFORMED)

    def test_bytes_that_are_not_utf8(self) -> None:
        self.assertEqual(refusal(b'{"a":"\xff"}').reason, DECODE_ERROR)

    def test_whitespace_parses_and_is_not_canonical(self) -> None:
        """A byte-rule violation is NON_CANONICAL, not a syntax error.

        "Whitespace and key order are tolerated while parsing, so that a
        violation can be reported as 'this is well-formed JSON but not the
        canonical bytes for it' rather than as a bare syntax error."
        """
        value = canonical.parse_document(b'{"a": 1}')
        self.assertEqual(value, {"a": 1})
        self.assertNotEqual(b'{"a": 1}\n', canonical.canonical_document(value))

    def test_escape_spellings_parse_and_are_not_canonical(self) -> None:
        for spelling in (b'{"a":"\\u00e9"}', b'{"a":"\\/"}', b'{"a":"\\ud83d\\ude00"}'):
            with self.subTest(spelling):
                value = canonical.parse_document(spelling)
                self.assertIsInstance(value, dict)
                self.assertNotEqual(
                    spelling + b"\n", canonical.canonical_document(value)
                )


class FixedPointTest(unittest.TestCase):
    """A canonical document is a fixed point. SPEC section 4.2."""

    ARTIFACTS = (
        "valid",
        "valid-deflate",
        "history-rewritten",
        "entry-with-earlier-timestamp",
        "empty-content",
        "log-middle-entry-removed",
        "forked-log",
    )

    def test_the_committed_artifacts_are_fixed_points(self) -> None:
        for name in self.ARTIFACTS:
            with self.subTest(name):
                parts = fixture_parts(name)
                manifest = canonical.parse_document(parts["manifest.json"])
                self.assertEqual(
                    canonical.canonical_document(manifest), parts["manifest.json"]
                )
                for line in parts["provenance.jsonl"].split(b"\n"):
                    if not line:
                        continue
                    value = canonical.parse_document(line)
                    self.assertEqual(canonical.canonical_document(value), line + b"\n")


if __name__ == "__main__":
    unittest.main()
