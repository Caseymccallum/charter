# Changes

Recorded because they are decisions about published behaviour, not internal
tidying. The format identifier in `manifest.format` changes when section 14 of
[SPEC.md](SPEC.md) changes; this file records what changed, when, and why.

## Unreleased — the spec, before anyone else reads it

Ten findings from the two passes before this one are settled in
[SPEC.md](SPEC.md), and exactly one of them changed a reason code. The version
string is still `charter/0.1`, no artifact in `vectors/` is a different file than
it was, the 54 recorded verdicts are the ones they were, and both implementations
still replay 54 of 54 and 20 of 20. What changed is what the document says about
the ten places a third implementer would otherwise have had to guess, and that is
the point of doing it now: a third implementation written against an ambiguous
rule freezes the ambiguity.

### The reason code an absent field carries

The finding the probe turned up is the one with a code change behind it. An entry
with no `content_sha256` at all was reported `NON_CANONICAL_ENCODING` by
`L0.PROVENANCE.CONTENT_HASH_FORMAT` — a code whose own vocabulary entry says "a
field encoding is not the canonical encoding of the value it carries" — while the
check's sentence said "absent (MISSING)" and section 10 defines `MISSING` as "a
required thing is absent". Both implementations agreed, which is why a
differential harness could not see it: two readings that are wrong the same way
agree about everything, including the mistake. It is the first finding in this
project that was a bug in the reference rather than a silence in the spec.

Both implementations now report `MISSING`, and so does `L0.PROVENANCE.FIELDS` for
the same absent field — the same fact, one code, in the two checks that required
the value. That second one is not a second change of mind: `L0.MANIFEST.FIELDS` in
the reference had been reporting `MISSING` for an absent manifest field since it
was written, the log's FIELDS was the outlier with a constant `MALFORMED`, and
the port's manifest path was an outlier in the other direction. Leaving those
alone would have recorded two codes for one absence in the one fixture this pass
rebuilds, and a third implementer reading section 10 would have had to pick one.

`git diff -- verifier/` for this pass is two call sites and their comments: the
code each check passes to the reporter comes from the field's own reader instead
of being written at the call site. No check's logic changed, no status changed, no
verdict changed, and no exit code changed. The port's half is the same rule in
`documents.py` (absence is `MISSING` where a required field is not there) and
`checks.py` (the digest check reads the state of the field).

### The fixture, and what was not rebuilt

`vectors/probe/out/log-line-not-canonical.charter` is the same 984 bytes with the
same SHA-256 it had: the recipe did not change, only the recorded answer, which
now carries `MISSING` for the two checks instead of a spelling code. The probe's
`asked` for that case now states the answer the format requires, so `--build`
refuses to record anything else — which is how the finding was found in the first
place, and the mechanism that keeps it settled. `vectors/expected.json` and all 54
artifacts are untouched; `vectors/probe/expected.json` is the only file in
`vectors/` this pass changed. `implementations/python/tests/test_spec_gaps.py`
freezes the answer, and `test_container.py` and `test_documents.py` had three
assertions that said MALFORMED for an absent field; they say MISSING now.

### The rules the code was already following, now written down

Nine of the ten are specification issues rather than code issues, and this pass
made the document say what the implementations do:

- **Which code `01` carries** — `NON_INTEGER_NUMBER`, with `1.0`, `1e0` and `-0`.
  §4.1 had already stated it; the pass confirmed the sentence and the code agree.
- **What `L0.PROVENANCE.NONEMPTY` counts** — entries, not lines. §7 said so; the
  row for the check in §10 now says it too, because the row is where a reader
  looks up what "at least one" means.
- **Which copy of a duplicated entry name is read** — the one whose local header
  comes first. §2 had the sentence and §3.4 now carries the rule and the reason
  behind it: the layout rule does not catch a duplicate, and a reader that took
  the last copy could report the same duplicate as every other reader and still
  disagree about the document.
- **What a skipped check carries** — `PREREQUISITE_FAILED`, except after the
  version gate, where it carries `UNSUPPORTED_VERSION`. Unchanged in §10.1.
