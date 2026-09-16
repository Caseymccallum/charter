# Changes

Recorded because they are decisions about published behaviour, not internal
tidying. The format identifier in `manifest.format` changes when section 14 of
[SPEC.md](SPEC.md) changes; this file records what changed, when, and why.

## Unreleased — charter/0.1, verifier hardening

### Exit codes: five, not three

The brief for this project said three exit codes: `0` verified, `1` not, `2`
broken. SPEC.md section 12 defines five: `0` VERIFIED, `1` INCOMPLETE, `2`
BROKEN, `64` the command line was not understood, `66` the named file could not
be read. The divergence is deliberate, and the brief was a placeholder.

Three codes could not distinguish two things a caller has to distinguish:

- **a file that is not there** is not a broken artifact. Reporting `2` would
  claim the verifier examined bytes it never read.
- **a file whose rules this verifier does not implement** is not broken either.
  `INCOMPLETE` means nothing was proven false and something was not established.
  `64` and `66` follow `EX_USAGE` and `EX_NOINPUT` from `sysexits.h`, which is
  what a shell script author already expects.

Nothing about *a verdict* changed: `VERIFIED`, `INCOMPLETE` and `BROKEN` are
unchanged, and only `0` is a pass.

### Node floor: 20.12, not 20

`engines.node` was `>=20`, which the README restated as "Node 20 or later". Both
were a claim rather than a measurement. Measured, on real runtimes:

| Facility | First version that has it |
| --- | --- |
| `globalThis.crypto.subtle` (hashing, Ed25519) | 20.0.0 |
| `DecompressionStream('deflate-raw')` | 20.12.0 |

Node 18.20 has neither: `globalThis.crypto` is absent, so every digest and every
signature is `UNSUPPORTED`, and `deflate-raw` is rejected. Node 20.0 through
20.11 have Ed25519 and not `deflate-raw`, so `valid-deflate.charter` cannot be
read and the conformance kit cannot pass. `engines.node` is now `>=20.12.0`, the
README says Node 20.12, and SPEC.md section 12 says why.

Verified on the floor itself: `node --test` (no path, so the runner's own
discovery is under test) reports 47 tests passing, and `node vectors/run.js`
replays 26 cases with no mismatch.

