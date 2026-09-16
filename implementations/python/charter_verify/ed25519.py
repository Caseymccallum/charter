"""Ed25519, and the key id that names a key. SPEC section 8.

One algorithm, `ed25519`. A public key is 32 bytes and a signature is 64, both
written as unpadded base64url, and a key id is *derived* rather than declared:

    key_id = "ed25519:" + lowercase hex SHA-256 of the 32 public key bytes

The verification below is RFC 8032 section 5.1.7 written out rather than
imported. The brief for this implementation allows `cryptography` or PyNaCl for
Ed25519, and this implementation declines both: a port whose signatures are
checked by the same library the reference could have used is not a second
reading of the rule, and the whole exercise is to find out whether the rule is
a rule. `tests/test_ed25519.py` cross-checks this arithmetic against
`cryptography` when that package is installed, which is the useful place for a
shared dependency to sit: in the test that quizzes both, not in either one.

`available()` is true here and is not a decoration. SPEC section 8 says that if
a runtime cannot verify Ed25519 the checks report UNSUPPORTED, "because
verification that did not happen is not verification that succeeded" — and a
runtime that has the arithmetic always can.
"""

from __future__ import annotations

import hashlib

P = 2**255 - 19
L = 2**252 + 27742317777372353535851937790883648493
D = -121665 * pow(121666, P - 2, P) % P
SQRT_M1 = pow(2, (P - 1) // 4, P)

Point = tuple  # (X, Y, Z, T), extended coordinates: x = X/Z, y = Y/Z, xy = T/Z

NEUTRAL: Point = (0, 1, 1, 0)


def available() -> bool:
    """Whether this runtime can verify Ed25519 at all."""
    return True


def derive_key_id(public_key: bytes) -> str:
    """The derivation of SPEC section 8, and the only way a key gets a name."""
    return "ed25519:" + hashlib.sha256(public_key).hexdigest()


def verify(public_key: bytes, signature: bytes, message: bytes) -> bool:
    """Whether this signature is over these bytes, by this key.

    A key or a signature of the wrong length is not a signature that failed; it
    is not a signature, and the caller reports MALFORMED for it. This function
    answers False, and the check that called it knows which of the two it has
    because it measured the lengths before it asked.
    """
    if len(public_key) != 32 or len(signature) != 64:
        return False
    point = _decode_point(public_key)
    if point is None:
        return False
    scalar = int.from_bytes(signature[32:], "little")
    if scalar >= L:
        return False
    first = _decode_point(signature[:32])
    if first is None:
        return False
    challenge = int.from_bytes(
        hashlib.sha512(signature[:32] + public_key + message).digest(), "little"
    ) % L
    return _same_point(_mul(_BASE, scalar), _add(first, _mul(point, challenge)))


def _recover_x(y: int, sign: int) -> int | None:
    """The x that belongs to this y, or None when no point has this y."""
    if y >= P:
        return None
    xx = (y * y - 1) * pow(D * y * y + 1, P - 2, P) % P
    if xx == 0:
        return None if sign else 0
    x = pow(xx, (P + 3) // 8, P)
    if (x * x - xx) % P != 0:
        x = x * SQRT_M1 % P
    if (x * x - xx) % P != 0:
        return None
    if (x & 1) != sign:
        x = P - x
    return x


def _decode_point(data: bytes) -> Point | None:
    """RFC 8032 section 5.1.3: 32 bytes to a point, or None."""
    if len(data) != 32:
        return None
    value = int.from_bytes(data, "little")
    sign = (value >> 255) & 1
    y = value & ((1 << 255) - 1)
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % P)


def _add(first: Point, second: Point) -> Point:
    x1, y1, z1, t1 = first
    x2, y2, z2, t2 = second
    a = (y1 - x1) * (y2 - x2) % P
    b = (y1 + x1) * (y2 + x2) % P
    c = t1 * 2 * D * t2 % P
    d = z1 * 2 * z2 % P
    e, f, g, h = b - a, d - c, d + c, b + a
    return (e * f % P, g * h % P, f * g % P, e * h % P)


def _mul(point: Point, scalar: int) -> Point:
    out = NEUTRAL
    while scalar > 0:
        if scalar & 1:
            out = _add(out, point)
        point = _add(point, point)
        scalar >>= 1
    return out


def _same_point(first: Point, second: Point) -> bool:
    x1, y1, z1, _ = first
    x2, y2, z2, _ = second
    return (x1 * z2 - x2 * z1) % P == 0 and (y1 * z2 - y2 * z1) % P == 0


_BASE = _decode_point(
    (4 * pow(5, P - 2, P) % P | (0 << 255)).to_bytes(32, "little")
)
