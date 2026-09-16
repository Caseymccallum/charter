"""Unpadded base64url, with one spelling per byte string. SPEC section 8.

"The alphabet is the URL-safe one, `=` is not allowed, and a trailing bit
pattern that is not zero (the classic `AB` versus `AA` ambiguity) is refused:
canonical base64url has one spelling per byte string, and this format uses that
one."

Three refusals, and the reason codes separate them by what is wrong:

* a character outside the alphabet, or a length no byte string can produce
  (one leftover character), is MALFORMED: those bytes are not base64url at all;
* `=` padding, and a non-zero trailing bit pattern, are NON_CANONICAL_ENCODING:
  the bytes decode, and they are a second spelling of a byte string that
  already has one. Accepting either would mean a public key with two names.

The reason codes for these two cases are not stated per-case in the spec; the
README in this directory records the guess and why this is the reading that
keeps "one spelling per byte string" true.
"""

from __future__ import annotations

from .errors import Refusal
from .vocabulary import MALFORMED, NON_CANONICAL_ENCODING

ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_INDEX = {character: value for value, character in enumerate(ALPHABET)}


def decode(text: str, what: str = "value") -> bytes:
    """Decode canonical unpadded base64url, or refuse it by name."""
    if "=" in text:
        raise Refusal(
            NON_CANONICAL_ENCODING,
            f"{what} carries '=', and charter/0.1 base64url is unpadded",
        )
    if len(text) % 4 == 1:
        raise Refusal(
            MALFORMED,
            f"{what} is {len(text)} base64url character(s), and no byte string "
            "has that spelling",
        )
    accumulator = 0
    bits = 0
    out = bytearray()
    for character in text:
        value = _INDEX.get(character)
        if value is None:
            raise Refusal(
                MALFORMED,
                f"{what} holds {character!r}, which is not a base64url character",
            )
        accumulator = (accumulator << 6) | value
        bits += 6
        if bits >= 8:
            bits -= 8
            out.append((accumulator >> bits) & 0xFF)
    if bits > 0 and (accumulator & ((1 << bits) - 1)) != 0:
        raise Refusal(
            NON_CANONICAL_ENCODING,
            f"{what} ends on a non-zero trailing bit pattern, so these bytes "
            "have a second spelling",
        )
    return bytes(out)


def encode(data: bytes) -> str:
    """The one base64url spelling of these bytes, without padding."""
    accumulator = 0
    bits = 0
    out = []
    for byte in data:
        accumulator = (accumulator << 8) | byte
        bits += 8
        while bits >= 6:
            bits -= 6
            out.append(ALPHABET[(accumulator >> bits) & 0x3F])
    if bits > 0:
        out.append(ALPHABET[(accumulator << (6 - bits)) & 0x3F])
    return "".join(out)
