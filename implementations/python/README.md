# A second reading of charter/0.1

A verifier for `.charter` files, written in Python from [`SPEC.md`](../../SPEC.md)
by a reader who did not read [`verifier/**`](../../verifier). It shares no code
with the reference and no library-level cryptography: the canonical JSON rules,
the ZIP walk, the field rules, the provenance chain, the check semantics and the
Ed25519 arithmetic are all implemented here.

```
cd implementations/python
python -m charter_verify ../../vectors/out/valid.charter --json   # one file
python -m charter_verify.kit                                      # the conformance kit
python -m unittest discover                                       # 90 tests
```

## What it is for

The verifier and the producer are one reading of a specification. A second
reading, in another language, by someone who has not read the first, is the test
of whether the spec is a spec or a description of one program. This directory is
that test, and it produced nine findings: eight places where the document was
silent or contradicted itself, and one where the brief's expectations were wrong
about Python.

## Language and dependencies

**Python 3.14**, standard library only. No `pip install`, no `cryptography`, no
PyNaCl, no `zipfile`.

The brief allowed `cryptography` or PyNaCl for Ed25519 and `zipfile` for the
container, and this implementation declines all three, because each one would
have been a place where the two readings were the same reading:

* **Ed25519** is RFC 8032 §5.1.7 written out in `charter_verify/ed25519.py`:
  extended-coordinate point arithmetic, the curve constants, the scalar check
  against the group order `L`, and the cofactorless verification equation.
  `tests/test_ed25519.py` holds it to the RFC's own test vector and to both kit
  signatures, and cross-checks it against `cryptography` when that package
  happens to be installed — the useful place for a shared dependency to sit is in
  the test that quizzes both, not in either implementation.
* **The container** is read byte by byte in `charter_verify/container.py`:
  scanning backwards for the end record, walking the central directory, matching
  each record's local header name byte for byte, and measuring every byte against
  the layout rule. `zipfile` exists in the standard library, and using it would
  have meant that the "stored, never deflated" rule and the "every byte is
  accounted for" rule were tested against CPython's opinions instead of against
  §3 of the spec.
* **Canonical JSON** is written and read by hand in `charter_verify/canonical.py`.
  `json` is used nowhere in the verifier, in either direction.

## The kit result

**54 fixtures, 54 matched exactly.** Verdict, exit code, failing checks with
their reason codes, unsupported checks with their reason codes, and the count of
checks that were never reached — every field of every recorded answer, and no
mismatch to report.

```
54 case(s) replayed, and every verdict is the one the record states; 54 matched exactly.
no file under verifier/** was opened.
```

Beyond the record: the `--json` shape was compared key for key against the
reference CLI's output for all 54 fixtures (same keys, same check ids in the same
order, same statuses, same reason codes, same exit codes, same `summary` counts,
same `artifact` or `null`), and 20 hand-built artifacts that the kit does not
cover were put to both implementations. That last pass is where the findings came
from: it started at nine disagreements and ended at zero, and the spec changes
below are what closed them.

None of it required reading `verifier/**`. The replay installs an audit hook on
`open` and fails if any path under `verifier/` is ever opened;
`test_no_file_under_verifier_was_opened` asserts the list is empty, and
`test_the_comparison_can_fail` asserts that the comparison would have said so if
this port had returned a constant.

## Where the spec was silent, and what was decided

Each of these was decided by building an artifact, asking the reference CLI and
this verifier the same question, and reading the spec to see which answer it
supported. Where the spec supported neither, it was amended, and both readings
now follow it. The cases are frozen as tests in `tests/test_spec_gaps.py`.

| Question the spec did not answer | Decision | Where it now says so |
| --- | --- | --- |
| Which check owns the *spelling* of a digest, a key and a signature? | The check that reads the value, not FIELDS: MALFORMED for a value that does not decode or is the wrong length, NON_CANONICAL_ENCODING for a second spelling of the same bytes | §5, §7 |
| Who reports a `format` that is absent or not a string? | `L0.FORMAT.IDENTIFIER`, with MISSING and MALFORMED, because it is the check that runs before the fields | §5 |
| Which reason code does `01` carry? | NON_INTEGER_NUMBER, with `1.0`, `1e0` and `-0` | §4.1 |
| Does `L0.PROVENANCE.NONEMPTY` count lines or entries? | Entries: a log whose only line is `[1,2]` has none, so PARSE reports the line and NONEMPTY is SKIP | §7 |
| Which of two entries with the same name does a reader read? | The one whose local header comes first in the file | §3 |
| What does a skipped check carry? | PREREQUISITE_FAILED, except after the version gate, where it carries UNSUPPORTED_VERSION | §10.1 |
| What does each check depend on? | The graph in §10.1, including the two dependencies that run backwards in registry order | §10.1 |
| What is the shape of `--json`? | §12.1: the keys, the `summary` counts, and the rule for when `artifact` is `null` | §12.1 |

Four smaller guesses are worth naming, because no fixture and no probe reached
them and a later reading of the spec might reasonably decide differently:

