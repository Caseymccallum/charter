# charter/0.1

This document is the format. It is written to be read next to `verifier/`, and
where the two disagree the verifier is the bug: every rule below names the check
that enforces it, and a rule that no check enforces is not a rule.

The version string is `charter/0.1`. It appears in one place, the manifest's
`format` field, and a verifier that reads it and does not implement it says so
rather than applying the rules of a version it never read.

## 1. What a charter is for

A charter is a single file that carries a document, the history of that
document, and the identity of whoever signed both, in a form a stranger can
check without trusting the author, a server, or a clock.

Three claims are being made by an artifact that verifies:

1. these are the bytes of the document;
2. these signatures were made by the key the file carries;
3. this history is continuous with that document.

The third claim is the reason the format exists. Every other format that signs
a document proves claims 1 and 2. A charter also proves that the document you
are reading is the document the last entry was signed over, and that each entry
points at the exact bytes of the one before it.

## 2. The artifact

A `.charter` file is a ZIP archive. It holds exactly three entries:

| Entry | Contents |
| --- | --- |
| `manifest.json` | one JSON object: the format version, a title, a creation time, the digest of the content, the author's key, and a signature |
| `content.md` | the document, as UTF-8 bytes |
| `provenance.jsonl` | the edit history: one JSON object per line, each signed, each carrying the hash of the line before it |

Those names, in that set, and nothing else. `L0.ZIP.ENTRY_SET` reports a missing
entry, a duplicate name, or an extra entry, in that order of severity, and stops
at the first of the three.

ZIP is the container because it is the one container every operating system can
open without a library, which means a reader who does not trust this verifier
can still look at the three files. The cost is that ZIP carries a great deal
that a document format has no use for, and section 3 is mostly about refusing
it.

## 3. The container

Everything in this section is enforced by a check whose id starts with
`L0.ZIP.`.

### 3.1 Legibility

A single end-of-central-directory record, found by scanning backwards over at
most 65,535 bytes, describes a central directory that lies inside the file and
declares exactly as many entries as it contains. Each central directory record
points at a local header, and the local header's name is byte-for-byte the
central directory's name. `L0.ZIP.READABLE` fails when any of that does not
hold, and no other check runs: there is no container to read.

### 3.2 Feature level

No ZIP64. Every entry's "version needed to extract" is at most 20 (2.0), on one
disk. `L0.ZIP.VERSION` reports UNSUPPORTED for ZIP64 and for a multi-disk
archive, because a reader that guessed at a 64-bit size would be guessing at
the bytes.

### 3.3 Compression and flags

Each entry is stored (method 0) or raw-deflated (method 8). Anything else is
UNSUPPORTED, not a failure: the reader does not implement it, and an entry it
cannot expand is an entry it cannot judge. `L0.ZIP.ENTRY_DATA` reports it.

Exactly three general purpose bits are allowed: `0x0002` and `0x0004` (deflate
level hints, which say how the writer worked, not what the bytes mean) and
`0x0800` (the name is UTF-8). Five more bits describe features this reader does
not implement and are reported as UNSUPPORTED: `0x0001` encryption, `0x0008` a
data descriptor, `0x0020` patched data, `0x0040` strong encryption, `0x2000` a
masked local header. Any other bit is FAIL with reason EXTRA. All of this is
`L0.ZIP.FLAGS`.

### 3.4 Layout

Every byte of the file is accounted for by a local header, an extra field, an
entry's data, the central directory, or the end record, in that order, with
nothing before the first header, nothing between entries, nothing between the
last entry and the central directory, nothing after the end record, and no
archive comment. `L0.ZIP.LAYOUT` fails with reason EXTRA when bytes appear
where the format does not put them.

This is the rule that makes "the three entries" a claim about the file rather
than a claim about a lookup table. Without it, an archive can hold a second
copy of `content.md`, and two readers can disagree about which one is the
document.

### 3.5 Declared sizes and CRC-32

