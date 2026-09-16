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
at the first of the three. A name that appears twice is refused, and the checks
that follow read the copy whose local header comes first in the file: the artifact
is broken either way, and the bytes a verdict is about should be the bytes the
file states first rather than the bytes a directory happened to end on.

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
| Bytes of one JSON document (`manifest.json`) | 1 MiB |
| JSON nesting depth | 64 |
| ZIP entry name length | 65,535 bytes |
| End-of-central-directory search range | 65,535 bytes |

These numbers are part of the published behaviour of charter/0.1. Changing one
changes what a verdict means, so the change belongs in this document and in the
recorded conformance answers, not in a patch.

A limit is checked before the work it bounds, not after: the container's size is
compared before the archive is walked, an entry's declared size is compared
before it is inflated, and a JSON document's length is compared before it is
decoded or parsed. An input above a ceiling is refused with `LIMIT_EXCEEDED`,
which is a `FAIL` and therefore `BROKEN` — the artifact is not called unproven,
because a file that is too large to check is a file this verifier has not
checked.

## 4. Canonical JSON

All three entries are JSON, and all three are signed, so all three have to have
exactly one byte sequence per value. Two modules hold that rule, one per
direction: `verifier/canonical.js` reads bytes into a value or refuses them, and
`verifier/canonical-write.js` takes a value and writes the one byte sequence for
it. They share this section and the reason vocabulary in `verifier/status.js`,
and they share no code — nothing in the writing direction imports the reading
direction, and the reading direction does not call it. A round trip between two
implementations written apart is evidence about the format; a round trip through
one implementation is evidence about that implementation.

Canonical form is a subset of RFC 8785 (the JSON Canonicalization Scheme) with
three deliberate differences:

1. **Integers only.** An integer is written `0`, or `-?[1-9][0-9]*`, and must
   round-trip through a 53-bit integer. `1.0`, `1e0`, `-0`, `01` and
   `9007199254740993` are each a violation: the first four are reported as
   NON_INTEGER_NUMBER, the last as NUMBER_OUT_OF_RANGE. A leading zero is a
   second spelling of an integer rather than a different integer — `String(01)`
   is `"1"`, which is why it belongs to the family whose reason code says the
   value is not the number a reader would write.
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
- An unpaired surrogate is refused, spelled either way: the escape `\ud800`
  alone and the escape `\udc00` alone are MALFORMED, and so is either of them
  written as a literal character in the text. A verifier that accepted one would
  produce a string with no canonical bytes — UTF-8 cannot encode half a
  character, so the trip back out through a `TextEncoder` would deliver U+FFFD
  and a different string than the one that was signed. A correctly paired
  surrogate is an ordinary character, escaped or literal, and is kept.
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
in `verifier/canonical-write.js`: `canonicalBytes` produces the bytes that a file
must contain, and `signingInput` produces the bytes a signature is computed
over. `canonicalDocument` is the first of those with the terminator appended, so
that "one value and one LF" is written once rather than at every call site.

### 4.2 The same values, both ways

The set of values the serializer accepts is exactly the set of values the reader
can produce. Neither direction can form a document the other cannot handle: a
value that cannot be written is refused by name, with the reason code a verdict
would print for the same defect, and with the path to the offending value
(`.content.sha256`, `[3].timestamp`).

| A producer's value | Reason code | Why it is refused rather than written |
| --- | --- | --- |
| a number that is not an integer, including `-0` and `NaN` | NON_INTEGER_NUMBER | `String(-0)` is `"0"`: writing it would sign a value that says zero. The reader refuses `1.0`, `1e0` and `-0` alike, and a value carries no spelling, so the writer splits the two codes by *value*: not an integer, or an integer too large. |
| an integer outside ±(2^53 − 1) | NUMBER_OUT_OF_RANGE | `String` would write a different number than the one passed in. |
| a string or a key holding an unpaired surrogate | MALFORMED | UTF-8 has no encoding for half a character: the bytes would carry U+FFFD. |
| an array with a hole, or with an own property that is not an index | MALFORMED | `[1,,2]` is not JSON, and `join` would write exactly that. |
| anything that is not a JSON value: `undefined`, a function, a symbol, a bigint, a `Date`, a `Map`, a class instance, a typed array | MALFORMED | `Object.keys(new Date())` is `[]`, so an object walker writes `{}` for a date without a word. `JSON.stringify` writes a timestamp instead. Neither is a document this format defines. |
| a value nested deeper than 64 | MALFORMED | The reader's ceiling for the same condition. A writer without one does not refuse a deep value, it throws a `RangeError` — and a value that contains itself is caught by the same ceiling one level later, rather than recursing until the stack ends. |