* a JSON document whose bytes are not UTF-8 is a PARSE failure with
  DECODE_ERROR, while a lone surrogate written as a literal character (which no
  UTF-8 decoder can produce) is MALFORMED, the spec's word for it in §4;
* an unknown field *nested* inside `content` or `author` is UNKNOWN_FIELD, the
  same as a top-level one, rather than MALFORMED — §5's tables say "exactly" and
  §10's registry says "no field this version has no rule for", and the two
  readings only differ about which check says it;
* a `parent` that is a string but not a digest is a LINKS mismatch rather than a
  FIELDS malformation, by the same "the spelling belongs to the reader" rule;
* nothing in the kit exercises ZIP64 or a multi-disk archive, so §3.2's
  UNSUPPORTED is implemented from the prose and is unverified by any recorded
  answer. The port reports `L0.ZIP.VERSION` UNSUPPORTED for a version-needed above
  20, for a disk-number that is not zero, for entry counts that disagree across
  the two copies, and for the 0xFFFFFFFF sentinels — but a ZIP64 archive whose
  directory cannot be located fails READABLE first, and the spec does not say
  which of the two checks should have the field.

## Where the spec was wrong and was amended

Two of the eight are not silences but contradictions, and the recorded answers had
already caught one of them.

**The digest, key and signature spelling rules were on the wrong check.** §5's
table gave `L0.MANIFEST.FIELDS` the job of "64 lowercase hex characters",
"unpadded base64url" and "decoding to 64 bytes". The kit's own
`manifest-signature-truncated` case records exactly one failure, on
`L1.MANIFEST.SIGNATURE`, with nothing skipped — and that is impossible for a
verifier that measures the signature in FIELDS: FIELDS would fail first, and
every check that needs a manifest value would be skipped after it. The record had
been saying so since the day it was built; the table had not caught up. Three
probes confirmed the general shape: an uppercase digest, a 31-byte key and a
padded signature all pass FIELDS in the reference, and are reported by
`L0.CONTENT.HASH`/`L2.CHAIN.HEAD_MATCHES_CONTENT`, `L1.MANIFEST.KEY_ID` and
`L1.MANIFEST.SIGNATURE` respectively.

**`NON_CANONICAL_ENCODING` was in the vocabulary and in no rule.** §10 lists the
reason code; no sentence in the document produced it, which the spec's own first
paragraph forbids ("a rule that no check enforces is not a rule"). It now has a
job: the same value, spelled a second time — an uppercase digest, `=` padding, or
a base64url tail whose trailing bits are not zero.

