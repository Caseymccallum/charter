"""charter/0.1, read a second time.

An independent verifier for the `.charter` format, written from `SPEC.md` by a
reader who did not read `verifier/**`. It shares no code with the reference
implementation and no library-level cryptography: the canonical JSON rules, the
container walk, the manifest and log field rules, the chain, and the Ed25519
arithmetic are all implemented here.

    python -m charter_verify file.charter --json
    python -m charter_verify.kit                  # replay vectors/expected.json

The `README.md` beside this package is the finding the port was written to
produce: what was hardest, and where the spec was silent enough that a reader
had to guess.
"""

from .verify import verify

__all__ = ["verify"]
