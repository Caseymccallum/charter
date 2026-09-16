# Changes

Recorded because they are decisions about published behaviour, not internal
tidying. The format identifier in `manifest.format` changes when section 14 of
[SPEC.md](SPEC.md) changes; this file records what changed, when, and why.

## Unreleased — charter/0.1, the producer

The format is unchanged. `producer/**` and four verbs were added, and the
decisions below are decisions about published behaviour: what `charter seal`
writes, what it refuses, and what a citation says. SPEC.md gains section 15,
which states that the producer is a reference implementation rather than part of
the format.

### The producer writes through the verifier's own writer

`seal` was written last for a reason, and the first thing it was given was not a
ZIP writer of its own. The manifest and every provenance line are written with
`canonicalDocument()`, the signature covers exactly what `signingInput()` returns,
and the key id comes from `deriveKeyId()` — the same functions the verifier calls
to check those bytes. This is the opposite of the arrangement in
`vectors/build.js`, which stays independent on purpose, and the difference is the
point: the kit is a second opinion about the format, while the producer is the
other half of the implementation. Two derivations of one key id, or two writers of
one canonical byte sequence, would agree until they did not, and the disagreement
would be about the identity of a signer.

### A seal states no time unless it is told one

`charter seal content.md --key key.pem -o out.charter` is reproducible: the same
content and the same key produce the same bytes, on every run. That could not be
true if the producer stamped a clock by default, and section 3.6 already removed
the clock from the container for exactly this reason — a file whose bytes are the
record cannot also carry a reading of a clock. So the time is an argument:
`--created-at` states one, `--now` states that the time is now, and with neither
the manifest's `created_at` and the entry's `timestamp` are `1980-01-01T00:00:00Z`
— the instant the container's fixed DOS stamp already means, so a file that states
no time says so in both places rather than in one. `producer/**` contains no clock
read at all, and `test/producer.test.js` checks that it, like the verifier, reads
nothing but a key from outside a byte array.

Entries are stored, never deflated, for the same reason: zlib's output changes
between library versions, so a compressed entry would tie the bytes of an artifact
to the version of the compressor that wrote it.

### Two exit codes, and neither is a verdict

`seal`, `inspect`, `cite` and `keygen` add `65` (the input was refused, and the
refusal carries a reason code) and `73` (the output file could not be created).
They reuse `64` and `66`. `verify` is unchanged: `0`, `1`, `2`, `64`, `66`, and
only `0` is a pass. Section 14 changes a version when a *verdict* changes, and
these two codes belong to commands that do not produce one — so the format
identifier does not move.

### Where a title comes from, and why the answer is three-valued

`cite` was deferred in Phase 1 because a `.charter` file offers three different
titles and they are not interchangeable: one the caller states, one inside
`content.md` (covered by the digest the identifier names), and one in
`manifest.title` (signed, but outside that digest). The decision is to use all
three, in that order of precedence, and to say which one was used — in
`custom.charter.title_source` and `title_origin` — rather than to pick one and
keep quiet. A stated title wins because the person citing is the one citing; a
captured title wins over the manifest's because it sits inside the bytes the claim
hash covers. `seal` derives a title the same way and falls back to the content
file's name, which is not in the document, only because `manifest.title` is
required and a placeholder the producer invented would be worse. The derivation
locates a `<title>` element or the first ATX heading and nothing else: no Markdown
parsing enters the project, and no entity is decoded.

### `charter keygen` exists, and does one thing

`seal --key` reads a PKCS#8 PEM, and the usual way to make one is
`openssl genpkey -algorithm ed25519`, which assumes a tool the reader may not
have. `keygen` writes that one file with `node:crypto`, prints the key id it
derives from it, and keeps no store, no lookup, and no copy. The README's
deliberate absence of "key generation, storage, or lookup" still holds for the
last two; the first is now a verb because the alternative was a documented command
that does not run where `openssl` is not installed.

### A sealed file, attacked the way the kit attacks a hand-built one

`test/producer.test.js` replays the adversarial cases that apply to a single-entry
artifact against a file `seal` wrote, and compares the failing checks with the
reason codes `vectors/expected.json` already records for the same attack. The
comparison is exact for `content-tampered` and `bad-manifest-signature`, and exact
for `entry-edited` once its chain-link failure is set aside — that fixture has two
entries, so its stale signature also breaks the link to the entry after it, and a
one-entry artifact has no entry after it. Nothing else differed, and the verifier
was not changed to make any of them agree.

One difference is a property of the *attack* rather than of the producer. The
kit's `content-tampered` fixture rebuilds the archive correctly around a changed
document, so the digest is the only check that fails. A byte changed **in place**
in a sealed file is noticed by the container first: entries are stored, so the
bytes a stored entry's CRC-32 covers are exactly the bytes that changed, and
`L0.ZIP.CRC32` fails beside `L0.CONTENT.HASH`. The verdict is `BROKEN` either way
and the digest check the fixture is about still fails; a longer list of reasons is
not a weaker refusal.

### The generator anomaly: unreproduced, recipe recorded, not gating

While the pushed commit was being validated in a fresh clone, one batch ran a
clone's test suite and the deletion of that clone at the same time and printed
`# tests 0` beside a module-not-found crash. Run with the clone alive and the
commands in order, the same suite reported 83 of 83 on the pinned floor, and it has
not reproduced since — including the 111 tests and the 54-case kit replay run
sequentially for this change. The recipe is recorded so that a reader can tell it
apart from a real failure of the suite: if `# tests 0` appears next to a missing
module, find out what else the shell was doing before believing it. Nothing is
gated on it, and nothing in the project was changed for it.

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