**A canonical document is a fixed point.** Reading a document's bytes to a value
and writing that value back produces the same bytes, byte for byte. This is the
property the format's reimplementability rests on: the bytes of a
`manifest.json` or a `provenance.jsonl` line may be checked against any
implementation's writer, and a difference is a difference about the format
rather than about whose code ran. `test/canonical.roundtrip.test.js` states it in
both directions, over the committed artifacts, over the parser's fuzz corpus, and
over generated values.

## 5. `manifest.json`

One canonical JSON object, one LF, and no other field than these six:

| Field | Requirement | Check |
| --- | --- | --- |
| `format` | present, a string, and exactly `"charter/0.1"` | `L0.FORMAT.IDENTIFIER` |
| `title` | a non-empty string | `L0.MANIFEST.FIELDS` |
| `created_at` | ISO 8601 UTC at second precision, `YYYY-MM-DDTHH:MM:SSZ` | `L0.MANIFEST.FIELDS` |
| `content` | an object whose only field is `sha256`, a string | `L0.MANIFEST.FIELDS` |
| `author` | an object with exactly `name`, `algorithm`, `key_id`, `public_key`, each a non-empty string | `L0.MANIFEST.FIELDS` |
| `signature` | unpadded base64url, decoding to 64 bytes | `L1.MANIFEST.SIGNATURE` |

**A field's spelling belongs to the check that reads it.** `L0.MANIFEST.FIELDS`
answers whether the fields are present and whether each holds the JSON value the
table names, and nothing more: an uppercase digest, a key that is not 32 bytes
and a signature written with `=` all pass it. The checks that *read* those values
report what is wrong with the encoding:

| Value | Check | A value that does not decode, or has the wrong length | A second spelling of the same bytes |
| --- | --- | --- | --- |
| `content.sha256` | `L0.CONTENT.HASH`, `L2.CHAIN.HEAD_MATCHES_CONTENT` | MALFORMED | NON_CANONICAL_ENCODING |
| `author.public_key` | `L1.MANIFEST.KEY_ID` | MALFORMED | NON_CANONICAL_ENCODING |
| `signature` | `L1.MANIFEST.SIGNATURE` | MALFORMED | NON_CANONICAL_ENCODING |

The distinction is the difference between a value that is not the value and a
value that is the same value spelled a second way. `0097e5…` and `0097E5…` are
not two digests, they are one digest and one file that would be a second file:
canonical hex has lowercase digits, canonical base64url has no padding and no
trailing bit pattern that is not zero, and NON_CANONICAL_ENCODING is the reason
code for accepting either. `L1.MANIFEST.KEY_ID` and `L1.MANIFEST.SIGNATURE` are
also where an unusable key is reported, which is why the checks that depend on
the key are skipped when it says so: an entry's author can be compared with a key
identity, and there is none.

`L0.MANIFEST.CANONICAL` compares the bytes on disk against the canonical bytes
for the object they parse to, followed by one LF. A file that parses and is not
canonical is refused; a file whose fields are well formed but unusual is not,
which is the whole difference between syntax and semantics in this format.

`format` is checked before anything else, and it is checked by
`L0.FORMAT.IDENTIFIER` rather than by `L0.MANIFEST.FIELDS`, because a check that
runs before the fields can be read is the check that has to report a field that
is not there: a `format` that is absent is MISSING, one that is not a string is
MALFORMED, and a value this verifier does not implement produces UNSUPPORTED and
stops the manifest checks. Stops means the checks after it are SKIP, with reason
UNSUPPORTED_VERSION rather than PREREQUISITE_FAILED, so that a reader can tell
"nobody read the rules for this version" from "the rules were read and something
in them broke". Applying the rules of charter/0.1 to a file that declares
charter/0.2 would be inventing a verdict.

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

Emptiness is not a defect. `content.md` may be the empty byte string: it is
valid UTF-8, it carries no byte order mark, and its SHA-256 is a digest like any
other. A format whose central claim is that the bytes of the file are the
document does not also get to require that the document say something, so the
`empty-content` case in the conformance kit is `VERIFIED` on purpose. The rule
for an absent *history* is the opposite, and section 7 says why.

