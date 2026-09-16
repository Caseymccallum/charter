"""A function from bytes to a verdict. SPEC section 12.

"`test/purity.test.js` enforces the architectural rule that makes any of this
worth trusting: nothing under `verifier/**` may import `node:`, read a file,
touch the network, or consult a clock. The verifier is a function from bytes to
a verdict."

Everything in this package except `cli` and `kit` holds that rule, and
`tests/test_purity.py` checks it the same way the reference checks its own.
"""

from .verdict import Verdict


def verify(data: bytes) -> Verdict:
    """The verdict for these bytes, and nothing else.

    A byte array in, a verdict out; no path, no clock, no randomness, no second
    read of anything. Two runs over one artifact are byte-identical, which is
    what makes the recorded answers in `vectors/expected.json` comparable at
    all.
    """
    return Verdict(data)