Every entry declares the uncompressed size and the CRC-32 of the bytes it
holds, and both are true of the bytes actually in the file. `L0.ZIP.SIZES` and
`L0.ZIP.CRC32` are the two checks that have to decompress in order to answer,
and they are also the two checks that catch a container whose headers have been
edited around untouched payload bytes.

### 3.6 Metadata the format fixes

ZIP gives each entry two places to state the same facts and several fields for
facts a document has no use for. charter/0.1 fixes all of them, and
`L0.ZIP.METADATA` enforces it:

| Field | The one value a charter/0.1 file may hold |
| --- | --- |
| version made by | `0x0014`: version 2.0 on host 0 (MS-DOS), so written by a tool rather than by a file system |
| last mod file date | `0x0021`: 1980-01-01, the earliest date a DOS date field can hold |
| last mod file time | `0`: 00:00:00 |
| disk number start | `0` |
| internal attributes | `0` |
| external attributes | `0` |

The DOS stamp is the part worth explaining. A file whose bytes are the record
cannot also carry a reading of a clock: if two writers stamp the same document
with two different times, the same document becomes two files, and a reader who
ignored the stamp would call them identical while a reader who did not would
call them different. charter/0.1 removes the question by fixing the field at
the value that means "no time".

The same check binds the two copies of every claim the archive makes twice.
Version needed, compression method, CRC-32, compressed size, uncompressed size,
DOS date and DOS time must be equal in the local header and in the central
directory. Flags are not in that list because the reader has to agree with
itself about flags before it can decode anything, and refuses there instead.

The rule behind this one is worth stating plainly, because it is the rule that
closed the last hole found in this verifier: **a byte the reader never looks at
is a byte a forged file can change for free.** Every field a reader skips is a
field that can be rewritten without changing a single thing the verdict
reports.

### 3.7 Limits

An artifact that cannot be bounded cannot be checked, and a verifier that
allocates without limit is a verifier that can be made to hang. Exceeding one
of these is a refusal with reason `LIMIT_EXCEEDED`, never a slow pass.

| Dimension | Ceiling |
| --- | --- |
| Whole file | 256 MiB |
| One entry, compressed | 64 MiB |
| One entry, declared uncompressed (inflation stops past it) | 64 MiB |
| Entries in `provenance.jsonl` | 100,000 |
| Bytes of one provenance line | 1 MiB |
| JSON nesting depth | 64 |
| ZIP entry name length | 65,535 bytes |
| End-of-central-directory search range | 65,535 bytes |

These numbers are part of the published behaviour of charter/0.1. Changing one
changes what a verdict means, so the change belongs in this document and in the
recorded conformance answers, not in a patch.

## 4. Canonical JSON

All three entries are JSON, and all three are signed, so all three have to have
exactly one byte sequence per value. `verifier/canonical.js` is that one byte
sequence, and it is a subset of RFC 8785 (the JSON Canonicalization Scheme) with
three deliberate differences:

1. **Integers only.** An integer is written `0`, or `-?[1-9][0-9]*`, and must
   round-trip through a 53-bit integer. `1.0`, `1e0`, `-0`, `01` and
   `9007199254740993` are each a violation: the first three are reported as
   NON_INTEGER_NUMBER, the last as NUMBER_OUT_OF_RANGE.
2. **Keys sorted by code point.** RFC 8785 sorts by UTF-16 code unit. The two
   orders disagree above U+FFFF, so this format says code point and means it.
3. **A file is one canonical value followed by exactly one LF.** RFC 8785 has
   no opinion about the file; this format puts the terminator in the format, so
   that "the file ends where the value ends" is a checkable claim.

The rest of the rules:

- No whitespace outside strings, no trailing comma, no comment.
- Every string is escaped the one way: `\"` and `\\` always, the short escapes
  `\b \t \n \f \r` for those five control characters, `\uXXXX` with lowercase
  hexadecimal digits for the remaining control characters below U+0020, and
  literally everything else. So `/` is `/`, `é` is `é`, and `\u00e9` for `é` or
  `\/` for `/` is well-formed JSON that is rejected as non-canonical.
- An unpaired surrogate escape is refused: `\ud800` alone, and `\udc00` alone,
  are both MALFORMED. A verifier that accepted them would produce a string that
  cannot survive the trip back out through UTF-8.
