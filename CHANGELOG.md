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

### Limits: a ceiling for one JSON document

`manifest.json` was bounded only by the 64 MiB entry limit, which bounds memory
but not work: a 64 MiB manifest is a manifest no reader wants and every reader
must parse. SPEC.md section 3.7 now declares a ceiling of 1 MiB for one JSON
document — the manifest, or one line of `provenance.jsonl`, which already had
the same number under another name — and `verifier/canonical.js` enforces it
before decoding, so an oversize document is refused with `LIMIT_EXCEEDED` rather
than parsed slowly. `verifier/limits.js` says why every ceiling is checked
before the work it bounds rather than after.

### The parser: one defect found and fixed

`verifier/canonical.js` is now documented by its shape, because it is the most
load-bearing component in the project: a single recursive-descent scan that
validates while it reads, records the first violation, and stops. There is no
token stream and no second pass.

Writing the fuzz cases against SPEC.md section 4 found a defect. The parser
tolerated whitespace around the document and between the members of an object,
and not after a colon or a comma. So a pretty-printed manifest was refused as
`MALFORMED` at `L0.MANIFEST.PARSE`, while section 4 promises that whitespace and
key order are tolerated *while parsing* so that a violation can be reported as
"well-formed JSON, but not the canonical bytes for it" (`NON_CANONICAL`, at
`L0.MANIFEST.CANONICAL` or `L0.PROVENANCE.CANONICAL`). Two checks with different
meanings were answering the same question, and the one that answered was the
wrong one. The parser now skips whitespace before every value, and
`test/parser.fuzz.test.js` pins the behaviour in every position.

### A fuzz suite, and the property above it

`test/parser.fuzz.test.js` covers the cases the parser has to get right and no
reader would notice it getting wrong: duplicate keys by name (`DUPLICATE`, not
`NON_CANONICAL`), floats in every position (`1.0`, `1e2`, `1E2`, `1e+2`, `-0.0`,
`0.5`, `1.`, `.1` — refused, never coerced), unpaired surrogate escapes, key
ordering by code point rather than UTF-16 code unit (the case no English fixture
can catch: `U+1F600` sorts *after* `U+FFFF` by code point and *before* it by
UTF-16), whitespace in every position with exactly one LF required, depth at the
ceiling where 200,000 levels of nesting is a refusal rather than a `RangeError`,
and the byte ceiling for one document.

Above every individual case is the property the whole verifier answers to: **no
input, valid or hostile, throws.** The file ends by feeding a corpus of hostile
text to the parser and a corpus of hostile bytes to `verify()`, including a
declared limit of one byte, and requires a verdict with a status and a reason
code from the declared vocabulary every time.

