# The declarations SPEC.md makes, and what holds them

`SPEC.md` is a document of rules, and a rule that names a set — a list of fields,
an enumeration, a ceiling — is a rule that code has to state a second time. When
the two drift, nothing breaks loudly: the verifier keeps answering, and its
verdict is about a format the document no longer describes. This file is the
audit of every such claim, written after Step 20 found four of them (§10's
vocabulary, §12's verbs, §3.7's ceilings, and §5/§7's field lists) and asked how
many more there were.

The shapes counted here:

- **"exactly these N fields"** — a fixed set of names a document may carry.
- **"one of: A, B, C"** — a closed enumeration.
- **"the set of X is Y"** — two things claimed to be the same set.
- **"at most N"** and **"at least N"** — a bound.
- **"these N statements"** — a counted list of prose.

A claim is only in this table if it is *declarative*: it fixes something a
verifier's answer depends on. A sentence that describes why a rule exists, or
what a reader should expect, is not here — only the sentences that a
reimplementation would have to obey.

## The table

| # | Section | Claim | Spec | Code that declares it again | Test that holds them together |
| --- | --- | --- | --- | --- | --- |
| 1 | §2 The artifact | "It holds exactly three entries … Those names, in that set, and nothing else" | `SPEC.md:30-38` | `verifier/verify.js` `REQUIRED_ENTRIES`, with `ENTRY_MANIFEST`, `ENTRY_CONTENT`, `ENTRY_PROVENANCE` | **none** |
| 2 | §3.2 Feature level | "it is at most 20 (2.0)" | `SPEC.md:122` | `verifier/zip.js` `MAX_VERSION_NEEDED`; `verifier/zip-write.js` `VERSION_NEEDED` | **none** |
| 3 | §3.3 Compression and flags | "Each entry is stored (method 0) or raw-deflated (method 8)" | `SPEC.md:140` | `verifier/zip.js` `METHOD_STORED`, `METHOD_DEFLATE` | **none** |
| 4 | §3.3 Compression and flags | "Exactly three general purpose bits are allowed: `0x0002` and `0x0004` … and `0x0800`" | `SPEC.md:144` | `verifier/zip.js` `FLAGS_ALLOWED` | **none** |
| 5 | §3.3 Compression and flags | "Five more bits describe features this reader does not implement and are reported as UNSUPPORTED: `0x0001` … `0x2000`"; "Any other bit is FAIL with reason EXTRA" | `SPEC.md:147-149` | `verifier/zip.js` `STRUCTURAL_FLAGS`, `FLAG_NAMES` | **none** |
| 6 | §3.4 Layout | "Every byte of the file is accounted for by a local header, an extra field, an entry's data, the central directory, or the end record, in that order" | `SPEC.md:161-166` | `verifier/zip.js` layout walk (no list constant) | `test/vectors.test.js` (the kit's layout cases, replayed) |
| 7 | §3.6 Metadata the format fixes | "The one value a charter/0.1 file may hold" — eight rows | `SPEC.md:244-253` | `verifier/zip-write.js` `VERSION_MADE_BY`, `DOS_DATE`, `DOS_TIME`; `verifier/zip.js` metadata evaluation | **none** |
| 8 | §3.7 Limits | "These numbers are part of the published behaviour of charter/0.1" — nine rows | `SPEC.md:302-312` | `verifier/limits.js` `LIMITS`; `implementations/python/charter_verify/limits.py` | `test/spec.test.js` (Step 19, two tests) |
| 9 | §4.2 The same values, both ways | "The set of values the serializer accepts is exactly the set of values the reader can produce" | `SPEC.md:433` | `verifier/canonical.js`, `verifier/canonical-write.js` | `test/canonical.roundtrip.test.js` |
| 10 | §4.2 The same values, both ways | The six refusals: a producer's value, and the reason code it carries | `SPEC.md:439-446` | `verifier/canonical-write.js` | `test/canonical-write.test.js` |
| 11 | §5 `manifest.json` | "no other field than these six" | `SPEC.md:459` | `verifier/manifest.js` `MANIFEST_FIELDS`; port `documents.py` `MANIFEST_FIELDS` | `test/spec.test.js` (Step 20) |
| 12 | §5 `manifest.json` | content is "an object whose only field is `sha256`"; author is "an object with exactly `name`, `algorithm`, `key_id`, `public_key`" | `SPEC.md:463-465` | `verifier/manifest.js` `MANIFEST_CONTENT_FIELDS`, `MANIFEST_AUTHOR_FIELDS`; port `CONTENT_FIELDS`, `AUTHOR_FIELDS` | `test/spec.test.js` (Step 20) |
| 13 | §5 `manifest.json` | "`manifest.author.algorithm` is an enumeration, and this version defines exactly one value, `"ed25519"`" | `SPEC.md:539-540` | `verifier/manifest.js` `ALGORITHM`; `verifier/digest.js` `ALGORITHM_NAME`; port `documents.py` `ALGORITHM` | **none** |
| 14 | §6 `content.md` | "Three requirements and no others" | `SPEC.md:553-562` | `verifier/status.js` `CHECK_REGISTRY` (the two `L0.CONTENT.*` ids) | `test/spec.test.js` (the ids, via §10); the count word is read by nothing |
| 15 | §7 `provenance.jsonl` | "each object carrying exactly these seven fields" | `SPEC.md:573-574` | `verifier/provenance.js` `ENTRY_FIELDS`; port `ENTRY_FIELDS` | `test/spec.test.js` (Step 20) |
| 16 | §7 `provenance.jsonl` | author "an object with exactly `name` and `key_id`"; "`action` … `"create"` or `"edit"`, and nothing else" | `SPEC.md:578-579` | `verifier/provenance.js` `ENTRY_AUTHOR_FIELDS`, `ACTIONS`; port `ENTRY_AUTHOR_FIELDS`, `ACTIONS` | `test/spec.test.js` (Step 20) |
| 17 | §7 `provenance.jsonl` | "At least one entry" is its own check, `L0.PROVENANCE.NONEMPTY` | `SPEC.md:615-619` | `verifier/status.js` `CHECK_REGISTRY` (`L0.PROVENANCE.NONEMPTY`) | `test/vectors.test.js` (the `empty-log` fixture, replayed) |
| 18 | §8 Keys and key ids | "One algorithm: Ed25519 (`ed25519`). A public key is 32 bytes and a signature is 64 bytes" | `SPEC.md:623-624` | `verifier/manifest.js` `ALGORITHM`, `PUBLIC_KEY_BYTES`, `SIGNATURE_BYTES`, `DIGEST_BYTES`; `verifier/digest.js` `ALGORITHM_NAME`, `HASH_NAME` | **none** |
| 19 | §9 The chain | "Three consequences follow, and each of them is a check" | `SPEC.md:670-680` | `verifier/status.js` `CHECK_REGISTRY` (the three `L2.CHAIN.*` ids) | `test/spec.test.js` (the ids, via §10); the count word is read by nothing |
| 20 | §10 Verdicts | "Every check ends in exactly one of four statuses" — four rows; "There is no fifth status and no 'pass with warnings'" | `SPEC.md:688-698` | `verifier/status.js` `STATUS` | **none** — `test/result.test.js:17` compares the code to a list transcribed in the test, and never reads the document |
| 21 | §10 Verdicts | "Three verdicts, over all 30 checks" — three rows, with exit codes | `SPEC.md:722-728` | `verifier/status.js` `VERDICT`, `EXIT_CODE` | **none** — `test/result.test.js:18-19` transcribes both |
| 22 | §10 Verdicts | The reason-code vocabulary — sixteen codes | `SPEC.md:736-742` | `verifier/status.js` `REASON` | `test/spec.test.js` (Step 15, four tests) |
| 23 | §10 Verdicts | "The 30 checks, in the order they always appear in a verdict" — thirty rows | `SPEC.md:758-791` | `verifier/status.js` `CHECK_REGISTRY`, `CHECK_IDS` | `test/spec.test.js` (Step 15) |
| 24 | §10.1 What a check depends on | The dependency table — what each check needs, and what a skip carries | `SPEC.md:796-871` | `verifier/verify.js` (the gate and `skipUnset` prefixes); `verifier/result.js` | `test/runtime.test.js`, `test/result.test.js` (the rule, behaviourally) |
| 25 | §10.2 One requirement, one owner | The owner column: which check owns a value, check by check | `SPEC.md:872-947` | `verifier/verify.js` (ownership, as written) | `test/spec.test.js` (Step 15, the row check) |
| 26 | §10.3 The audit's audit | "rows settled by a kit fixture, … a probe case, … a corpus case, and none by prose alone" | `SPEC.md:948-1029` | `vectors/expected.json`, `vectors/probe`, `vectors/container` | `test/spec.test.js` (Step 15) |
| 27 | §11 What this does not protect against | "The verifier prints these five statements with every verdict, and they are not checks" | `SPEC.md:1036-1063` | `verifier/caveats.js` `CAVEATS` | **none** — `test/result.test.js:88` checks the array's internal shape, and `test/editor.test.js:675` asserts the count 5, both transcribed |
| 28 | §11 What this does not protect against | "Three more limits are worth stating even though no caveat id carries them" | `SPEC.md:1065-1079` | none, and the section says so | not applicable |
| 29 | §12 Running it | The five verbs that write and describe files | `SPEC.md:1145-1149` | `cli/charter.js` (dispatch and `HELP`); port `cli.py` | `test/spec.test.js` (Step 17), `test/cli.test.js` |
| 30 | §12 Running it | The per-verb exit-code mapping: which verbs can exit `66`, which `73` | `SPEC.md:1151-1160` | `verifier/status.js` `EXIT_CODE`, and each verb's use of `64`, `65`, `66`, `73` | `test/cli.test.js` (Step 17) |
| 31 | §12.1 The JSON form | "One JSON object, with these keys" — eight keys | `SPEC.md:1100-1111` | `verifier/verify.js`, `cli/charter.js` (the JSON the reporter prints) | **none** for the key set — `test/cli.test.js` reads `bytes`, `checks[].id` and `checks[].status` out of three of them |
| 32 | §12.1 The JSON form | `artifact` "is an object with `format`, `title`, `created_at`, `author_name`, `author_key_id`, `entries` and `head_content_sha256`" | `SPEC.md:1113-1114` | the claims object in `verifier/verify.js` | **none** |
| 33 | §13 The conformance kit | "56 artifacts", "The 27 Phase 1 cases", "The 28 that follow", and the one artifact a tool wrote | `SPEC.md:1193-1290` | `vectors/expected.json` | `test/counts.test.js` (Step 15) |
| 34 | §14 What changes a version | "A change that alters any of the following is a different format" — five bullets | `SPEC.md:1299-1303` | `verifier/manifest.js` `FORMAT` (the identifier, not the list) | **none** |
| 35 | §15.5 What the producer refuses | The refusals and the reason code each carries — eight for `seal`, five more for `edit` | `SPEC.md:1428-1441` | `producer/seal.js`, `producer/edit.js` | `test/producer.test.js` (a test per refusal, and "a refusal carries a reason code of the format, and no other name") |
| 36 | §16 A second reading | "Writing it found eight such places" — seven amendments listed | `SPEC.md:1551-1557` | none | not applicable |

## Totals

| | Count |
| --- | --- |
| List-shaped claims in `SPEC.md` | **36** |
| — with a code copy, held to the document by a test | **20** |
| — with a code copy, held by nothing | **14** |
| — with no code copy at all | **2** |

The two with no code copy are §11's "three more limits" and §16's list of
amendments. Both are statements *about* the document rather than rules a
verifier obeys, and §11 says of its own three that no caveat id carries them.

## The fourteen gaps

Every one has the same shape: the document states the thing, code states it
again, and no test reads the document to find out whether the two still agree.
A test that transcribes the value — which is what most of these have — pins the
code to a copy of the truth that lives in the test file, and the copy that can
drift is the document's.

| # | The claim | The code that declares it again |
| --- | --- | --- |
| 1 | §2: the archive holds exactly `manifest.json`, `content.md`, `provenance.jsonl` | `verifier/verify.js` `REQUIRED_ENTRIES` |
| 2 | §3.2: the feature level an entry needs is at most 20 | `verifier/zip.js` `MAX_VERSION_NEEDED`; `verifier/zip-write.js` `VERSION_NEEDED` |
| 3 | §3.3: an entry is method 0 or method 8 | `verifier/zip.js` `METHOD_STORED`, `METHOD_DEFLATE` |
| 4 | §3.3: exactly three general purpose bits are allowed | `verifier/zip.js` `FLAGS_ALLOWED` |
| 5 | §3.3: five named bits are UNSUPPORTED, and any other bit is EXTRA | `verifier/zip.js` `STRUCTURAL_FLAGS`, `FLAG_NAMES` |
| 6 | §3.6: the eight fields the format fixes, and the one value each may hold | `verifier/zip-write.js` `VERSION_MADE_BY`, `DOS_DATE`, `DOS_TIME` |
| 7 | §5: `author.algorithm` defines exactly one value | `verifier/manifest.js` `ALGORITHM`; `verifier/digest.js` `ALGORITHM_NAME` |
| 8 | §8: one algorithm, public key 32 bytes, signature 64 bytes | `verifier/manifest.js` `ALGORITHM`, `PUBLIC_KEY_BYTES`, `SIGNATURE_BYTES` |
| 9 | §10: exactly four statuses, and no fifth | `verifier/status.js` `STATUS` |
| 10 | §10: three verdicts, and the exit code each carries | `verifier/status.js` `VERDICT`, `EXIT_CODE` |
| 11 | §11: five caveat statements travel with every verdict | `verifier/caveats.js` `CAVEATS` |
| 12 | §12.1: the JSON verdict's eight keys | the reporter's JSON in `cli/charter.js` |
| 13 | §12.1: the seven keys of `artifact` | the claims object in `verifier/verify.js` |
| 14 | §14: the five kinds of change that move the format identifier | `verifier/manifest.js` `FORMAT` |

Two smaller findings are worth recording beside them. §6 says "Three
requirements and no others" and lists two checks and one prohibition, and §9
says "Three consequences follow" and lists three checks; in both, the *ids* are
held (by §10's registry check, in both directions) and the **count word is read
by nothing**, so a section could gain a fourth bullet while its sentence said
three. The same is true of §11's "five statements", where `test/editor.test.js`
asserts the number 5 and never opens the document.

## What this audit did not do, and why

**The audit found fourteen gaps, and the rule for this work says that more than
three gaps is not answered by more tests.** Fourteen tests, each reading one
more sentence out of `SPEC.md`, would be fourteen more places where the reader
is written by hand — and eleven of the fourteen gaps are the *same* mechanical
shape: a spec locator, a constant or array in code, and a comparison.

So no tests were added. What the count buys instead is a mechanism, and it has a
shape already in this repository: `test/spec.test.js` holds one declaration
(§10's vocabulary) with a general rule, and `test/counts.test.js` discovers the
documents to read rather than naming them in a list. The mechanism for these
fourteen is a **declaration registry** — one table of rows, each naming a spec
locator, a code accessor, and how the two are compared (as a set, as a count, as
a value) — driven by one reader, so a fifteenth declaration is a row rather than
a test. The enforcement half is the part that makes it a mechanism rather than an
inventory: every exported constant under `verifier/**` that mirrors a statement
in `SPEC.md` must appear in the registry, checked the way §10's registry is
checked in both directions, so a declaration added to the code and left out of
the document fails rather than being noticed later by an audit like this one.

That is a change to the test suite's structure rather than an addition to it, and
it is the next step, not this one.

## The session

`docs/first-user.md` is written and empty, and **the session has not been run**.
It cannot be run by an agent: it requires a person with a document that matters
to them, no interest in reading a specification, and the willingness to watch
without helping. No such person was available for this work, and nothing in
`docs/first-user.md` was touched. The reason it stays empty is the same reason it
was written before the session: a transcript produced by an agent that had read
`SPEC.md` would be the one thing that document exists to prevent.