- **The dependency graph** — §10.1 stated it as a table of what is skipped when
  what fails, which is a table of consequences, and as a set of counts a reader
  could only reproduce by memorising. It now states the rule: every check reads a
  fact, a fact has one check that establishes it, and a check whose fact never
  arrived is SKIP — and the count an artifact records is that rule applied to that
  artifact rather than a number an implementation may carry. The facts are named
  per entry, so the arithmetic ("an archive with no `manifest.json` leaves twelve
  checks unrun") is something a reader can do. A sentence the old table needed and
  did not have: the gate is the fact, not the status — `L0.ZIP.ENTRY_SET` fails
  for a duplicate or an extra entry and nothing is skipped, because the fact the
  other checks need still holds.
- **`NON_CANONICAL_ENCODING`** — its rule was "a second spelling of the same
  bytes", which is not what either implementation does and not what a fixture
  records: `signature-padded` is `NON_CANONICAL_ENCODING` for a string that
  decodes to nothing, and a digest of 63 characters is `NON_CANONICAL_ENCODING` in
  both implementations while §5's table said MALFORMED. The table and the
  paragraphs under it now say what both readings do: `NON_CANONICAL_ENCODING`
  when a string is not the one spelling this format fixes for its value,
  MALFORMED when a value is not a string or decodes to a wrong length for its
  algorithm, `MISSING` when it is not there at all.

The one place this pass edited a sentence rather than adding one is that §5
table, and the reason is worth recording: its MALFORMED column was already
contradicted by a recorded answer, so leaving it would have left the document
contradicting its own kit in exactly the area this pass was asked to settle. No
behaviour changed with it — both implementations already answered the way the
table now reads, and `test_spec_gaps.py` freezes the two digests the kit does not
contain.

### The two contracts that are not about a file

§12.1 now says what kind of requirement the `--json` shape is. It is not a rule
about `.charter` files: nothing in sections 2 to 9 needs a command line, and a
reader that prints nothing is a conforming reader. It is a contract between
implementations, and what makes it binding is that conformance is recorded through
it — the kit compares the verdict, the exit code, the failing and unsupported
checks with their reason codes, and the number of checks never reached, and every
one of those is a value in that object. An implementation that has a command line
prints that shape; one that has no command line is not missing a requirement.

`test/spec.test.js` is new, and it exists because the vocabulary is the one part
of this document that is also code. It reads §10 and compares it with
`verifier/status.js` in both directions: every reason code the section names is
declared, every code the module declares is named, and the section's 30 check ids
are the registry's 30 and no others. The last of those would have caught
`L0.MANIFEST.FORMAT`, which §5's table named and no registry ever had. The first
two would have caught `NON_CANONICAL_ENCODING` sitting in the vocabulary with no
rule that could produce it.

## Unreleased — the probe, and the editor

The format is unchanged, and so is every recorded answer: the 54 verdicts in
`vectors/expected.json` are the ones they were, and `node vectors/run.js` still
replays 54 of 54. What was added is the differential probe and its fixtures,
which turns the claim "20 hand-built artifacts agree" into something a fresh
clone can re-run; `editor/`, which shows the format's claim in a browser; and two
moves inside the implementation, so that a second browser-safe writer can write
what the first one writes instead of writing its own.

### The probe is committed, and it is a program rather than a paragraph

`vectors/probe/` holds 20 artifacts, the answers the reference command line gives
for them, and `vectors/probe/run.js`, which asks the reference and the Python
implementation and compares both with the record — the five things the kit
compares, each artifact's length and digest first, and the Python leg skipped
with a sentence on a machine that has no interpreter rather than failing. The
recipes and the record builder are in `implementations/python/tools/probe.py`,
which refuses to write a record whose answer contradicts the question the case
asks: an artifact whose recorded answer is not the answer the format requires is
a broken fixture, and settling that is a job for SPEC.md rather than for a record
overwrite.

Committing it found two things the scratch run in `%TEMP%` could not. A log entry
with **no** `content_sha256` is reported as `NON_CANONICAL_ENCODING`, whose
definition is a value spelled a second way, while the reference's own sentence
for the same failure says the value is absent — and the vocabulary has MISSING
for exactly that. Both implementations agree, so it is not a divergence; it is a
place where section 10's vocabulary and one check's wording could be brought
together, and `implementations/python/tests/test_spec_gaps.py` freezes the answer
so that a later change has to be made deliberately. And the port's CLI wrote a
verdict as **nothing at all** when its stdout was a pipe and the artifact's title
was U+1F600: on Windows, Python encodes text with the console code page when it
is not writing to a console, and raises on the first character outside it. The
reference never noticed, because `process.stdout.write` is UTF-8. `cli.py` now
writes UTF-8 explicitly, and `implementations/python/tests/test_cli.py` holds it
there. Neither is a change to the format: the first is written down and frozen,
the second was a bug in a program, which is the other thing a differential
harness is for.

### Two writers moved into `verifier/**`, and why the directory allows it

`producer/zip-write.js` is now `verifier/zip-write.js` and `producer/base64url.js`
is now `verifier/base64url-write.js`, with one new module beside them,
`verifier/refuse.js`, which is the writing half's way of refusing with a name from
the shared vocabulary. The editor seals documents in a page, so it needs a
container writer and a base64url encoder, and it may not import `producer/**`:
that directory holds `node:crypto` and the file system, and a page cannot load
either. The alternative was a second ZIP writer and a second base64url encoder,
which is a second place for the container's rules to be written down. So the
shared halves live where a browser can reach them, and the rule that keeps the
verifier honest is now stated rather than implied: `test/purity.test.js` walks the
imports of `verify.js` and fails the run if a writer is reachable from a verdict.
The producer is unchanged in what it writes — every sealed file is the same bytes
— and `test/producer.test.js` now says which refusals are the producer's and which
are the shared writer's. `git diff -- verifier/` is no longer 0 lines, for the
first time since the verifier was frozen; the 54 recorded answers are, byte for
byte, unaffected.

### The editor is a demonstration, and it is held to that

`editor/index.html` shows a `.charter` file's claim beside the document it is
about: the verdict, every check with its reason code, the content as the bytes
are, the history with its timestamps marked as claims, and the five statements of
what a `VERIFIED` verdict does not mean — so that `history-rewritten`, which
verifies and is a rewritten history, says both things on one screen. The write
pane seals one document with a key the user pastes, using Web Crypto for the
signature and the verifier's own writers for everything else.

It has no sync, no account, no store, no key storage, no build step, no
dependency, and no network request, and `test/editor.test.js` asserts all of that
statically and then runs the page in a headless browser: all 54 artifacts through
the browser's copy of the verifier with every check status compared, the read pane
on four fixtures, and a seal whose bytes are compared with the bytes
`charter seal` writes for the same inputs — which are the same bytes, and also the
same bytes Chrome, Edge and Firefox each produced independently of the command
line.

One thing it needs that the brief did not expect: **a page that imports
`verifier/**` cannot be opened from `file://`.** Chrome 153 refuses it — "Cross
origin requests are only supported for protocol schemes: chrome,
chrome-extension, chrome-untrusted, data, http, https, isolated-app" — and so does
every other browser that implements modules. The fix is not a bundler and not a
copy of the verifier inside the page: `editor/serve.mjs` is a courier that serves
this repository on loopback and nothing else, the page says so in the browser's
own words when it is opened from `file://`, and `python -m http.server` works just
as well. No module was added to the format's implementation for it.

### The README's list of deliberate absences lost one line

"An editor" was on it. It is not any more: an editor exists, it is `editor/`, and
the row now says what it is instead — one static page that reads and seals a file,
stores nothing, and could not be a product if it tried.

## Unreleased — charter/0.1, a second reading

The format is unchanged, and so is every recorded answer: the 54 verdicts in
`vectors/expected.json` are the ones they were, `verifier/**` is untouched, and
`node vectors/run.js` still replays 54 of 54. What was added is
`implementations/python/`, a verifier for the same spec written in Python by a
reader who did not read `verifier/**`, and the amendments below, which are what
writing it found. A specification read twice is either a specification or a
description of one program; these are the places it turned out to be the second.

### A second implementation, with nothing shared

`implementations/python/charter_verify/` implements canonical JSON in both
directions, the ZIP walk, the manifest and log field rules, the provenance chain,
the check semantics, and Ed25519 itself — RFC 8032 in pure Python, so that not
even the crypto library is a shared dependency. It replays the same kit through
its own comparison, and its replay installs an audit hook that fails the run if a
file under `verifier/` is ever opened. The first run scored 54 of 54.

### The spelling of a value was on the wrong check

Section 5's table gave `L0.MANIFEST.FIELDS` the jobs of "64 lowercase hex
characters", "unpadded base64url" and "decoding to 64 bytes". The kit had already
recorded the counter-example: `manifest-signature-truncated` expects exactly one
failure, on `L1.MANIFEST.SIGNATURE`, with no check skipped — impossible for a
verifier that measures the signature in FIELDS, because FIELDS would fail first
and everything downstream would be skipped after it. The rules now sit where the
values are read: `L0.CONTENT.HASH` and `L2.CHAIN.HEAD_MATCHES_CONTENT` for
`content.sha256`, `L0.PROVENANCE.CONTENT_HASH_FORMAT` for a log digest,
`L1.MANIFEST.KEY_ID` for the public key, `L1.MANIFEST.SIGNATURE` and
`L1.PROVENANCE.SIGNATURES` for the signatures. MALFORMED means a value that does
not decode or has the wrong length; NON_CANONICAL_ENCODING means the same bytes
spelled a second way, and now has a rule that produces it — an uppercase digest,
`=` padding, a base64url tail whose trailing bits are not zero. Until this pass,
`NON_CANONICAL_ENCODING` was in the vocabulary of section 10 and in no rule at
all, which this document's own first paragraph does not allow.

### `format` belongs to the check that runs before the fields

`L0.FORMAT.IDENTIFIER` reports a `format` that is absent as MISSING and one that
is not a string as MALFORMED, and `L0.MANIFEST.FIELDS` no longer owns the field.
The two readings disagreed about this, and about nothing else that a fixture
covers; the spec now says which one is the format. Section 5 also named the
check `L0.MANIFEST.FORMAT`, which was never one of the 30 ids in section 10's
registry: the table was written before the registry and not updated.

### What a check depends on is part of the format

`vectors/expected.json` records the number of checks each artifact never reached,
so the prerequisite graph is a published fact rather than an implementation
detail, and section 10.1 now states it: which check owns a failure, what is
skipped because of it, and the one place where a skip carries a reason other than
PREREQUISITE_FAILED — after the version gate, where it carries
UNSUPPORTED_VERSION, so that "nobody read the rules for this version" stays
distinguishable from "the rules were read and something in them broke". Two edges
of that graph run backwards in the registry order, which is why the prose needed
a table rather than an inference.

### Three smaller decisions, and the shape of the verdict

`01` is a NON_INTEGER_NUMBER, with `1.0`, `1e0` and `-0`; section 4.1 had listed
five violations and named the reason for four. `L0.PROVENANCE.NONEMPTY` counts
entries rather than lines, so a log whose only line is `[1,2]` has none and the
line is PARSE's complaint. A name that appears twice is refused, and the checks
that follow read the copy whose local header comes first in the file. And section
12.1 writes down the shape of `--json` — the keys, the five `summary` counts, and
when `artifact` is `null` — which the reference CLI had been defining by example.

### The JSON sort was not the trap the brief expected

`json.dumps(sort_keys=True)` sorts with Python's own string comparison, which is
by code point, so the U+1F600-versus-U+FFFF case from the reference's fuzz corpus
agrees with section 4 in Python by accident of the type system rather than by
reading the rule. `ensure_ascii` and `separators` are wrong by default and are
still traps; the sort is not one, and the port's tests say so instead of asserting
a bite that never came.

### What the exercise found, in one place

`implementations/python/README.md`. It records the kit result, the six places
the spec was silent, the two places it contradicted itself, the four guesses no
fixture reaches, and the answer to the question the exercise was built to ask:
the 54 artifacts and their recorded answers are sufficient on their own — the
reference implementation's source was never read, and `git diff -- verifier/` is
0 lines.

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