- No duplicate keys. A reader that keeps the last one and a reader that keeps
  the first disagree about what was signed, so the object is refused with
  reason DUPLICATE.
- Nesting deeper than 64 is refused.

Whitespace and key order are tolerated *while parsing*, so that a violation can
be reported as "this is well-formed JSON but not the canonical bytes for it"
(NON_CANONICAL) rather than as a bare syntax error. A verdict a stranger can act
on has to say which of the two happened.

### 4.1 The bytes a signature covers

A signature covers the canonical form of the object **with its `signature` field
removed**, followed by one LF. That is the whole rule, and it is applied
identically to `manifest.json` and to each line of `provenance.jsonl`.

The trailing LF is not decoration. Without it, a signature over one object could
be moved to another place in a document where it happens to be a prefix of the
canonical text, and both placements would verify.

This is why the canonical-byte rule and the signed-byte rule are two functions
in `verifier/canonical.js`: `canonicalBytes` produces the bytes that a file must
contain, and `signingInput` produces the bytes a signature is computed over.

## 5. `manifest.json`

One canonical JSON object, one LF, and no other field than these six:

| Field | Requirement | Check |
| --- | --- | --- |
| `format` | exactly `"charter/0.1"` | `L0.MANIFEST.FORMAT` |
| `title` | a non-empty string | `L0.MANIFEST.FIELDS` |
| `created_at` | ISO 8601 UTC at second precision, `YYYY-MM-DDTHH:MM:SSZ` | `L0.MANIFEST.FIELDS` |
| `content` | an object whose only field is `sha256`, 64 lowercase hex characters | `L0.MANIFEST.FIELDS` |
| `author` | an object with exactly `name`, `algorithm`, `key_id`, `public_key` | `L0.MANIFEST.FIELDS` |
| `signature` | unpadded base64url, decoding to 64 bytes | `L0.MANIFEST.FIELDS` |

`L0.MANIFEST.CANONICAL` compares the bytes on disk against the canonical bytes
for the object they parse to, followed by one LF. A file that parses and is not
canonical is refused; a file whose fields are well formed but unusual is not,
which is the whole difference between syntax and semantics in this format.

`format` is checked before anything else, and a value this verifier does not
implement produces UNSUPPORTED and stops the manifest checks. Applying the rules
of charter/0.1 to a file that declares charter/0.2 would be inventing a verdict.

`created_at` is validated by arithmetic, not by `Date`: the date is parsed by
hand, February gets 29 days in a leap year, and hours, minutes and seconds are
bounded at 23, 59 and 59. A verifier that consulted the host's timezone rules
could answer differently on two machines, and this format fixes UTC, so there is
nothing for a timezone to resolve. A declared time is a claim about when the
author says they wrote it; it is not evidence, and section 11 says so.

`L0.MANIFEST.EXTRA_FIELDS` fails on any field this document does not define,
with reason UNKNOWN_FIELD. A field nobody interprets is a field that can be
changed without changing the verdict, and this format does not carry those.

`manifest.author.algorithm` is an enumeration, and this version defines exactly
one value, `"ed25519"`. An algorithm this version does not define is reported as
a field value it does not define, not skipped over.

## 6. `content.md`

The document. Three requirements and no others:

- `L0.CONTENT.UTF8`: the bytes are valid UTF-8, and there is no byte order mark.
  The mark is refused rather than tolerated because the bytes of the file are the
  content: a mark that a reader agreed to ignore would be content that some
  readers count, and the digest in the manifest counts it either way.
- `L0.CONTENT.HASH`: SHA-256 of those bytes is the digest the manifest declares.
- Nothing else. The verifier never parses Markdown, never normalizes line
  endings, and never rewrites the bytes. It checks that the bytes are the bytes
  that were signed.

## 7. `provenance.jsonl`

The history. One JSON object per line, each line closed by exactly one LF, and
each object carrying exactly these seven fields:

| Field | Requirement |
| --- | --- |
| `timestamp` | ISO 8601 UTC at second precision, as in the manifest |
| `action` | `"create"` or `"edit"`, and nothing else |
| `summary` | a non-empty string, written for a human |
| `author` | an object with exactly `name` and `key_id` |
| `parent` | 64 lowercase hex characters, or `null` |
| `content_sha256` | 64 lowercase hex characters |
| `signature` | unpadded base64url, decoding to 64 bytes |

The file is read as **bytes** and split on `0x0A` before any line is decoded.
A verifier that read it through a text decoder would have already lost its
ability to notice a CRLF, a missing final newline, or a byte order mark, and
those are precisely the differences that change what the next entry's parent
covers. `L0.PROVENANCE.PARSE` fails on a file that does not end with an LF, on
an empty line, and on any line that is not a JSON object.

"At least one entry" is its own check, `L0.PROVENANCE.NONEMPTY`. A log with no
entries is not a malformed file, it is a file that records nothing, and a reader
deserves to be told which of the two happened.

## 8. Keys and key ids

One algorithm: Ed25519 (`ed25519`). A public key is 32 bytes and a signature is
64 bytes, both written as unpadded base64url. The alphabet is the URL-safe one,
`=` is not allowed, and a trailing bit pattern that is not zero (the classic
`AB` versus `AA` ambiguity) is refused: canonical base64url has one spelling per
byte string, and this format uses that one.

A key id is the name of a key, and it is derived rather than declared:

```
key_id = "ed25519:" + lowercase hex SHA-256 of the 32 public key bytes
```

`L1.MANIFEST.KEY_ID` recomputes that and compares. This is what stops an
artifact from carrying a key id that belongs to some other key: an entry's key
id is only useful to a reader who can recompute it from the key the artifact
carries, and a reader who cannot is reading a name for nothing.

`L1.MANIFEST.SIGNATURE` and `L1.PROVENANCE.SIGNATURES` verify the signatures
over the bytes described in section 4.1. `L1.PROVENANCE.SIGNATURES` reports the
first entry that does not verify rather than the count of entries that do not,
because the first one is the one a reader has to look at.

`L1.PROVENANCE.FIRST_AUTHOR` and `L1.PROVENANCE.KEYS` hold the log to the one key
the file carries: the first entry must name the manifest's key, and every entry
must name it. A charter/0.1 artifact is a record of one author's edit history,
and an entry naming a key nobody can check is an entry that proves nothing.

If the runtime cannot verify Ed25519 signatures, these checks report UNSUPPORTED.
Verification that did not happen is not verification that succeeded.

## 9. The chain

This is the part that makes a charter worth having. Each entry commits to the
exact bytes of the entry before it:

> **`parent` of entry *n* is the SHA-256 of line *n-1* as it stands in the
> file: the canonical JSON of that entry, plus the one LF that closes it.**

Three consequences follow, and each of them is a check:

- `L2.CHAIN.FIRST_PARENT_NULL`: the first entry declares `null`, so the chain
  starts where it says it starts and not in the middle of another one.
- `L2.CHAIN.LINKS`: every later entry's `parent` is that digest. Because the
  digest covers the LF as well as the text, an attacker cannot reflow the file,
  change a line ending, or drop the final newline without breaking the link.
- `L2.CHAIN.HEAD_MATCHES_CONTENT`: the last entry's `content_sha256` is the
  digest the manifest declares for `content.md`. This is what ties the history
  to the document: the file you are reading is the revision the last entry was
  signed over, and not a revision that was swapped in afterwards.

Note what the chain does **not** establish, which section 11 states again: it
proves order and continuity, not uniqueness. Whoever holds the private key can
write a different history, sign it, and hand you that instead.

## 10. Verdicts

Every check ends in exactly one of four statuses:

| Status | Meaning |
| --- | --- |
| `PASS` | the check ran and its requirement holds |
| `FAIL` | the check ran and its requirement does not hold |
| `SKIP` | the check could not run because something it depends on failed |
| `UNSUPPORTED` | the artifact uses something this verifier does not implement |

There is no fifth status and no "pass with warnings". Two rules follow from the
list, and both of them exist because the alternative is a verdict that reads
better than it is:

- **A check that never ran is SKIP, never PASS.** An absence of evidence is
  reported as an absence of evidence.
- **An unrecognised feature is UNSUPPORTED, never PASS.** A verifier that
  shrugged at a compression method it does not implement would be signing off on
  bytes it never read.

Three verdicts, over all 30 checks:

| Verdict | Condition | Exit code |
| --- | --- | --- |
| `VERIFIED` | every check PASS | 0 |
| `INCOMPLETE` | no FAIL, at least one SKIP or UNSUPPORTED | 1 |
| `BROKEN` | at least one FAIL | 2 |

The CLI adds two codes of its own: 64 when the command line was not understood,
and 66 when the named file could not be read. Neither is a verdict; a file that
was not read has not been judged.

A reason code is attached to every result: OK, MALFORMED, MISMATCH, MISSING,
EXTRA, DUPLICATE, NON_CANONICAL, NON_CANONICAL_ENCODING, NON_INTEGER_NUMBER,
NUMBER_OUT_OF_RANGE, DECODE_ERROR, UNSUPPORTED_VERSION, UNSUPPORTED_FEATURE,
UNKNOWN_FIELD, LIMIT_EXCEEDED, PREREQUISITE_FAILED. The prose `detail` may be
reworded between releases; the `reason_code` is part of the recorded
conformance answers and may not be.

The 30 checks, in the order they always appear in a verdict:

| Level | Check | Requirement |
| --- | --- | --- |
| L0 | `L0.ZIP.READABLE` | the artifact is a ZIP this verifier can walk |
| L0 | `L0.ZIP.VERSION` | no ZIP64, no multi-disk |
| L0 | `L0.ZIP.FLAGS` | no general purpose bit other than the three allowed |
| L0 | `L0.ZIP.LAYOUT` | every byte is accounted for, in order |
| L0 | `L0.ZIP.METADATA` | no host, disk, clock or attributes; both copies of a claim agree |
| L0 | `L0.ZIP.ENTRY_SET` | exactly the three required entries |
| L0 | `L0.ZIP.ENTRY_DATA` | stored or raw-deflated, and it decodes |
| L0 | `L0.ZIP.SIZES` | the declared uncompressed size is the real one |
| L0 | `L0.ZIP.CRC32` | the declared CRC-32 is the real one |
| L0 | `L0.FORMAT.IDENTIFIER` | `manifest.format` is exactly `"charter/0.1"` |
| L0 | `L0.MANIFEST.PARSE` | one well-formed JSON object |
| L0 | `L0.MANIFEST.CANONICAL` | the bytes are the canonical form plus one LF |
| L0 | `L0.MANIFEST.FIELDS` | the six fields, correctly typed and encoded |
| L0 | `L0.MANIFEST.EXTRA_FIELDS` | no field this version has no rule for |
| L0 | `L0.CONTENT.UTF8` | valid UTF-8, no byte order mark |
| L0 | `L0.CONTENT.HASH` | the digest of the content matches the manifest |
| L0 | `L0.PROVENANCE.PARSE` | one JSON object per LF-terminated line |
| L0 | `L0.PROVENANCE.CANONICAL` | each line is its canonical form plus one LF |
| L0 | `L0.PROVENANCE.FIELDS` | the seven fields of every entry, typed and encoded |
| L0 | `L0.PROVENANCE.EXTRA_FIELDS` | no field this version has no rule for |
| L0 | `L0.PROVENANCE.NONEMPTY` | at least one entry |
| L0 | `L0.PROVENANCE.CONTENT_HASH_FORMAT` | every `content_sha256` is a lowercase digest |
| L1 | `L1.MANIFEST.KEY_ID` | the key id is the derivation of the public key |
| L1 | `L1.MANIFEST.SIGNATURE` | the manifest signature verifies |
| L1 | `L1.PROVENANCE.FIRST_AUTHOR` | the first entry names the manifest's key |
| L1 | `L1.PROVENANCE.KEYS` | every entry names the key the file carries |
| L1 | `L1.PROVENANCE.SIGNATURES` | every entry signature verifies |
| L2 | `L2.CHAIN.FIRST_PARENT_NULL` | the first entry starts from nothing |
| L2 | `L2.CHAIN.LINKS` | every `parent` is the digest of the line before it |
| L2 | `L2.CHAIN.HEAD_MATCHES_CONTENT` | the head describes the content the manifest describes |