(§5's table also named the format check `L0.MANIFEST.FORMAT`, which is not one of
the 30 ids in §10's registry.)

## What was hardest

**The dependency graph.** Not the canonical JSON, not the Ed25519 arithmetic, and
not the ZIP walk: the *skips*. The kit compares the number of checks that were
never reached, and for one artifact that number depends on a chain of decisions
the spec describes in a single sentence — "SKIP: the check could not run because
something it depends on failed". Which check owns a failure, and which checks
therefore skip, is the difference between 11 skips and 12 on `unterminated-log`,
between 3 and 4 on `empty-log`, and between 19 and 14 on `unsupported-format`. It
was also the part that a *reader* of the spec could not recover from the prose
alone: two edges in the graph run backwards in the registry order (FORMAT is
reported ninth-from-last in L0 and cannot run until the manifest has been read;
the version gate stops the content and log checks that are reported after it),
and one skip reason is special (the version gate's UNSUPPORTED_VERSION rather
than PREREQUISITE_FAILED).

The port's answer is a small mechanism rather than a table of special cases: a
check either returns a verdict of its own or raises `Blocked` carrying the id of
the check that *owns* the fact it needed. The runner turns a blocker whose owner
is the check itself into that check's FAIL or UNSUPPORTED, and everything else
into SKIP. Every "which check is skipped here?" question then has one answer, and
it is computed rather than listed. §10.1 is that mechanism written down.

**The second hardest thing was the artifacts the kit does not contain.** 54
fixtures pin 54 answers, and none of them contains an uppercase digest, a padded
signature, a `format` field that is missing, or a log line that is not an object.
The verifier had to be right about those too, because a reader will meet them
first, and the only way to find out what "right" was was to build them by hand
and ask both implementations.

## The brief, and where it was wrong

The brief listed five things that would bite. Four of them did; one is a
JavaScript problem, not a Python one.

* **Canonical JSON.** `ensure_ascii=True` and `separators=(', ', ': ')` are wrong
  by default, and both are traps this port avoids. The **sort is not a trap**:
  `json.dumps(..., sort_keys=True)` sorts with Python's own string comparison,
  which is by code point, so Python agrees with §4 by accident of its type system
  rather than by reading it. The U+1F600-versus-U+FFFF case therefore *passes*
  with `json.dumps` in Python and would not in JavaScript, where
  `Array.prototype.sort` compares UTF-16 code units. `tests/test_canonical.py`
  states this as the finding it is instead of asserting a bite that never came.
* **Integers only.** `json.loads` produces `1e2` as a float, `-0` as an int, and
  `isinstance(True, int)` is `True`: all three confirmed, and the writer answers
  `bool` before it answers `int`.
* **Key id.** Full-length `"ed25519:" + 64 lowercase hex`, no truncation, checked
  against the fixture's recorded key id before anything else was built.
* **ZIP method.** Confirmed: the entries in the 54 fixtures are stored except in
  `valid-deflate` and `unsupported-method`, and a reader that assumed either
  method fails fixtures either way.
* **Line endings.** Confirmed as the trap it is named to be, with one addition:
  the fixture bytes are the recorded bytes (`.gitattributes` marks them not-text),
  and the port hashes bytes and never normalises. A CRLF log line is caught by
  `L0.PROVENANCE.CANONICAL` rather than by PARSE, which is a reading the spec did
  not state and now does not contradict.

## Were the artifacts sufficient on their own?

For the 54 fixtures, **yes**: `SPEC.md`, `vectors/expected.json` and
`vectors/out/*.charter` are enough to produce all 54 recorded answers, and this
port was written that way — the first run of the replay scored 54 of 54. Nothing
in `verifier/**` was opened to understand a fixture, and the replay fails if one
ever is.

Three things the brief asks for are **not in the spec and are not derivable from
the fixtures**, and for those the reference CLI was run as a black box — `--json`,
its documented interface — and its output read:

1. **the JSON key names.** §12 said `--json` "prints the verdict and nothing
   else"; it did not say `summary` or `artifact` or `limitations`, and the
   `artifact` object's seven keys and its `null` rule are nowhere in the prose.
   §12.1 now states them.
2. **the limitation ids** (`INTERMEDIATE_CONTENT_HASHES` and the four others):
   §11 states the five statements and not what they are called.
3. **the eight silent cases above**, where the spec supported either reading and
   the reference's answer was the tie-break.

Reading the reference's *source* was never necessary and never done; running it
and comparing its recorded behaviour to the port's is what a second
implementation is for. `git diff -- verifier/` is 0 lines.

## How the two readings were compared

Three passes, in increasing severity:

1. **The record.** `python -m charter_verify.kit` replays `vectors/expected.json`
   against `vectors/out/*.charter` and compares verdict, exit code, failing
   checks with reason codes, unsupported checks with reason codes, and the skip
   count — the same five things `vectors/run.js` compares, in a program written
   separately. It also compares each file's recorded size and SHA-256 first, so
   "this file has been swapped" and "this verdict is wrong" stay two claims.
2. **The interface.** For each of the 54 fixtures, the reference CLI's `--json`
   was read and its shape compared to this verifier's, key for key and check id
   for check id: 0 differences.
3. **Artifacts neither kit contains.** 20 artifacts were built by hand — an
   uppercase digest, a padded signature, a key of 31 bytes, a key with a
   non-zero trailing bit pattern, a missing `format`, a non-string `format`, a
   nested unknown field, a leading-zero integer, four escape spellings, a
   duplicate key, an array, a float where a title belongs, a log line that is not
   an object, a bare number, a CRLF line, a non-canonical line, an unknown log
   field — and both implementations were asked. This pass began at 9
   disagreements and ended at 0, and every change it forced is either a spec
   amendment (above) or a change in this port.

The modules are split so that the rule can be checked: `canonical`, `container`,
`documents`, `ed25519`, `checks`, `verdict` and `verify` never read a file, a
clock, a socket or the environment, and `tests/test_purity.py` reads their source
and refuses the imports that would let one of them start. `cli` and `kit` are the
only two modules that touch the world, and they are the only two that need to.

## What this directory does not do

It is a verifier. There is no `seal`, no `keygen`, no `inspect` and no `cite`:
the producer's verbs write files outside a byte array, which is the one thing the
port's core is built not to do, and the format's proof is the reader rather than
a second writer. `keygen` would also need Ed25519 *signing*, and this port
deliberately implements only the verifying half of RFC 8032.

## The files

| Path | What it is |
| --- | --- |
| `charter_verify/canonical.py` | canonical JSON, both directions, and the bytes a signature covers |
| `charter_verify/container.py` | the ZIP walk: the end record, the directory, the local headers, every byte accounted for |
| `charter_verify/documents.py` | the manifest and the log: which fields exist, what type each is, how a timestamp is read |
| `charter_verify/checks.py` | the 30 checks, the facts they share, and the prerequisite rules that decide what is skipped |
| `charter_verify/ed25519.py` | RFC 8032 verification and the key id derivation |
| `charter_verify/verdict.py` | the three verdicts, the two output forms, the five statements of §11 |
| `charter_verify/cli.py` | `python -m charter_verify <file> [--all] [--json]`, and the exit codes |
| `charter_verify/kit.py` | the replay, and the audit hook that fails the run if `verifier/**` is opened |
| `tests/` | 90 tests, including the replay, the canonical rules, the container, the field rules, the Ed25519 arithmetic, the CLI, and the eight silent cases |
