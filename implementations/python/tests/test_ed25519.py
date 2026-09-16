"""Ed25519, implemented twice on purpose.

The arithmetic in `charter_verify/ed25519.py` is RFC 8032 written out rather
than imported. These tests hold it to the RFC's own test vector, to the
signatures in the kit, and — when `cryptography` happens to be installed — to
that library, which is the only place a shared dependency is useful: in the test
that quizzes both, not in either implementation.
"""

from __future__ import annotations

import unittest

from charter_verify import base64url, canonical, documents, ed25519

from .support import fixture_parts

# RFC 8032, section 7.1, TEST 1: the empty message.
PUBLIC_KEY = bytes.fromhex(
    "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
)
SIGNATURE = bytes.fromhex(
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
)

try:  # pragma: no cover - the point is that it is optional
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    HAVE_CRYPTOGRAPHY = True
except ImportError:  # pragma: no cover
    HAVE_CRYPTOGRAPHY = False


class ArithmeticTest(unittest.TestCase):
    def test_the_rfc_8032_test_vector(self) -> None:
        self.assertTrue(ed25519.verify(PUBLIC_KEY, SIGNATURE, b""))
        self.assertFalse(ed25519.verify(PUBLIC_KEY, SIGNATURE, b"x"))

    def test_a_flipped_bit_in_the_signature_does_not_verify(self) -> None:
        broken = bytearray(SIGNATURE)
        broken[0] ^= 0x01
        self.assertFalse(ed25519.verify(PUBLIC_KEY, bytes(broken), b""))

    def test_a_flipped_bit_in_the_key_does_not_verify(self) -> None:
        broken = bytearray(PUBLIC_KEY)
        broken[31] ^= 0x80
        self.assertFalse(ed25519.verify(bytes(broken), SIGNATURE, b""))

    def test_a_key_or_a_signature_of_the_wrong_length_is_not_a_signature(self) -> None:
        self.assertFalse(ed25519.verify(PUBLIC_KEY[:31], SIGNATURE, b""))
        self.assertFalse(ed25519.verify(PUBLIC_KEY, SIGNATURE[:63], b""))
        self.assertFalse(ed25519.verify(PUBLIC_KEY, SIGNATURE + b"\x00", b""))

    def test_a_scalar_above_the_group_order_is_refused(self) -> None:
        """S is checked against L, as RFC 8032 requires."""
        huge = bytearray(SIGNATURE)
        huge[32:] = (2**256 - 1).to_bytes(32, "little")
        self.assertFalse(ed25519.verify(PUBLIC_KEY, bytes(huge), b""))

    def test_the_kit_signatures_verify(self) -> None:
        parts = fixture_parts()
        manifest = documents.read_manifest(
            canonical.parse_document(parts["manifest.json"])
        )
        public_key = base64url.decode(manifest.public_key_text, "public_key")
        self.assertTrue(
            ed25519.verify(
                public_key,
                base64url.decode(manifest.signature_text, "signature"),
                canonical.signing_input(manifest.value),
            )
        )
        for line in parts["provenance.jsonl"].split(b"\n"):
            if not line:
                continue
            value = canonical.parse_document(line)
            entry = documents.read_entry(value, line)
            self.assertTrue(
                ed25519.verify(
                    public_key,
                    base64url.decode(entry.signature_text, "signature"),
                    canonical.signing_input(value),
                )
            )

    @unittest.skipUnless(HAVE_CRYPTOGRAPHY, "cryptography is not installed")
    def test_cryptography_agrees_about_every_signature_in_the_kit(self) -> None:
        parts = fixture_parts()
        manifest = documents.read_manifest(
            canonical.parse_document(parts["manifest.json"])
        )
        key = Ed25519PublicKey.from_public_bytes(
            base64url.decode(manifest.public_key_text, "public_key")
        )
        key.verify(
            base64url.decode(manifest.signature_text, "signature"),
            canonical.signing_input(manifest.value),
        )
        for line in parts["provenance.jsonl"].split(b"\n"):
            if not line:
                continue
            entry = documents.read_entry(canonical.parse_document(line), line)
            key.verify(
                base64url.decode(entry.signature_text, "signature"),
                canonical.signing_input(entry.value),
            )

    def test_available_is_true(self) -> None:
        """SPEC section 8's UNSUPPORTED path is unreachable here, and says so."""
        self.assertTrue(ed25519.available())


if __name__ == "__main__":
    unittest.main()
