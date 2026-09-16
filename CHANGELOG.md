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

### The adversarial pass, written down before it was run

`test/adversarial.md` is the enumeration, one row per mutation, with the verdict
and the reason codes the specification requires and the observed result beside
it. All 28 rows are committed fixtures in `vectors/`, so the kit grew from 26
cases to 54, and `test/adversarial.test.js` replays the table row by row: a row
fails unless the verifier produces the verdict and the reason codes the row
states, and the recorded Actual column has to agree with the Expected one. Of
37 rows, 37 pass: 11 for the container, 7 for the canonical bytes, 5 for the
content, 6 for the signature and the key, 8 for the chain.

The new fixtures also closed the one gap the plan named as a hole: an entry
whose declared compression method is not the one its bytes are in, in both
directions, and a manifest one byte over the document ceiling.

One row was wrong when it was written, and it was the table that was wrong, not
the spec. `deflate-declared-stored` was expected to fail the declared size and
the declared CRC-32; the verifier also fails `L0.CONTENT.UTF8` (the compressed
bytes are not UTF-8) and `L0.CONTENT.HASH` (they are not the declared digest).
The verifier is right about all four: they are four different claims about the
same bytes, and each of them is false for its own reason. The row was corrected.

### What an empty `content.md` means

SPEC.md section 6 now says it explicitly: `content.md` may be empty. The empty
byte string is valid UTF-8, carries no byte order mark, and has a SHA-256 like
any other byte string. A format whose central claim is that the bytes of the
file are the document does not also get to require that the document say
something. `empty-content` is `VERIFIED` in the kit on purpose.

The rule for an *absent* history is the opposite and unchanged: SPEC.md section
7 makes "at least one entry" its own check (`L0.PROVENANCE.NONEMPTY`), because
an artifact with no history records nothing about where it came from, and
`empty-log` is `BROKEN` on purpose. The question the plan said the spec had to
answer is answered there.

### Timestamps are not ordered

SPEC.md section 11 now states what was already true of the checks: no check
compares two timestamps. An entry whose `timestamp` precedes its parent's is
signed, chained, and `VERIFIED`, and `entry-with-earlier-timestamp` is that case
in the kit. It is recorded rather than repaired, because a rule that timestamps
must increase would catch an author who typed an earlier date while still
failing to catch the key holder who rewrote the entire log — and the second is
the case the format cannot see at all.

### The re-signing case, asserted

`history-rewritten` returns `VERIFIED`, and `test/adversarial.test.js` asserts
exactly that: the verdict, the exit code, no check left unproven, the
`KEY_HOLDER_CAN_REWRITE_HISTORY` caveat present in the verdict, and the caveat
printed by `cli/charter.js` for a person reading the human report. The same file
asserts that a rewritten log and a freshly written one are identical check for
check, which is the gap stated as sharply as it can be.


### The serializer, and four values it wrote silently

The canonical rule had one implementation in two directions, which is no way to
test either. `verifier/canonical-write.js` is now the writing direction on its
own: a value in, the one byte sequence out, sharing this project's specification
and reason vocabulary with `verifier/canonical.js` and no code at all with it.
`test/purity.test.js` asserts the boundary rather than describing it — the
serializer may not import the reader, neither module may name the other's
functions, and each module's exports are exactly its half of the rule.

The writing direction had never been held to the rule it implements, and four
values it wrote were values the reader cannot read back:

| Value passed to the serializer | What it used to write | What it does now |
| --- | --- | --- |
| `new Date()`, a `Map`, a class instance | `{}` — `Object.keys` of a date is `[]` | refused, MALFORMED |
| `-0` | `0` — `String(-0)` loses the sign | refused, NON_INTEGER_NUMBER |
| an array hole, or an array with an extra own property | `[1,,2]`, which is not JSON | refused, MALFORMED |
| a string holding an unpaired surrogate | bytes that decode to U+FFFD, in the *other* string | refused, MALFORMED |

A fifth was the depth ceiling the serializer did not have: a value nested past
64 levels did not produce a deep document, it produced a `RangeError`. It is now
refused with MALFORMED, the reader's code for the same condition, and a value
that contains itself is caught by the same ceiling one level later.

### One value, two spellings, one reason code

The reader tells NON_INTEGER_NUMBER from NUMBER_OUT_OF_RANGE by the *text* it was
handed: `1e0` is refused as a spelling, `9007199254740993` as a range. A value
carries no spelling, so the serializer splits the two codes by *value* instead:
not an integer (including `-0`, `NaN`, `Infinity`), or an integer too large to
write down exactly. `test/canonical.roundtrip.test.js` holds the two directions
to the same code for the same defect, which is the whole point of the pair.

### An unpaired surrogate, spelled either way

The round trip found this one, and neither the fuzz corpus nor the adversarial
table had: the reader refused an unpaired surrogate *escape* (`"\ud800"`) but
accepted the same character written *literally*, because the check lived in the
escape branch of the string scanner. The specification had always said such a
string is not representable — it has no canonical bytes, since UTF-8 cannot
encode half a character — so this was the reader being narrower than its own
rule rather than the rule being wrong. A literal unpaired surrogate is now
MALFORMED like the escape, and the two directions accept exactly the same
strings. No artifact could have contained one: a lone surrogate cannot appear in
valid UTF-8, and bytes that tried would be refused as invalid UTF-8 before the
parser saw them.

### Canonical form is not integrity

`test/canonical.roundtrip.test.js` states, with the bytes, that a hand edit
inside a string leaves a document canonical: change one character of the title,
and `manifest.json` is still exactly what the serializer writes for its (forged)
value, so `L0.MANIFEST.CANONICAL` still passes. What catches the edit is the
container's own CRC-32 and, after it, the signature over the manifest. This was
already true and is now recorded, because the opposite is easy to assume: the
canonical check answers "is this the one byte sequence for its value", never "is
this the value the author wrote".

