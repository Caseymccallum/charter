"""Unpadded base64url, with one spelling per byte string. SPEC section 8.

"The alphabet is the URL-safe one, `=` is not allowed, and a trailing bit
pattern that is not zero (the classic `AB` versus `AA` ambiguity) is refused:
canonical base64url has one spelling per byte string, and this format uses that
one."

Every way a string can fail to be the one spelling of its bytes carries
NON_CANONICAL_ENCODING, whatever the reason it is not: a character outside the
alphabet, a length no byte string can produce (one leftover character), `=`
padding, and a non-zero trailing bit pattern. SPEC section 5 states the rule —
"the string is not the one spelling this format fixes for that value, whatever
the reason it is not" — and names two of the four cases. MALFORMED is not this
module's to report: a string that is not a byte string of the length its
algorithm requires is the *caller's* complaint, because the length is a fact
about the value and not about the alphabet (section 5's second paragraph).

The empty string is not refused here. It is the one spelling of the empty byte
string, and whether a signature may be one is a question about length, which the
check that reads the field answers with MALFORMED.
"""

from __future__ import annotations

from .errors import Refusal
from .vocabulary import NON_CANONICAL_ENCODING

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
            NON_CANONICAL_ENCODING,
            f"{what} is {len(text)} base64url character(s), which no byte string "
            "is spelled with",
        )
    accumulator = 0
    bits = 0
    out = bytearray()
    for character in text:
        value = _INDEX.get(character)
        if value is None:
            raise Refusal(
                NON_CANONICAL_ENCODING,
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
