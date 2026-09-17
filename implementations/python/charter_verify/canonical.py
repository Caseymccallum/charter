"""Canonical JSON, both directions. SPEC section 4.

Canonical form is a subset of RFC 8785 with three deliberate differences:

1. integers only, and only those that round-trip through 53 bits;
2. object keys sorted by **code point** (RFC 8785 says UTF-16 code unit, and
   the two orders disagree above U+FFFF);
3. a file is one canonical value followed by exactly one LF.

Both directions live here because both are one section of the spec, and neither
direction calls the other: `canonical_bytes` writes a value the reader already
produced, which is how the CANONICAL check compares bytes against value.

Python's `json` module is not used, in either direction. `json.dumps` escapes
non-ASCII by default and separates with `(', ', ': ')`; `json.loads` turns
`1e2` into a float, keeps the last of two duplicate keys, and reports no reason
code for any of it. The rules here are read off the spec rather than delegated
to a library, because a reason code is part of the interface and a library does
not have one.
"""

from __future__ import annotations

import re
from typing import Any

from . import limits
from .errors import Refusal
from .vocabulary import (
    DECODE_ERROR,
    DUPLICATE,
    LIMIT_EXCEEDED,
    MALFORMED,
    NON_CANONICAL,
    NON_INTEGER_NUMBER,
    NUMBER_OUT_OF_RANGE,
)

MAX_SAFE_INTEGER = 2**53 - 1

_WHITESPACE = " \t\n\r"
# The characters that can occur in a number, which is what fixes where one ends:
# SPEC section 4 says a token runs to the first character that cannot occur in a
# number, and that a token which is not the one spelling of an integer carries
# NON_INTEGER_NUMBER. That is deliberately not JSON's grammar — `01` and
# `2026-01-01` are syntax errors to `json`, and this format calls them a number
# a reader would not have written.
_NUMBER_CHARACTERS = frozenset("-+0123456789.eE")
_INTEGER = re.compile(r"(?:0|-?[1-9][0-9]*)\Z")
_HEX_DIGITS = "0123456789abcdefABCDEF"
_SHORT_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}
_SHORT_FOR = {"\b": "b", "\f": "f", "\n": "n", "\r": "r", "\t": "t"}


class _Refused(Exception):
    """Internal: a reason and its prose, on the way out as a `Refusal`."""

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