## 7. `provenance.jsonl`

The history. One JSON object per line, each line closed by exactly one LF, and
each object carrying exactly these seven fields:

| Field | Requirement |
| --- | --- |
| `timestamp` | ISO 8601 UTC at second precision, as in the manifest |
| `action` | `"create"` or `"edit"`, and nothing else |
| `summary` | a non-empty string, written for a human |
| `author` | an object with exactly `name` and `key_id`, each a non-empty string |
| `parent` | 64 lowercase hex characters, or `null` |
| `content_sha256` | 64 lowercase hex characters |
| `signature` | unpadded base64url, decoding to 64 bytes |

As in the manifest, `L0.PROVENANCE.FIELDS` answers whether the seven fields are
present and hold the JSON values the table names, and the spelling of a value is
the business of the check that reads it: `L0.PROVENANCE.CONTENT_HASH_FORMAT` for
`content_sha256`, `L2.CHAIN.LINKS` for `parent`, and `L1.PROVENANCE.SIGNATURES`
for the signature. A value that does not decode, or that is the wrong length, is
MALFORMED; a second spelling of the same bytes is NON_CANONICAL_ENCODING.

The file is read as **bytes** and split on `0x0A` before any line is decoded.
A verifier that read it through a text decoder would have already lost its
ability to notice a CRLF, a missing final newline, or a byte order mark, and
those are precisely the differences that change what the next entry's parent
covers. `L0.PROVENANCE.PARSE` fails on a file that does not end with an LF, on
an empty line, and on any line that is not a JSON object.

"At least one entry" is its own check, `L0.PROVENANCE.NONEMPTY`. A log with no
entries is not a malformed file, it is a file that records nothing, and a reader
deserves to be told which of the two happened. The check counts *entries*, not
lines: a file whose one line is `[1,2]` is a file with no entries, so PARSE
reports the line and NONEMPTY is SKIP rather than PASS.

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
| L0 | `L0.MANIFEST.FIELDS` | the required fields, present and correctly typed |
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

### 10.1 What a check depends on

A SKIP is a fact about the reader, not about the file, so the number of checks a
verdict never reached is part of the recorded conformance answers and has to be
the same in every implementation. That makes the dependency graph below part of
the format. It is stated here rather than left to be inferred from the order of
the registry, because a check may depend on one that is reported *before* it
(`L0.FORMAT.IDENTIFIER` is reported before `L0.MANIFEST.PARSE` and cannot run
until the manifest has been read) as well as on one after it.

| A check that does not pass | What is skipped because of it |
| --- | --- |
| any check at all, because `L0.ZIP.READABLE` failed | every other check: there is no container to read |
| `L0.ZIP.ENTRY_SET` (MISSING only) | every check that reads the entry that is absent |
| `L0.ZIP.ENTRY_DATA` | `L0.ZIP.SIZES`, `L0.ZIP.CRC32`, and every check that reads an entry whose bytes did not decode |
| `L0.MANIFEST.PARSE` | `L0.FORMAT.IDENTIFIER`, the other manifest checks, and every check that needs a manifest value |
| `L0.FORMAT.IDENTIFIER` | everything from `L0.MANIFEST.CANONICAL` onward, with reason UNSUPPORTED_VERSION |
| `L0.MANIFEST.FIELDS` | the manifest's key, signature and digest consumers, and the chain's head check |
| `L0.PROVENANCE.PARSE` | the other log checks, the two checks that read an entry's key, and the chain |
| `L0.PROVENANCE.FIELDS` | the log's key, signature, chain and head checks |
| `L0.PROVENANCE.NONEMPTY` | `L1.PROVENANCE.FIRST_AUTHOR`, `L2.CHAIN.FIRST_PARENT_NULL`, `L2.CHAIN.HEAD_MATCHES_CONTENT`: the three that name *the first* or *the last* entry |
| `L1.MANIFEST.KEY_ID`, when the key does not decode or is the wrong length | `L1.PROVENANCE.FIRST_AUTHOR`, `L1.PROVENANCE.KEYS`, `L1.PROVENANCE.SIGNATURES` |

Two rules make the graph answerable rather than approximate:

- **The check that owns a fact reports it, and everyone else is SKIP.** A fact
  computed once is reported once. `L0.MANIFEST.FIELDS` does not also fail when
  the signature is one byte short; `L0.CONTENT.HASH` does not also fail when the
  container's CRC-32 is wrong.
- **A skipped check carries PREREQUISITE_FAILED, unless the version gate stopped
  it.** The one exception is the reason a reader most needs to distinguish:
  checks stopped because the artifact declares a format this verifier does not
  implement carry UNSUPPORTED_VERSION.

A check that is *itself* the owner does not skip: a signature that cannot be
verified because the file's key is not a key is a FAIL with the reason the key
carries, not an absence of an answer. An absence of an answer is for the checks
that were never asked.

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
   the author signed for, and they are claims, not evidence. Two timestamps are
   never compared: an entry whose `timestamp` precedes its parent's is signed,
   chained, and `VERIFIED`, because the chain fixes the order of *inclusion* and
   nothing in an artifact witnesses *time*. The `entry-with-earlier-timestamp`
   case in the kit is that case, kept `VERIFIED` on purpose.
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

### 12.1 The JSON form

The shape a script consumes is part of the interface, because two implementations
that print the same words in different keys are two formats wearing one name. One
JSON object, with these keys:

| Key | Value |
| --- | --- |
| `file` | the path as it was named on the command line, unmodified |
| `bytes` | the size of the file |
| `verdict` | one of the three verdicts |
| `exit_code` | the code the process exits with |
| `summary` | `pass`, `fail`, `unsupported`, `skip`, `total`: five integers, and `total` is always 30 |
| `artifact` | what the file claims, or `null` |
| `checks` | all 30, in registry order, each `id`, `level`, `status`, `reason_code`, `detail`, `requirement` |
| `limitations` | the statements of section 11, each `id` and `statement` |

`artifact` is an object with `format`, `title`, `created_at`, `author_name`,
`author_key_id`, `entries` and `head_content_sha256` — and it is `null` exactly
when the file does not claim that much: when there is no container to read, when
`manifest.json` is absent or its bytes do not decode, when the manifest does not
parse, when its fields are not well formed, or when it declares a format this
verifier does not implement. `entries` is the number of entries the log holds, or
`0` when the log cannot be read that far, and `head_content_sha256` is the digest
the *manifest* declares for the content — the claim, not a measurement of it.

`detail` and `requirement` are prose and may be reworded; every other value here
is part of the recorded answers and may not be.

The commands that write and describe files are the producer's:

```
node cli/charter.js keygen -o key.pem                  # an Ed25519 key, PKCS#8 PEM
node cli/charter.js seal <content.md> --key <key.pem> -o <out.charter>
node cli/charter.js inspect <file.charter>             # what a file claims
node cli/charter.js cite <file.charter>                # one CSL-JSON item
```

