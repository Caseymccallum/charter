"""The words a verdict is made of.

SPEC section 10 names four statuses, three verdicts and sixteen reason codes,
and says which of them may be reworded between releases: the prose may be, and
the reason codes may not. This module is that vocabulary and nothing else, so
that a reason code in this implementation is spelled the way the record spells
it rather than the way a local string literal happened to type it.

Exit codes are SPEC section 12: three belong to a verdict, and the other three
belong to commands that do not produce one.
"""

# The four statuses. SPEC section 10: there is no fifth and no "pass with
# warnings".
PASS = "PASS"
FAIL = "FAIL"
SKIP = "SKIP"
UNSUPPORTED = "UNSUPPORTED"

STATUSES = (PASS, FAIL, SKIP, UNSUPPORTED)

# The three verdicts.
VERIFIED = "VERIFIED"
INCOMPLETE = "INCOMPLETE"
BROKEN = "BROKEN"

# The reason codes. A check that has nothing to report says OK, and a check
# that could not run says why it could not run rather than OK.
OK = "OK"
MALFORMED = "MALFORMED"
MISMATCH = "MISMATCH"
MISSING = "MISSING"
EXTRA = "EXTRA"
DUPLICATE = "DUPLICATE"
NON_CANONICAL = "NON_CANONICAL"
NON_CANONICAL_ENCODING = "NON_CANONICAL_ENCODING"
NON_INTEGER_NUMBER = "NON_INTEGER_NUMBER"
NUMBER_OUT_OF_RANGE = "NUMBER_OUT_OF_RANGE"
DECODE_ERROR = "DECODE_ERROR"
UNSUPPORTED_VERSION = "UNSUPPORTED_VERSION"
UNSUPPORTED_FEATURE = "UNSUPPORTED_FEATURE"
UNKNOWN_FIELD = "UNKNOWN_FIELD"
LIMIT_EXCEEDED = "LIMIT_EXCEEDED"
PREREQUISITE_FAILED = "PREREQUISITE_FAILED"

# The exit codes of a verdict, and the ones that are not one.
EXIT_OF_VERDICT = {VERIFIED: 0, INCOMPLETE: 1, BROKEN: 2}
EXIT_USAGE = 64
EXIT_REFUSED = 65
EXIT_UNREADABLE = 66
EXIT_UNWRITABLE = 73

# The one check whose UNSUPPORTED propagates as its own reason code rather than
# as PREREQUISITE_FAILED: the format version gate of SPEC section 5. It is named
# here rather than in the module that defines the checks so that the reason a
# skip carries can be decided without importing the checks.
VERSION_GATE = "L0.FORMAT.IDENTIFIER"

# The five statements of SPEC section 11, which every verdict carries. They are
# not checks: no amount of care could decide them from the artifact alone.
LIMITATIONS = (
    (
        "INTERMEDIATE_CONTENT_HASHES",
        "Every entry but the last declares a content_sha256 that nothing in the "
        "artifact can confirm: the bytes of an intermediate revision are not in "
        "the file. Only the final revision is bound to content.md.",
    ),
    (
        "KEY_HOLDER_CAN_REWRITE_HISTORY",
        "Whoever holds the private key can replace the last entry, or every "
        "entry, and re-sign the whole log, and this verifier cannot tell that "
        "the earlier bytes ever existed. The chain proves order and continuity, "
        "not uniqueness.",
    ),
    (
        "KEYS_ARE_SELF_DECLARED",
        "The public key travels inside the file it signs, so a valid signature "
        "proves only that the signer held the matching private key. Nothing here "
        "ties a key to a person, an organisation, or a name a reader would "
        "recognise.",
    ),
    (
        "TIMESTAMPS_ARE_CLAIMS",
        "Every timestamp is written by the signer and signed by the signer. "
        "Nothing in the format witnesses a time, so an entry can carry any "
        "instant its author chose.",
    ),
    (
        "CONTENT_IS_NOT_JUDGED",
        "This verifier reads the bytes of content.md and checks that they are "
        "UTF-8 and match the declared digest. It does not interpret them, and a "
        "well-formed artifact can hold content that is false, unlawful, or "
        "worthless.",
    ),
)