class _Reader:
    """Bytes to a value, or a refusal with a reason code."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.length = len(text)
        self.at = 0

    def parse(self) -> Any:
        value = self._value(0)
        self._skip()
        if self.at != self.length:
            raise _Refused(
                MALFORMED,
                f"the document carries more after the value it holds, starting "
                f"at character {self.at}",
            )
        return value

    def _skip(self) -> None:
        while self.at < self.length and self.text[self.at] in _WHITESPACE:
            self.at += 1

    def _value(self, depth: int) -> Any:
        if depth > limits.JSON_DEPTH:
            raise _Refused(
                MALFORMED,
                f"the value nests deeper than {limits.JSON_DEPTH}, which is the "
                "depth this verifier agrees to read",
            )
        self._skip()
        if self.at >= self.length:
            raise _Refused(MALFORMED, "the document ends where a value was due")
        character = self.text[self.at]
        if character == "{":
            return self._object(depth)
        if character == "[":
            return self._array(depth)
        if character == '"':
            return self._string()
        for literal, value in (("true", True), ("false", False), ("null", None)):
            if self.text.startswith(literal, self.at):
                self.at += len(literal)
                return value
        if character == "-" or "0" <= character <= "9":
            return self._number()
        raise _Refused(
            MALFORMED,
            f"the document holds {character!r} where a value was due",
        )

    def _object(self, depth: int) -> dict:
        self.at += 1  # the '{'
        out: dict = {}
        self._skip()
        if self.at < self.length and self.text[self.at] == "}":
            self.at += 1
            return out
        while True:
            self._skip()
            if self.at >= self.length or self.text[self.at] != '"':
                raise _Refused(MALFORMED, "an object key is not a string")
            key = self._string()
            self._skip()
            if self.at >= self.length or self.text[self.at] != ":":
                raise _Refused(MALFORMED, "an object key is not followed by ':'")
            self.at += 1
            value = self._value(depth + 1)
            if key in out:
                raise _Refused(
                    DUPLICATE,
                    f"the object holds the key {key!r} twice, and a reader that "
                    "kept the last one would be signing a different object than "
                    "a reader that kept the first",
                )
            out[key] = value
            self._skip()
            if self.at >= self.length:
                raise _Refused(MALFORMED, "an object is not closed")
            character = self.text[self.at]
            if character == ",":
                self.at += 1
                continue
            if character == "}":
                self.at += 1
                return out
            raise _Refused(
                MALFORMED, f"an object holds {character!r} where ',' or '}}' was due"
            )

    def _array(self, depth: int) -> list:
        self.at += 1  # the '['
        out: list = []
        self._skip()
        if self.at < self.length and self.text[self.at] == "]":
            self.at += 1
            return out
        while True:
            out.append(self._value(depth + 1))
            self._skip()
            if self.at >= self.length:
                raise _Refused(MALFORMED, "an array is not closed")
            character = self.text[self.at]
            if character == ",":
                self.at += 1
                continue
            if character == "]":
                self.at += 1
                return out
            raise _Refused(
                MALFORMED, f"an array holds {character!r} where ',' or ']' was due"
            )

    def _string(self) -> str:
        self.at += 1  # the opening quote
        out: list[str] = []
        while True:
            if self.at >= self.length:
                raise _Refused(MALFORMED, "a string is not closed")
            character = self.text[self.at]
            self.at += 1
            if character == '"':
                return "".join(out)
            if character != "\\":
                if character < " ":
                    raise _Refused(
                        MALFORMED,
                        f"a string holds a raw {ord(character):#04x} control "
                        "character, which JSON spells with an escape",
                    )
                out.append(character)
                continue
            if self.at >= self.length:
                raise _Refused(MALFORMED, "a string ends inside an escape")
            escape = self.text[self.at]
            self.at += 1
            if escape in _SHORT_ESCAPES:
                out.append(_SHORT_ESCAPES[escape])
                continue
            if escape != "u":
                raise _Refused(
                    MALFORMED, f"{escape!r} is not an escape this format defines"
                )
            out.append(self._unicode_escape())

    def _unicode_escape(self) -> str:
        code = self._four_hex()
        if 0xDC00 <= code <= 0xDFFF:
            raise _Refused(
                MALFORMED,
                f"\\u{code:04x} is the low half of a surrogate pair, and UTF-8 "
                "has no encoding for half a character",
            )
        if 0xD800 <= code <= 0xDBFF:
            if self.text[self.at : self.at + 2] != "\\u":
                raise _Refused(
                    MALFORMED,
                    f"\\u{code:04x} is the high half of a surrogate pair and no "
                    "low half follows it",
                )
            self.at += 2
            low = self._four_hex()
            if not 0xDC00 <= low <= 0xDFFF:
                raise _Refused(
                    MALFORMED,
                    f"\\u{code:04x} is the high half of a surrogate pair and "
                    f"\\u{low:04x} is not its low half",
                )
            return chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00))
        return chr(code)

    def _four_hex(self) -> int:
        digits = self.text[self.at : self.at + 4]
        if len(digits) != 4 or any(digit not in _HEX_DIGITS for digit in digits):
            raise _Refused(MALFORMED, "a \\u escape is not four hexadecimal digits")
        self.at += 4
        return int(digits, 16)

    def _number(self) -> int:
        start = self.at
        while self.at < self.length and self.text[self.at] in _NUMBER_CHARACTERS:
            self.at += 1
        spelling = self.text[start : self.at]
        if not _INTEGER.match(spelling):
            raise _Refused(
                NON_INTEGER_NUMBER,
                f"{spelling} is not the one spelling of any integer in this format: "
                "an integer is 0, or -?[1-9][0-9]*, with no fraction, no exponent "
                "and no leading zero",
            )
        value = int(spelling)
        if abs(value) > MAX_SAFE_INTEGER:
            raise _Refused(
                NUMBER_OUT_OF_RANGE,
                f"{spelling} is outside ±(2^53 − 1), so it does not round-trip "
                "through the integers this format carries",
            )
        return value


def parse_document(data: bytes, ceiling: int = limits.JSON_DOCUMENT_BYTES) -> Any:
    """One JSON value from these bytes, or a refusal with a reason code.

    The ceiling is compared *before* the bytes are decoded or parsed, because
    SPEC section 3.7 says a limit is checked before the work it bounds.
    Whitespace and key order are tolerated here: a violation of the byte-level
    rules is reported by the CALLING check as NON_CANONICAL, which is a
    different claim from "these bytes are not JSON".
    """
    if len(data) > ceiling:
        raise Refusal(
            LIMIT_EXCEEDED,
            f"the document is {len(data)} bytes, and the ceiling for one JSON "
            f"document is {ceiling}",
        )
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as problem:
        raise Refusal(
            DECODE_ERROR,
            f"the bytes are not UTF-8 ({problem.reason} at byte {problem.start})",
        ) from None
    try:
        return _Reader(text).parse()
    except _Refused as refused:
        raise Refusal(refused.reason, refused.detail) from None


def canonical_bytes(value: Any) -> bytes:
    """The one byte sequence this format writes for this value. SPEC section 4."""
    out: list[str] = []
    _write(value, out, 0)
    return "".join(out).encode("utf-8")


def canonical_document(value: Any) -> bytes:
    """A canonical value and the one LF that closes it."""
    return canonical_bytes(value) + b"\n"


def signing_input(value: Any) -> bytes:
    """The bytes a signature covers. SPEC section 4.1.

    The canonical form of the object **with its `signature` field removed**,
    followed by one LF. The terminator is not decoration: without it, a
    signature over one object could be moved to a place in a document where it
    happens to be a prefix of the canonical text, and both placements would
    verify.
    """
    if not isinstance(value, dict):
        raise Refusal(MALFORMED, "a signature covers an object, and this value is not one")
    without = {key: inner for key, inner in value.items() if key != "signature"}
    return canonical_document(without)


def _write(value: Any, out: list, depth: int) -> None:
    if depth > limits.JSON_DEPTH:
        raise Refusal(
            MALFORMED,
            f"the value nests deeper than {limits.JSON_DEPTH}, which is the "
            "ceiling for the same condition in the reading direction",
        )
    if value is None:
        out.append("null")
        return
    if value is True:
        out.append("true")
        return
    if value is False:
        out.append("false")
        return
    if isinstance(value, str):
        out.append(_write_string(value))
        return
    if isinstance(value, int):  # checked after bool, which subclasses int
        if abs(value) > MAX_SAFE_INTEGER:
            raise Refusal(
                NUMBER_OUT_OF_RANGE,
                f"{value} is outside ±(2^53 − 1), so writing it would write a "
                "different number than the one passed in",
            )
        out.append(str(value))
        return
    if isinstance(value, float):
        raise Refusal(
            NON_INTEGER_NUMBER,
            f"{value!r} is not an integer, and this format writes integers only",
        )
    if isinstance(value, (list, tuple)):
        out.append("[")
        for index, item in enumerate(value):
            if index > 0:
                out.append(",")
            _write(item, out, depth + 1)
        out.append("]")
        return
    if isinstance(value, dict):
        # sorted() compares str by code point in Python, which is the order
        # SPEC section 4 asks for and not the UTF-16 order RFC 8785 asks for.
        out.append("{")
        for index, key in enumerate(sorted(value)):
            if not isinstance(key, str):
                raise Refusal(
                    MALFORMED, f"{key!r} is not a string, and JSON keys are strings"
                )
            if index > 0:
                out.append(",")
            out.append(_write_string(key))
            out.append(":")
            _write(value[key], out, depth + 1)
        out.append("}")
        return
    raise Refusal(
        MALFORMED,
        f"{type(value).__name__} is not a JSON value, and this format writes only "
        "the values both directions can carry",
    )


def _write_string(value: str) -> str:
    out = ['"']
    for character in value:
        point = ord(character)
        if character == '"':
            out.append('\\"')
        elif character == "\\":
            out.append("\\\\")
        elif character in _SHORT_FOR:
            out.append("\\" + _SHORT_FOR[character])
        elif point < 0x20:
            out.append(f"\\u{point:04x}")
        elif 0xD800 <= point <= 0xDFFF:
            raise Refusal(
                MALFORMED,
                f"the string holds the unpaired surrogate U+{point:04X}, and UTF-8 "
                "has no encoding for half a character",
            )
        else:
            out.append(character)
    out.append('"')
    return "".join(out)