Exit codes are five for `verify`, and they are the codes of a verdict: `0`
VERIFIED, `1` INCOMPLETE, `2` BROKEN, `64` the command line was not understood,
`66` the named file could not be read. The producer adds two, and neither is a
verdict: `65` the input was refused and the refusal has a reason code from the
vocabulary in `verifier/status.js`, and `73` the output file could not be
created. `seal`, `inspect`, `cite` and `keygen` also use `64` and `66`, and
`inspect` and `cite` exit `65` when a file holds nothing they can read. Section
14 changes a version when a *verdict* changes; these two codes belong to
commands that do not produce one.

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
node vectors/run.js            # replay the kit: 54 artifacts, 54 recorded answers
node vectors/build.js          # rebuild the artifacts (the author's program)
node vectors/build.js --check  # rebuild in memory, and refuse if the record is stale
```

The 26 Phase 1 cases are the ways an artifact can be wrong. `valid` is the
artifact all of them are variations on, and `valid-deflate` is the same document
with deflated entries: they verify identically, because the compression method is
not part of what the document is. The container cases are `not-a-zip`,
`missing-entry`, `extra-entry`, `duplicate-entry`, `encrypted-flag`,
`unsupported-method`, `wrong-declared-size`, `wrong-declared-crc` and
`stamped-by-a-clock` (a DOS stamp left in by a writer that behaved like a file
system). The document cases are `noncanonical-manifest`,
`manifest-extra-field`, `manifest-field-unreadable`, `unsupported-format`,
`content-bom` and `content-tampered`. The log cases are `unterminated-log`,
`truncated-log`, `empty-log`, `entry-extra-field` and `entry-edited`. The
signed-claim cases are `bad-manifest-signature`, `foreign-key-entry` and
`history-rewritten`.

The other 28 are the **adversarial pass**, and its enumeration is written down
in `test/adversarial.md` before it is run: one row per mutation, with the
verdict and the reason codes the specification requires, and the observed
result beside them. The rows cover the container (three points in the
truncation neighborhood, each of the three entries missing in turn, a
misdeclared compression method in both directions, a manifest one byte over the
document ceiling), the canonical bytes (pretty-printed, spaced, no terminator,
two terminators, and two signatures computed over a different serialization of
the right value), the content (a same-length replacement, a rewritten digest, a
stale signature), the signature and the key (one byte short, one bit flipped,
signed by another key, a swapped public key, a key id that does not derive from
the key beside it), and the chain (an unknown parent, a fork, reordering, an
entry removed from the middle, a head that describes other content).

Two rows have to come back `VERIFIED`:

- **`history-rewritten`**: the key holder replaces every entry and re-signs the
  whole log. Nothing in the file can tell that from a document written that way,
  so the verdict is `VERIFIED` and the caveat says so. A verifier that admitted
  what it cannot see is more trustworthy than one that claimed to see
  everything.
- **`entry-with-earlier-timestamp`**: an entry whose timestamp precedes its
  parent's. No check compares two timestamps, because nothing in an artifact
  witnesses time.

If a change to the verifier makes either of those come back `BROKEN`, the change
is breaking this document, not improving it.

Two properties in the kit are worth keeping when it grows, and both live in
`test/vectors.test.js` rather than in the kit itself, because they are properties
of the verifier rather than answers about one file:

- **No single-byte change to `valid.charter` may produce `VERIFIED`.** The kit
  checks a neighborhood, not one point in it.
- **Every truncation of a valid artifact must be refused.** A reader that accepts
  a prefix of a file has agreed to judge incomplete bytes.

`test/adversarial.test.js` adds the third: **the table in `test/adversarial.md`
is a claim the tests check**, row by row, by replaying each fixture and comparing
the verdict and the reason codes with what the row states. A table nobody runs is
prose. The same file walks every truncation in the last 512 bytes of
`valid.charter` rather than the three committed points, and it asserts that the
re-signing case is `VERIFIED` *and* that the caveat which qualifies it reaches a
person through `cli/charter.js`.

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

## 15. The producer

Everything above describes the *reader*: what a file is, what a verdict says,
and which check decides which claim. This section describes the writer that
comes with this implementation, and it exists to say one thing clearly: **the
producer is not part of the format.**

A `.charter` file is what sections 2 through 9 describe, and any program that
writes one is a producer. `producer/**` is this project's, and it is a reference
implementation: when a rule above and the producer disagree, the rule wins and
the producer is the bug. A second producer may compress its entries, write a
history of many entries, or record a different title, and none of that needs a
version change — the reader accepts anything it can check, and that is the whole
set of things this document describes.

Where the producer and the verifier must agree, they share code rather than
review: `canonicalDocument()` and `signingInput()` from
`verifier/canonical-write.js` for the bytes a signature covers, `deriveKeyId()`
from `verifier/manifest.js` for a key id, the timestamp rule in
`verifier/schema.js`, the CRC-32 in `verifier/crc32.js`, and the entry names and
actions in `verifier/verify.js` and `verifier/provenance.js`. Two derivations of
one name, or two writers of one byte sequence, would agree until they did not,
and the disagreement would be about the identity of a signer.

### 15.1 What `seal` writes

`seal` writes a new artifact: `format` is this version's identifier, `title` is
a claimed title (see 15.3), `created_at` is the time the author states, and
`content.md` is the document's bytes. It writes **one** provenance entry, with
`action` `create`, `parent` `null`, and `content_sha256` equal to the digest of
the content — which is what makes `L2.CHAIN.HEAD_MATCHES_CONTENT` hold for a
file that was never edited. Writing the later entries of a history is a verb
this producer does not have, and a reader is not affected by that: the format
accepts any log section 9 accepts.

An entry is stored, never deflated. Section 3.3 allows either, and a producer
that deflated would have artifact bytes that depend on the compressing library:
zlib's output changes between versions, so "the same document and the same key
produce the same bytes" would be true only within one runtime. Section 3.6
removed the clock from the container for the same reason, and a compressor is a
second clock.

### 15.2 A seal is deterministic

Sealing the same content with the same key and the same stated metadata produces
the same bytes, on every run and on every machine. The producer reads no clock,
no file, and no random source: it is a function from arguments to a byte
sequence, and the command line is what reads files and (with `--now`) the clock.

The time is an argument. Without one, the manifest's `created_at` and the
entry's `timestamp` are `1980-01-01T00:00:00Z` — the instant the container's
fixed DOS stamp means, so a file that states no time says so consistently in
both places. A producer that stamped the clock by default would make the same
document into a different file on every run, which is the outcome section 3.6
exists to prevent.

### 15.3 Where a title comes from

A title is needed twice — `manifest.title` is required, and a citation wants one
— and a `.charter` file offers three different statements, which are not
interchangeable:

| Where the title was read | What it is |
| --- | --- |
| stated by the person sealing or citing | an assertion by whoever ran the command |
| a `<title>` element, or the first ATX heading, inside `content.md` | the document's own text, covered by the digest the manifest declares |
| `manifest.title` | the artifact's claim about itself, signed but outside the content digest |

`seal` records the stated title if there is one, otherwise one derived from the
content, otherwise the name of the content file — which is not in the document at
all. `cite` reports which of the three it used, in
`custom.charter.title_source` (`asserted`, `derived` or `claimed`) and
`title_origin`, and says it in the note as well, so a reader can tell a claim the
caller made from a claim read out of the bytes the identifier names. The
derivation is deliberately shallow: it locates an element or a line, interprets
no Markdown, decodes no entities, and only collapses runs of whitespace, because
this format does not parse the documents it carries.

### 15.4 A citation

`cite` produces one CSL-JSON item. Its `id` is the claim hash — the SHA-256 of
the document the last entry was signed over, which is the value the manifest
declares and the chain's head confirms — so two files that make the same claim
about the same bytes cite as the same document, and the file each came from is
named in `custom.charter.artifact_sha256`. `issued` is the time the file states,
which is the author's claim; `accessed` is the day the citation was made, the
one date that comes from outside the file. A citation records what a file says.
Whether it holds up is a verdict, and this command does not produce one.

### 15.5 What the producer refuses

`seal` refuses what it cannot write, and every refusal carries a reason code from
the vocabulary in section 10 — the same names a verdict prints: content that is
not valid UTF-8 (`DECODE_ERROR`) or that begins with a byte order mark
(`NON_CANONICAL`), a key that is not Ed25519 (`UNSUPPORTED_FEATURE`), a key file
that holds no key (`MALFORMED`), a named file that is absent (`MISSING`), an
output path that is already taken (`EXTRA`), a value above a limit of section 3.7
(`LIMIT_EXCEEDED`), and a stated time that is not the form section 5 fixes
(`MALFORMED`). A producer with a private set of failure names would be a second
vocabulary for one format, and a caller who had to learn both would eventually
confuse them.

## 16. A second reading

`implementations/python/` is a verifier for this document written in Python by a
reader who did not read `verifier/**`. It shares no code and no crypto library
with the reference: the canonical JSON rules, the container walk, the field
rules, the chain and the Ed25519 arithmetic are its own, and its kit replay
refuses to call itself clean if it opens a file under `verifier/`.

It exists because agreement is the only evidence a format has. Two copies of one
implementation agree about everything, including their mistakes; two
implementations written apart agree only about the rules they both read, and
every place they disagree is a place where this document was not yet a
document — either because it was silent, or because it said something the code
did not do. Writing it found eight such places, and this document now says what
was decided in each: which check owns a field's *spelling* (§5, §7), that
`format` belongs to the check that runs before the fields (§5), that a leading
zero is a NON_INTEGER_NUMBER (§4.1), that `L0.PROVENANCE.NONEMPTY` counts
entries and not lines (§7), which of two copies of a duplicated name is read
(§3), the dependency graph and the reason a skip carries (§10.1), and the shape
of the JSON verdict (§12.1).

The kit is what both readings answer to. `vectors/expected.json` records the
answers, `vectors/run.js` replays them through the reference, and
`implementations/python` replays them through the port; 54 fixtures, the same
verdicts, the same reason codes, the same exit codes.