The order is fixed, and every verdict contains all 30 entries with this order,
so two verdicts can be compared line by line and two runs over one artifact are
byte-identical. Prose is not the interface; the ids, statuses and reason codes
are, and a check that tried to report an id outside this registry would be
refused before it could.

## 11. What this does not protect against

A `VERIFIED` verdict means the artifact is internally consistent, signed by the
key it carries, and says nothing false about its own bytes. It does not mean the
document is true, useful, recent, or written by anyone in particular. The
verifier prints these five statements with every verdict, and they are not
checks: no amount of care could decide them from the artifact alone.

1. **Intermediate content hashes are unconfirmed.** Every entry but the last
   declares a `content_sha256` that nothing in the artifact can confirm: the
   bytes of an intermediate revision are not in the file. Only the final
   revision is bound to `content.md`.
2. **The key holder can rewrite history.** Whoever holds the private key can
   replace the last entry, or every entry, and re-sign the whole log, and this
   verifier cannot tell that the earlier bytes ever existed. The chain proves
   order and continuity, not uniqueness.
3. **Keys are self-declared.** The public key travels inside the file it signs,
   so a valid signature proves only that the signer held the matching private
   key. Nothing here ties a key to a person, an organisation, or a name a reader
   would recognise. `author.name` is a claim by the author about the author.
4. **Timestamps are claims.** Every timestamp is written by the signer and
   signed by the signer. Nothing in the format witnesses a time, so an entry can
   carry any instant its author chose. That is why the container carries no DOS
   clock reading either (section 3.6): the only times in the file are the ones
   the author signed for, and they are claims, not evidence.
5. **Content is not judged.** This verifier reads the bytes of `content.md` and
   checks that they are UTF-8 and match the declared digest. It does not
   interpret them, and a well-formed artifact can hold content that is false,
   unlawful, or worthless.

Three more limits are worth stating even though no caveat id carries them:

- **No revocation, no transparency log, no freshness.** A charter is a
  self-contained file. There is no authority to ask whether a key was
  compromised, and no way to prove that a *different* valid history does not
  exist somewhere else. Anything of that kind belongs above this format, not
  inside it.
- **The container leaks what a container leaks.** The compressed size of
  `content.md` is visible, so a charter reveals roughly how long its document
  is. ZIP is not a confidentiality mechanism and this format does not pretend
  otherwise.
- **A short history is a valid history.** An artifact whose log holds one
  `create` entry and nothing else verifies, and so does an artifact whose
  history starts the day someone decided to start keeping one. The chain cannot
  tell you what happened before its first entry.

## 12. Running it

Verify one file:

```
node cli/charter.js verify path/to/file.charter        # the verdict, and the checks that did not pass
node cli/charter.js verify path/to/file.charter --all  # every check
node cli/charter.js verify path/to/file.charter --json # the verdict as JSON, and nothing else
```

`--json` prints the verdict and nothing else, which is the form a script should
consume. The human form prints the verdict, the failing and unsupported checks
with their reason codes and prose, the caveats of section 11, and a count of the
checks that were not reached.

The verifier needs **Node 20.12 or later**. Two runtime facilities decide that
floor and no third one does: WebCrypto Ed25519, which is how a signature is
checked without a cryptography dependency, and `DecompressionStream` with the
`deflate-raw` format, which is how a deflated entry is expanded without a copy of
zlib. `deflate-raw` appears in Node 20.12; `globalThis.crypto` appears in Node
20.0. On an older runtime nothing here throws: every check that cannot be
performed is reported `UNSUPPORTED` with reason `UNSUPPORTED_FEATURE`, which is
`INCOMPLETE`, and `INCOMPLETE` is not a pass.

Run the tests:

```
npm test        # node --test: the runner finds test/*.test.js by itself
```

The tests are written against this document, not against the implementation, and
`test/purity.test.js` enforces the architectural rule that makes any of this
worth trusting: nothing under `verifier/**` may import `node:`, read a file,
touch the network, or consult a clock. The verifier is a function from bytes to
a verdict. `cli/charter.js` is the only file in the project that reads a file,
and `vectors/` and `test/` are the only other places allowed to look at the
world outside a byte array.

## 13. The conformance kit

`vectors/` is a kit a stranger can run without trusting this implementation.

- **`vectors/build.js` builds** the artifacts. It shares no code with
  `verifier/**`: hashing and signing come from `node:crypto`, and the canonical
  JSON writer and the ZIP writer inside it are written from sections 3 and 4 of
  this document rather than derived from the reader. If two independently
  written implementations agree that a byte sequence is the canonical form of a
  value, that agreement is evidence about the format; two copies of one bug
  would be evidence about nothing.
- **`vectors/expected.json` is the record.** For each artifact it holds the
  artifact's own SHA-256, the verdict, the exit code, the failing checks with
  their reason codes, the unsupported checks, and the number of checks that were
  never reached. `build.js` refuses to write the record if the verifier disagrees
  with the verdict each case states it ought to produce, so the record cannot be
  edited into agreement with a buggy reader.
- **`vectors/out/*.charter` are the artifacts**, and they are committed. A
  record of files nobody has is not a record.
- **`vectors/run.js` is the replay**, and it is the reader's program, not the
  author's. It reads `expected.json`, reads each file the record names, and asks
  the verifier for a verdict. The recorded digest is compared first: if the bytes
  on disk are not the bytes the record describes, the replay says so and keeps
  going, because "this file has been swapped" and "this verdict is wrong" are two
  different claims and a reader needs to know which one they are looking at.

```
node vectors/run.js            # replay the kit: 26 artifacts, 26 recorded answers
node vectors/build.js          # rebuild the artifacts (the author's program)
node vectors/build.js --check  # rebuild in memory, and refuse if the record is stale
```

The 26 cases are the ways an artifact can be wrong. `valid` is the artifact all
of them are variations on, and `valid-deflate` is the same document with deflated
entries: they verify identically, because the compression method is not part of
what the document is. The container cases are `not-a-zip`, `missing-entry`,
`extra-entry`, `duplicate-entry`, `encrypted-flag`, `unsupported-method`,
`wrong-declared-size`, `wrong-declared-crc` and `stamped-by-a-clock` (a DOS
stamp left in by a writer that behaved like a file system). The document cases
are `noncanonical-manifest`, `manifest-extra-field`, `manifest-field-unreadable`,
`unsupported-format`, `content-bom` and `content-tampered`. The log cases are
`unterminated-log`, `truncated-log`, `empty-log`, `entry-extra-field` and
`entry-edited`. The signed-claim cases are `bad-manifest-signature`,
`foreign-key-entry` and `history-rewritten`.

Two properties in the kit are worth keeping when it grows, and both live in
`test/vectors.test.js` rather than in the kit itself, because they are properties
of the verifier rather than answers about one file:

- **No single-byte change to `valid.charter` may produce `VERIFIED`.** The kit
  checks a neighborhood, not one point in it.
- **Every truncation of a valid artifact must be refused.** A reader that accepts
  a prefix of a file has agreed to judge incomplete bytes.

## 14. What changes a version

A change that alters any of the following is a different format, and the
identifier in `manifest.format` changes with it:

- the set of entry names, or the fields of the manifest or of an entry;
- the canonical form of a value, or the bytes a signature covers;
- the chain rule in section 9;
- the statuses, the verdicts, the exit codes, or the reason codes;
- any number in the limits table.

A verifier implementing charter/0.1 refuses an artifact that declares anything
else, and reports UNSUPPORTED rather than applying the nearest rules it knows.
That is the only behaviour that lets two strangers agree about what a verdict
means when they are running different software: the format identifier is a
promise about which rules were applied, and a reader who ignores it is guessing
on the author's behalf.
