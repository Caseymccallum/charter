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
python -m unittest discover                                       # 114 tests
python tools/probe.py --check                                     # the probe's fixtures against their recipes
python tools/corpus.py --check                                    # the corpus's containers against their mutations
```

`node ../../vectors/probe/run.js` asks this implementation, the reference, and
the probe's record the same 27 questions; `node ../../vectors/container/run.js`
asks them about 34 hand-mutated containers. Those are the harnesses
[`vectors/probe/README.md`](../../vectors/probe/README.md) and
[`vectors/container/README.md`](../../vectors/container/README.md) describe, and
the second one is where the container bugs below were found.

## What it is for

The verifier and the producer are one reading of a specification. A second
reading, in another language, by someone who has not read the first, is the test
of whether the spec is a spec or a description of one program. This directory is
that test, and it produced nine findings: eight places where the document was
silent or contradicted itself, and one where the brief's expectations were wrong
about Python. The container corpus at the end of
[How the two readings were compared](#how-the-two-readings-were-compared) added
eleven more, ten of them this port's, and §3 was amended for them; eight cases
built after that found five more, all of them this port's, and one of those was a
check that measured a defect and reported an absence of evidence instead.

A later pass settled the two findings the corpus had recorded rather than
patched, and they are counted on their own because neither is a case where the
port read the document wrongly: where a malformed number ends (§4 now says a
number token runs to the first character that cannot occur in one, so the two
implementations no longer disagree about a `created_at` whose value opens
`2026-01-01` — this port moved, and the probe's
`created-at-value-opens-a-number` holds the answer), and whether a charter may
carry an extra field (§3.6 fixes it and a record's comment at zero bytes and
gives them to `L0.ZIP.METADATA` with reason `EXTRA`; §14 says no version is
reported for a shape the format gives no rule to). The second moved **both**
implementations, and it is the one settlement here where neither was wrong
first: the rule was what was missing.

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

**56 fixtures, 56 matched exactly.** Verdict, exit code, failing checks with
their reason codes, unsupported checks with their reason codes, and the count of
checks that were never reached — every field of every recorded answer, and no
mismatch to report.

```
56 case(s) replayed, and every verdict is the one the record states; 56 matched exactly.
no file under verifier/** was opened.
```

Beyond the record: the `--json` shape was compared key for key against the
reference CLI's output for all 56 fixtures (same keys, same check ids in the same
order, same statuses, same reason codes, same exit codes, same `summary` counts,
same `artifact` or `null`), and 27 hand-built artifacts that the kit does not
cover were put to both implementations. That last pass is where the findings came
from: it started at nine disagreements and ended at zero, and the spec changes
below are what closed them. Committing the probe (`vectors/probe/`) then found a
tenth, and it was the first one that was a bug in the *reference* rather than a
silence in the spec: the reason code an absent field carries. Both readings agree
on it now, and §10 says which code it is.

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
| Which check owns the *spelling* of a digest, a key and a signature? | The check that reads the value, not FIELDS. NON_CANONICAL_ENCODING for a string that is not the one spelling of its value — the wrong case, the wrong length, a character outside the alphabet, `=` padding, trailing bits that are not zero; MALFORMED for a value that is not a string or that decodes to the wrong length for its algorithm; MISSING when the field is not there at all | §5, §7 |
| Who reports a `format` that is absent or not a string? | `L0.FORMAT.IDENTIFIER`, with MISSING and MALFORMED, because it is the check that runs before the fields | §5 |
| Which reason code does an absent field carry? | MISSING, from every check that required the value — including `L0.PROVENANCE.CONTENT_HASH_FORMAT`, which reported NON_CANONICAL_ENCODING for a digest that was not there, and this port's manifest path, which reported MALFORMED | §5, §7, §10 |
| Which check reports an empty digest, an empty signature, an empty key or a `parent` that is not a digest? | The check that reads the value. FIELDS measures presence and JSON kind, so `""` in those fields passes it; the reading check reports what is wrong — NON_CANONICAL_ENCODING for a digest of the wrong length and for a `parent` that is not 64 lowercase hex characters, MALFORMED for a signature or a key that decodes to a number of bytes Ed25519 does not use. An empty string in a field *no* other check reads (`title`, `author.name`, `author.key_id`, `summary`) is FIELDS' MALFORMED | §5, §7, §10, §10.2 |
| Which reason code does a value no enumeration defines carry? | UNKNOWN_FIELD, for `author.algorithm` and for an entry's `action`: "a field value it does not define, not skipped over". A value that is not a string at all is MALFORMED | §5, §7 |
| Which reason code does an empty `format` carry? | UNSUPPORTED_VERSION: §5's three cases are "absent", "not a string" and "a value this verifier does not implement", and `""` is a string | §5 |
| Which base64url failures are MALFORMED? | Only the decoded length. Anything that is not the one spelling of *some* byte string — a character outside the alphabet, a length no byte string is spelled with, `=` padding, trailing bits that are not zero — is NON_CANONICAL_ENCODING. The empty string is the one spelling of the empty byte string, so it is the length rule that refuses it | §5, §8 |
| Which reason code does `01` carry, and how far does a malformed number run? | NON_INTEGER_NUMBER, with `1.0`, `1e0` and `-0`; and a number token runs to the first character that cannot occur in one, so `2026-01-01` is one token and carries that same code rather than a MALFORMED about the scanner's stopping point. This port stopped at the `-` and reported MALFORMED until §4 stated where a token ends | §4 |
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
* nothing in the kit exercises ZIP64 or a multi-disk archive, so §3.2's
  UNSUPPORTED is implemented from the prose and is unverified by any recorded
  answer. The port reports `L0.ZIP.VERSION` UNSUPPORTED for a version-needed above
  20, for a disk-number that is not zero, for entry counts that disagree across
  the two copies, and for the 0xFFFFFFFF sentinels — but a ZIP64 archive whose
  directory cannot be located fails READABLE first, and the spec does not say
  which of the two checks should have the field.

A fourth guess — that a `parent` which is a string but not a digest is a LINKS
*mismatch* rather than a FIELDS malformation — was half right and is no longer a
guess. The ownership was right and the code was not: `parent` is a string or null
to FIELDS and a digest to `L2.CHAIN.LINKS`, and a string that is not 64 lowercase
hex characters is NON_CANONICAL_ENCODING, the spelling rule of §5, because a
parent of the wrong *shape* is not a link that was measured and found different.
The sweep found it by asking about a parent in uppercase; §7 and §10.2 now say
which check owns a parent, and the reference was the implementation that had to
change.

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
job: a field whose string is not the one spelling this format fixes for its value
— an uppercase digest, a digest of the wrong length, `=` padding, a base64url tail
whose trailing bits are not zero — while MALFORMED is for a value that is not a
string or that decodes to the wrong length for its algorithm. §5 states the rule,
§10 says what the code means, and `tests/test_spec_gaps.py` holds both.

**An absent field was reported as a misspelling.** This one was found by the probe
rather than by this reading, and it is the only finding in either list that was a
bug in the *reference* rather than a silence in the spec: given an entry with no
`content_sha256` at all, the reference reported `NON_CANONICAL_ENCODING` from
`L0.PROVENANCE.CONTENT_HASH_FORMAT` — whose own sentence said "absent (MISSING)" —
while §10 defines MISSING as "a required thing is absent". Both implementations
agreed, which is what made it invisible: two readings that are wrong in the same
way agree about everything, including the mistake. §5, §7 and §10 now state the
rule, both implementations report MISSING, and the probe's record carries it.

(§5's table also named the format check `L0.MANIFEST.FORMAT`, which is not one of
the 30 ids in §10's registry. `test/spec.test.js` now compares the ids and the
reason codes in §10 with the modules that declare them, in both directions, so a
name that exists in one and not the other fails the run.)

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

**The second hardest thing was the artifacts the kit does not contain.** 56
fixtures pin 56 answers, and none of them contains an uppercase digest, a padded
signature, a `format` field that is missing, or a log line that is not an object.
The verifier had to be right about those too, because a reader will meet them
first, and the only way to find out what "right" was was to build them by hand
and ask both implementations.

The same absence cost this port a rule it had read. §3.7's table says an entry's
uncompressed ceiling is where **inflation stops**, and the reference stops there;
`decompress` inflated with `zlib.decompress`, which has no bound, so an entry
declaring 8 bytes and expanding to 200 MB was answered *about* rather than
refused — 200 MB of memory spent by the reader whose ceiling exists to bound it,
and a verdict of `L0.ZIP.SIZES`=MISMATCH about a document nobody sent. Nothing in
the kit, the probe or the sweep could say so, because every ceiling artifact
anywhere *declares* the number and the stop is the half a declaration cannot
satisfy. The case that says so now is the kit's `entry-expands-past-ceiling`, and
`_inflated` decodes through a `decompressobj` given a length one byte past the
ceiling. It is the one finding in this directory that no suite could have
produced, which is the argument for building the artifacts the kit does not
contain rather than only replaying the ones it does.

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
* **ZIP method.** Confirmed: the entries in the 56 fixtures are stored except in
  `valid-deflate` and `unsupported-method`, and a reader that assumed either
  method fails fixtures either way.
* **Line endings.** Confirmed as the trap it is named to be, with one addition:
  the fixture bytes are the recorded bytes (`.gitattributes` marks them not-text),
  and the port hashes bytes and never normalises. A CRLF log line is caught by
  `L0.PROVENANCE.CANONICAL` rather than by PARSE, which is a reading the spec did
  not state and now does not contradict.

## Were the artifacts sufficient on their own?

For the 56 fixtures, **yes**: `SPEC.md`, `vectors/expected.json` and
`vectors/out/*.charter` are enough to produce all 56 recorded answers, and this
port was written that way — the first run of the replay scored 54 of 54. Nothing
in `verifier/**` was opened to understand a fixture, and the replay fails if one
ever is.

One of the 56 is not from the kit's builder at all: `produced-two-entries` was
written by `charter seal` and `charter edit` (SPEC.md 15.6), the two verbs this
project ships, so it is the one fixture that existed after this port was written
and that no reader of this README could have seen while writing it. The replay
still answers it, because a history of two entries is a history of two entries
whichever half of the project wrote it.

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
2. **The interface.** For each of the 56 fixtures, the reference CLI's `--json`
   was read and its shape compared to this verifier's, key for key and check id
   for check id: 0 differences.
3. **Artifacts neither kit contains.** `vectors/probe/` holds 27 artifacts built
   by hand — an uppercase digest, a padded signature, a key of 31 bytes, a key
   with a non-zero trailing bit pattern, a missing `format`, a non-string
   `format`, a nested unknown field, a leading-zero integer, a `created_at` whose
   value opens a number token where its opening quote should be, four escape
   spellings, a duplicate key, an array, a float where a title belongs, a log line
   that is not an object, a bare number, a CRLF line, a non-canonical line, an
   unknown log field, an empty digest, an empty signature, a parent in uppercase,
   an empty `format`, an empty `author.key_id`, and a first entry whose `parent`
   is a digest where `null` is required — with the answers the reference gave for
   each one, and `node vectors/probe/run.js` asks both implementations again and
   compares. This pass began at 9 disagreements and ended at 0, and every change
   it forced is either a spec amendment (above) or a change in this port.
   Committing the artifacts is what makes that claim checkable rather than merely
   reported, and it found two more things the run in `%TEMP%` could not: a missing
   `content_sha256` is reported with the reason code for a *second spelling* of a
   value while the sentence beside it says the value is absent, and this port's
   CLI wrote a verdict whose title was U+1F600 as nothing at all when its stdout
   was a pipe, because Windows encodes text with the console code page. The first
   is frozen in `tests/test_spec_gaps.py`, the second in `tests/test_cli.py`, and
   both are written down in `vectors/probe/README.md`. The last three of the 27
   were added in a later pass, and they are the only three that arrived after an
   implementation had already stopped moving: they are the readings §3 and §10.2
   had settled, written down in the form a stranger can replay.
   `created-at-value-opens-a-number` is the third pass's, added after this port
   moved on it: it was the recorded disagreement over where a malformed number
   ends — the reference said NON_INTEGER_NUMBER for the token `2026-01-01` and
   this port said MALFORMED about an object — and §4 now states the rule the
   reference was following.

A fourth pass and a fourth reader: **the sweep.** `tools/sweep.py` asks the two
implementations about every field of both documents, rewritten eleven ways each —
absent, `null`, a number, a short string, the empty string, an array, an object,
uppercase, a character outside the alphabet, a padded spelling, and one character
short of its own spelling. It asks 212 questions, and before this pass's fixes the
two implementations answered 40 of them differently, in eight families:

* the *reference* measured a string that another check reads — an empty digest, an
  empty signature and an empty public key (5 cases), and a `parent` that is not a
  digest (8): 14 cases, the same defect as the three findings the probe added;
* the *reference* refused a version it had not been asked to implement: `format`
  holding `""` (1 case);
* this *port* called every base64url failure MALFORMED, where §5 says
  NON_CANONICAL_ENCODING for a character outside the alphabet and for a length no
  byte string is spelled with (8 cases);
* this *port* called a value no enumeration defines MALFORMED, where §5 says
  UNKNOWN_FIELD — `author.algorithm` and an entry's `action` (12 cases);
* this *port* reported a `content_sha256` that is not a string as a spelling
  problem rather than MALFORMED (4 cases);
* this *port* let an empty `key_id` past the field rules to be compared against a
  key (2 cases).

The fixes are on both sides and the sweep now asks its 212 questions with no
disagreement. What it settled lives in `tests/test_spec_gaps.py`, in
`test/schema.test.js`, and in the probe's three new cases; what it *is* is a
finding tool, not a fixture — nothing it builds is committed.

A fifth pass, and the one that went a level below both of those: **the container
corpus.** The kit's 56 artifacts and the probe's 27 cases are JSON documents
inside a container, and every check they exercise reads a *field*. None of them
can reach the container's byte arithmetic, because "this entry's declared
compressed size is one byte more than the bytes after it" is not a field of a
document — it is an offset in a file. `tools/corpus.py` builds 34 hand-written
mutations of `vectors/out/valid.charter`, one change each, and
`node vectors/container/run.js` asks both implementations about all 34. **Eleven
of the first 26 disagreed on the first run**, and this port was the implementation at
fault in ten of them:

* **It never compared the two flag words.** §3.3 says a reader has to agree with
  itself about flags before it can decode anything, so two copies that differ are
  a refusal at `L0.ZIP.READABLE` with reason `MISMATCH` — and
  `local-flag-allowed-bit-set`, where bit `0x0002` is set in one header and not
  the other, came back `VERIFIED` from this port. A file whose two halves
  contradict each other was called sound. The port now compares the two copies —
  in the caller that holds both, which is what `_local_header`'s own docstring
  says — and refuses. `local-flag-unsupported-bit-set` is the same defect with a
  bit the reader declines: the port read the local copy, found encryption there,
  and reported `L0.ZIP.FLAGS`=UNSUPPORTED_FEATURE, where the two copies disagreeing
  is the answer the gate owes (and `L0.ZIP.FLAGS` is SKIP behind it).
* **It used the wrong reason code for a contradiction.** `central-offset-to-other-header`,
  whose record points at a header carrying another entry's name, came back
  `MALFORMED` here and `MISMATCH` from the reference: both refused the file, and
  §3.1 named neither. §3.1 now draws the line — bytes that are not the shape the
  format requires are `MALFORMED`, and two well-formed claims about one fact where
  one is false are `MISMATCH` — and `entry-central-record-twice` is the same
  reading about two ranges rather than two names, which is the next bullet.
* **It used `EXTRA` where two ranges claimed the same bytes.** §3.4 defined only
  one way for a range to be wrong, "bytes appear where the format does not put
  them", and the port reported `EXTRA` for `entry-central-record-twice`, where a
  second record names the same local header and two ranges overlap. §3.4 now
  distinguishes them: a range that begins after the previous one ends is a gap and
  `EXTRA`, and a range that begins *inside* one already claimed is two claims about
  the same bytes and `MISMATCH`.
* **It read three numbers the format fixes and never compared.** `eocd-cd-size-wrong`
  came back `VERIFIED`: the port read the directory's declared size and never
  compared it with the records inside it, which is the hole §3.6's own rule names
  ("a byte the reader never looks at is a byte a forged file can change for free").
  `eocd-zip64-marker` came back `BROKEN`, its gate having called a ZIP64 end record
  `MALFORMED`, where §3.2 makes it an archive this reader will not interpret; and
  `eocd-multi-disk` was walked and blamed on `L0.ZIP.VERSION`, where a file that
  says it is one disk of a set has offsets that may belong to another disk. The
  ZIP64 and disk facts are the gate's now, §3.4 states the directory-size
  comparison among the three facts the layout rule reads, and §3.2 gives the gate
  its two facts as `UNSUPPORTED` rather than `FAIL` — `INCOMPLETE`, never `BROKEN`.
* **It named the wrong code for a feature level above 2.0.** `entry-version-needed-zip64`
  had both implementations reporting `L0.ZIP.VERSION` and disagreeing about the
  word: the reference said `UNSUPPORTED_VERSION`, this port `UNSUPPORTED_FEATURE`.
  A level above 2.0 is a version this verifier does not implement, which is the
  code §3.2 gives ZIP64 in an end record; the same edit removed the port's reading
  of a bare `0xFFFFFFFF` size field as ZIP64, which is a ceiling and §3.7's.
* **It measured the local copy of a claim in the checks that own the value.**
  `local-uncompressed-size-off-by-one` and `local-crc-zeroed`: both implementations
  reported `L0.ZIP.METADATA`=MISMATCH, and the port *also* reported
  `L0.ZIP.SIZES`=MISMATCH and `L0.ZIP.CRC32`=MISMATCH, because it measured the
  local header's copy as well as the directory's. §3.5: `L0.ZIP.SIZES` and
  `L0.ZIP.CRC32` read the central directory's copy, and the local copy belongs to
  `L0.ZIP.METADATA` — one edited header was being reported twice, and the
  complaint taken away from the check whose requirement it breaks.

The one case where the *reference* was wrong is the one worth reading twice:
`entry-central-order-swapped` writes the directory's records in a different order
than the body — which is what a writer that sorts its records by name produces,
and is not a defect. The reference walked the entry ranges in *directory* order
and read the result as a gap, calling the file `BROKEN` where this port said
`VERIFIED`. §3.4 now says the layout rule is a property of the byte ranges and
that the ranges are walked in file order, and `verifier/zip.js` does.

Every one of the eleven was settled the same way — read the ZIP specification,
read §3, amend §3 where it was silent **and then** fix whichever implementation
was wrong — and every case's record says which implementation moved for it. The
corpus is a finding tool rather than a kit: `run.js` fails when an implementation
has moved, and reports a case the two still read differently as a finding rather
than as a failure — a case like that is recorded with both answers and
`agreement: false`, and the record's `note` says which reading the format
requires. After the fixes all 34 agree, and `tests/test_corpus.py` and
`test/corpus.test.js` hold that as an invariant: the number of cases whose
`agreement` is false is asserted to be zero, so a corpus that has grown a new
disagreement fails the suite instead of quietly becoming a record of one.

A sixth pass took the recommendation above and answered it. The three mutations it
named were built by hand first — `entry-extra-len-off-by-one`,
`entry-name-length-copies-differ` and `entry-byte-deleted-mid-directory` — and a
fourth arrived while building them: `entry-name-not-utf8`, one byte of an entry's
name that cannot stand alone in UTF-8. Five of the eight cases this pass added
moved this port, and one of those five was its worst answer of the pass — not wrong
but *silent*:

* **`entry-byte-deleted-mid-directory`** — one byte out of the middle of the
  directory. The reference reads every record before it compares any record's name
  with the local header that record points at; this port compared each name as it
  walked, so it reported a *name* disagreement about a record whose position its
  own walk had already broken. §3.1 now fixes the order — the shape of the directory
  is established before its records' claims are compared — and `walk` reads the
  whole directory in one pass and resolves local headers in a second.
* **`entry-name-not-utf8`** — the reference refused at the gate with `DECODE_ERROR`
  and 29 checks never run, and this port decoded the name with replacement
  characters, carried on, and reported `L0.ZIP.ENTRY_SET`=MISSING with two checks
  never run. §3.1 now says an entry's name is a UTF-8 string, because the entry set
  is a claim about names and a reader that cannot read a name cannot say which entry
  it read, and the walk decodes each record's name as it goes.
* **`entry-version-needed-local-only`** — a feature level above 2.0 in the local copy
  only. This port read `max(central, local)` and reported `UNSUPPORTED_VERSION`;
  §3.2 now says the check reads the directory's copy, which is §3.5's rule for every
  claim the file states twice, and `check_version` does.
* **`central-extra-len-past-eof`** — a record whose declared extent reaches past the
  file. This port refused at the gate with `MALFORMED` where the reference reported
  `L0.ZIP.LAYOUT`=MISMATCH; the gate reads *names*, and what the records' extents add
  up to is the layout check's number. §3.4 now says so, and the walk checks the
  name's end and no more.
* **`unsupported-method-beside-a-wrong-size`** — two defects at once, and the one
  case where this port was not wrong but silent: it skipped the size check because
  one entry's bytes could not be read, and said nothing about the declared size it
  had already measured and found wrong. §10.1 now carries the rule one entry down
  from "the gate is the fact, not the status" — a fact that names one entry gates
  that entry, not the check that reads it — and `check_sizes` and `check_crc32` keep
  measuring what they can.

`entry-extra-len-off-by-one` moved **both** implementations: each answered `EXTRA`
where §3.4's rule requires `MISMATCH`, because §3.4 gave the directory-offset
comparison one code and no direction. `entry-name-length-copies-differ` moved
nobody, and `local-extra-field-unread` was the one case neither implementation
could be wrong about: a charter carrying a four-byte extra field *verified*,
because §3.4 accounted for its bytes and no check read them. That family has been
settled rather than left open, and it moved both implementations when it was: §3.6
now fixes the extra field and a directory record's comment at zero bytes and gives
them to `L0.ZIP.METADATA` with reason `EXTRA`, §14 says which voice answers an
artifact that holds a shape charter/0.1 gives no rule to, and the case's answer is
a defect. Two other cases in the corpus carry such a field and gained the same
failure beside the one they were built to ask about, which is why their recorded
answers name two checks rather than one. The settlement is the one in this file
where neither implementation was wrong before it: the rule was what was missing.

**The fuzzer the recommendation asked for was not built**, on a measurement rather
than a guess. A differential sweep — every field of every record moved seven ways,
every repeated claim moved in both copies at once, and random two-to-four byte
changes — was run against both implementations. Before this pass's fixes it found
20 disagreements in 1301 structured mutations, in two families that are now cases
(`entry-version-needed-local-only`, `central-extra-len-past-eof`) plus a third in
the random set (`unsupported-method-beside-a-wrong-size`). After them it finds
none: 0 disagreements in the 1301 structured mutations and 0 in each of two runs of
600 random multi-byte ones. The class the recommendation named — a two-byte change
that preserves self-consistency — is the class where the two implementations
already agree, and that was measured before anything was built: a name length moved
into the extra length so the data offset is unchanged, a byte moved from one entry's
data into the next's, a bit set in both flag words, an extra field carried with its
declaration honest. All four agreed. A tool whose queue is empty is a tool a reader
has to trust without evidence, and the thing this project does with a disagreement
is make a case out of it.

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
| `tools/probe.py` | the 27 differential probes: their recipes, the builder that records the reference's answers and refuses a record the port disagrees with, and `--check` |
| `tools/corpus.py` | the 34 container mutations: their recipes, the builder that writes the artifacts and both implementations' answers for each, and `--check`, which rebuilds every artifact in memory and refuses one that is not the file its mutation makes |
| `tools/sweep.py` | every field of both documents, rewritten eleven ways each, asked of both implementations: a finding tool, and the program that settled the rule at the head of §10 |
| `tools/differential.py` | the five things two implementations are compared by, once, for the three tools above |
| `tests/` | 114 tests, including the replay, the canonical rules, the container, the field rules, the Ed25519 arithmetic, the CLI, the eight silent cases, the container corpus, and two the probe found after it was committed |
