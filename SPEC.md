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
at the first of the three. A name that appears twice is refused, and section 3.4
fixes which of the two copies the checks that follow read, so that two readers of
one file cannot disagree about the document.

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
central directory's name. An entry's name is a UTF-8 string, and one that is not
is `DECODE_ERROR`: the entry set is a claim about names, and a reader that cannot
read a name cannot say which entry it read. `L0.ZIP.READABLE` fails when any of
that does not hold, and no other check runs: there is no container to read.

Those clauses are settled in the order they are stated, and the order is part of
the rule rather than a description of one reader. The directory is walked to its
declared end first — every record present, inside the file, beginning with its
signature — and a record's name is compared with the local header it points at
only once that walk has finished. One byte removed from the middle of the
directory moves every later record while every number the file states about the
directory still says what it said; a reader that compared each name as it read
would report a name disagreement about a record whose *position* the file no
longer states, and would never say the plainer thing, which is that the directory
does not hold the records it declares. That plainer thing is `MALFORMED`'s, so it
is the shape of the whole directory that is established first, and a name read out
of a walk that did not finish is not a claim the file makes.

The reason a refusal carries says which of those did not hold, and the
distinction is not decoration — it is the difference between a file that lies
about its own shape and two places where the file contradicts itself:

- **`MALFORMED`** is for bytes that are not the shape the format requires: no end
  record at all, a record that does not begin with its signature, a name or a
  data run that ends past the file, an offset that names bytes no header starts
  at, or an end record whose counts disagree with each other.
- **`MISMATCH`** is for a value the file states twice and states differently: the
  name in a local header and the name in the central directory that points at it,
  or the two flag words. Both copies are well formed and one claim is false,
  which is a different sentence from "these bytes are not a header".
- **`UNSUPPORTED_VERSION` and `UNSUPPORTED_FEATURE`** are not failures. An end
  record that carries ZIP64's `0xFFFF` and `0xFFFFFFFF` markers, or that says the
  archive is one disk of a set, describes something this verifier does not
  implement rather than something that is wrong, and §3.2 says which of the two
  codes each carries. The artifact comes back `INCOMPLETE`, never `BROKEN`: an
  archive this reader will not guess at is unproven, not refuted.

Two things a reader might expect here are deliberately not here. The *size* the
end record declares for the directory is not compared against the records inside
it at this point — that the directory lies inside the file is legibility, and
whether it is the size its records use is §3.4's `L0.ZIP.LAYOUT`, which reports
`MISMATCH` for it. And a local header's name is compared with the record's, not
with the three names §3.4 requires: whether the *set* of names is the right set
is `L0.ZIP.ENTRY_SET`'s, and it is a check, not a refusal.

### 3.2 Feature level

No ZIP64, and one disk. The format says so in two places, and each is read by the
check that can.

- **The end record.** Its two entry counts, its directory size and its directory
  offset are the fields ZIP64 replaces with `0xFFFF` and `0xFFFFFFFF`, and the
  same record says which disk of a set this file is. An archive whose end record
  carries one of those markers, or that declares any disk but the first, does not
  describe a directory this reader can walk, so `L0.ZIP.READABLE` reports it:
  `UNSUPPORTED_VERSION` for a ZIP64 marker and `UNSUPPORTED_FEATURE` for a disk,
  with status `UNSUPPORTED` rather than `FAIL`, and no other check runs. §10.1 is
  why the gate is the check that reports it and not `L0.ZIP.VERSION`: the fact
  VERSION needs is the end record, and a record this reader will not interpret is
  a fact nobody established.
- **Each entry.** Every entry declares in both copies of its header the ZIP
  feature level it needs, and it is at most 20 (2.0). `L0.ZIP.VERSION` reports
  `UNSUPPORTED_VERSION` for a higher one, because a level above 2.0 names
  something this verifier does not implement — the same code, in the same voice,
  as an archive that announces ZIP64 in its end record. The copy this check reads
  is the central directory's, which is the copy §3.5 makes authoritative for a
  claim the file states twice; two copies that disagree are `L0.ZIP.METADATA`'s
  `MISMATCH`, and a reader that took the higher of the two would report a feature
  level the entry may not need — the local header's copy is not a second opinion,
  it is the same claim written down twice.

A bare `0xFFFFFFFF` in a size field is *not* ZIP64: the marker is the version
needed, or a ZIP64 extra field beside it. It is a number above a ceiling in §3.7,
so the check that would read those bytes reports `LIMIT_EXCEEDED` — and a size
larger than the bytes the file holds is not a ceiling at all but a legibility
failure, which the gate reports before anybody measures anything.

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

The flag word is the one value in the container whose two copies are not
`L0.ZIP.METADATA`'s to compare. A reader has to agree with itself about flags
before it can decode anything, so two flag words that differ are a refusal with
reason `MISMATCH` at `L0.ZIP.READABLE` (§3.1), and `L0.ZIP.FLAGS` is SKIP behind
it. What this check reads, when it runs, is a flag word the file states the same
way twice.

### 3.4 Layout

Every byte of the file is accounted for by a local header, an extra field, an
entry's data, the central directory, or the end record, in that order, with
nothing before the first header, nothing between entries, nothing between the
last entry and the central directory, nothing after the end record, and no
archive comment. `L0.ZIP.LAYOUT` fails with reason EXTRA when bytes appear
where the format does not put them.

The order that sentence fixes is the order of the *kinds* of thing, not the order
of the three entries. ZIP fixes no order for the records in the central
directory, a writer that sorts its records by name is writing a well-formed
archive, and neither the entries nor the directory record has to be listed in the
order the other appears in the file. What the rule states is a property of the
byte ranges, so it is the ranges that are walked, in file order — which is why
the same three entries, reordered in the body and in the directory, are still a
charter, and why a directory whose records are in another order than the body is
not a defect at all.

Two ways a range can be wrong, and they are two different sentences:

- **A gap**, where a range begins after the previous one ends, is bytes the
  format does not account for: `EXTRA`, with the count of the bytes in the gap.
- **An overlap**, where a range begins inside one already claimed — two records
  naming one local header, or a size that runs into the next entry — is two
  claims about the same bytes: `MISMATCH`. Nothing is missing from the file; two
  parts of it are describing the same bytes twice.

Three facts of the end record are read with the ranges rather than trusted: the
size it declares for the directory has to be the size its records use
(`MISMATCH` when it is not), the offset it declares has to be where the ranges
end, and its own position has to be where the directory ends (`EXTRA` when the
directory and the record are not adjacent, and when anything follows the record).
The size its records use is the sum of their extents — the 46 bytes of a record's
fixed part, its name, and the extra field and the comment it declares — so a
record whose declared extent reaches past the end of the file is a record this
check counted and a directory whose numbers do not add up. It is not the gate's
complaint: the gate reads *names*, and a name that ends past the file is bytes
nobody can read, while a record whose extra field or comment does is a number
that belongs here.
The offset is compared in both directions, and they are the two sentences above:
`EXTRA` when the ranges end *before* it, because the bytes between them and the
directory are bytes nothing accounts for, and `MISMATCH` when a range ends
*after* it, because there the last entry's data and the directory are two claims
about the same byte. A number nobody compares is a byte a forged file can change
for free, and the declared extent of the directory is one of them.

This is the rule that makes "the three entries" a claim about the file rather
than a claim about a lookup table. Without it, an archive can hold a second
copy of `content.md`, and two readers can disagree about which one is the
document.

The layout rule does not catch a name that appears twice. Two local headers
carrying one name, and the two entries' data, are accounted for in order like any
other bytes, so an archive with four entries and three names has nothing wrong
with its layout — which is why `L0.ZIP.ENTRY_SET` refuses the *set* and not the
layout. What the duplicate costs is a decision, because the checks that follow
need one of the two copies named for them, and this document fixes which one:
**the copy whose local header comes first in the file.** The artifact is broken
either way, and the bytes a verdict is about should be the bytes the file states
first rather than the bytes a directory happened to end on. A reader that took
the last copy would report the same duplicate as every other reader and could
still disagree with them about the document, its digest, and the entry the
chain's head describes, which is the disagreement this sentence removes.

### 3.5 Declared sizes and CRC-32

Every entry declares the uncompressed size and the CRC-32 of the bytes it
holds, and both are true of the bytes actually in the file. `L0.ZIP.SIZES` and
`L0.ZIP.CRC32` are the two checks that have to decompress in order to answer,
and they are also the two checks that catch a container whose headers have been
edited around untouched payload bytes.

Both of them read the copy of that claim in the central directory. The local
header's copy is §3.6's to compare — `L0.ZIP.METADATA` reports the two
disagreeing — and a check that measured both copies would report one edited
header twice and take the complaint away from the check whose requirement it
actually breaks.

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
| extra field | none: the field is zero bytes long, in the local header and in the directory record |
| record comment | none: zero bytes, in the directory record |

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

**The extra field and the comment are the two fields ZIP allots with no meaning
here**, and they are why this section fixes a field's *presence* as well as its
value. ZIP's extra field is where a writer puts a ZIP64 size, an extended
timestamp, a user id, a filesystem attribute — every one of the facts the table
above has just removed from the header, in a second spelling a forger can add
without touching a byte any check reads — and a directory record's comment is
free text. Nothing in charter/0.1 reads either one, so both are fixed at zero
bytes, and `L0.ZIP.METADATA` reports a header that declares one with reason
`EXTRA`: the word for a place the format gives no meaning to, which is the word
§3.3 gives a general purpose bit this format has no room for. It is not
`UNSUPPORTED`: an extra field needs nothing implemented, since a reader skips
the bytes its length declares and reads the entry, so calling it a feature this
verifier does not implement would be a claim about the reader rather than about
the file. It is not `MISMATCH` either: a mismatch is a value that is not the one
the format fixes, and there is no field here for a value to be in — a
charter/0.1 header is its fixed part, its name, and then the entry's data. What
ZIP's own tables say an extra field's identifier means is exactly what this
section does not read: a reader that honoured one would be applying the rules of
another format, and a reader that skipped it silently would be calling a file it
never looked at whole. Both copies are read, in both kinds of header, so two
copies that disagree about a length are this check's failure as well.

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
checked. The check that reports a ceiling is the one whose work it bounds, so
`L0.ZIP.READABLE` carries the whole file's, `L0.ZIP.ENTRY_DATA` an entry's, and
`L0.MANIFEST.PARSE` a document's.

One of these ceilings is also enforced *while* the work it bounds is done,
because a declared size is a claim and a compressed stream is not. An entry
whose bytes keep expanding past 64 MiB is stopped there and refused with
`LIMIT_EXCEEDED` — by `L0.ZIP.ENTRY_DATA`, the same check and the same code the
comparison above carries — however few bytes its header declares. A reader that
compares a declared size and then inflates without a bound has done the half of
this section that the file told it about; the stop is the half for the file that
declares eight bytes and expands past the ceiling anyway, and the two halves are
one ceiling.

A size that is larger than the bytes the file actually holds is not a ceiling and
is not measured here: the bytes it names are not in the file, which is §3.1's
question, and the gate answers it before any ceiling is compared. `LIMIT_EXCEEDED`
is the word for a size this verifier refuses to *work* on, not for a size the file
cannot honour.

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
   **Where a number ends is part of the rule, not a habit of a scanner.** A
   token that begins with `-` or with one of the ten ASCII digits is read as a
   number, and it runs to the first character that cannot occur in one; the
   characters that can are those ten digits, `-`, `+`, `.`, `e` and `E`. The
   token is then compared against the one spelling of an integer, and a token
   that is not that spelling carries NON_INTEGER_NUMBER whatever part of it is
   wrong: a fraction (`1.0`), an exponent (`1e0`), a minus with no digits or a
   second sign (`-`, `1-2`, `2026-01-01`), a leading zero (`01`, `007`), or a
   run of them (`1.2.3`). This is deliberately not JSON's grammar. JSON calls
   `01` and `2026-01-01` syntax errors, and this format calls both of them a
   number a reader would not have written, because in each case the bytes where
   a value belongs are a number spelled wrong rather than not a value at all —
   and a reader that answered MALFORMED here would be describing its own
   scanner's stopping point as a defect of the file. MALFORMED is for the
   character where a value is due that cannot begin a number at all —
   `{"a":+1}`, `{"a":@}`, `{"a":.5}` — and for a number-shaped token that is out
   of the 53-bit range, which is the one case where the spelling is right and
   the value is not: NUMBER_OUT_OF_RANGE.
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
and a signature written with `=` all pass it. An empty digest, an empty signature
and an empty public key pass it too — `""` is a string, and what is wrong with it
is a fact about the *value*, a digest of no characters or a signature of no
bytes, which is the reading check's sentence to write. "A non-empty string" in the
table is FIELDS' own requirement for the fields no other check reads (`title`,
`author.name`, `author.key_id`), and it is the whole of what FIELDS says about
them. The checks that *read* those values report what is wrong with the encoding,
and a field that is not there at all is reported as an absence rather than as a
spelling:

| Value | Check | Present, and not the one spelling of its value | Absent |
| --- | --- | --- | --- |
| `content.sha256` | `L0.CONTENT.HASH`, `L2.CHAIN.HEAD_MATCHES_CONTENT` | NON_CANONICAL_ENCODING: not 64 lowercase hex characters, for any reason | MISSING |
| `author.public_key` | `L1.MANIFEST.KEY_ID` | NON_CANONICAL_ENCODING when the string is not unpadded base64url; MALFORMED when it decodes to anything other than 32 bytes | MISSING |
| `signature` | `L1.MANIFEST.SIGNATURE` | NON_CANONICAL_ENCODING when the string is not unpadded base64url; MALFORMED when it decodes to anything other than 64 bytes | MISSING |

**A value's reason code is decided by what the string is, not by how much of it
is missing.** NON_CANONICAL_ENCODING means the string is not the one spelling
this format fixes for that value, whatever the reason it is not: `0097e5…` and
`0097E5…` are not two digests, they are one digest spelled two ways; a string of
63 hex characters is not the spelling of any digest; and a base64url string with
`=` padding, with a character outside the alphabet, with a length no byte string
is spelled with, or with trailing bits that are not zero is not the one spelling
of its bytes either. Every one of those
carries NON_CANONICAL_ENCODING, from the check that reads the value and from no
other. MALFORMED is for the cases where the string *is* an encoding and the value
is wrong in some other way — it is not a string, or not the JSON type the table
names (which is FIELDS' question), or it decodes to a byte string of the wrong
length for its algorithm, 31 bytes for a key and 63 for a signature. A value that
is not there at all is neither: it carries MISSING, because the vocabulary's word
for a required thing that is absent is MISSING, and a check that reported a
spelling problem for a field it never read would be describing a string it does
not have.

An absence is reported by every check that required the value, with that one
code. `L0.MANIFEST.FIELDS` requires the manifest's fields to be present,
`L0.PROVENANCE.FIELDS` requires an entry's seven, `L0.FORMAT.IDENTIFIER` requires
`format` (the paragraph below says why the field that is read before the fields
is the one that reports it), and `L0.PROVENANCE.CONTENT_HASH_FORMAT` requires each
entry's digest. So an entry with no `content_sha256` fails two checks, and both of
them say MISSING: the field is missing and the digest is missing, and it is one
fact about one absence rather than two readings of it. The checks that would have used
the absent value are SKIP instead, by the graph in section 10.1 — an absence is
not an answer.

`L0.MANIFEST.CANONICAL` compares the bytes on disk against the canonical bytes
for the object they parse to, followed by one LF. A file that parses and is not
canonical is refused; a file whose fields are well formed but unusual is not,
which is the whole difference between syntax and semantics in this format.

`format` is checked before anything else, and it is checked by
`L0.FORMAT.IDENTIFIER` rather than by `L0.MANIFEST.FIELDS`, because a check that
runs before the fields can be read is the check that has to report a field that
is not there: a `format` that is absent is MISSING, one that is not a string is
MALFORMED, and a value this verifier does not implement produces UNSUPPORTED and
stops the manifest checks. The empty string is in the third case and not the
second: it is a string, and it is not the identifier this verifier implements.
Stops means the checks after it are SKIP, with reason
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
for the signature. An empty one is that check's to report as well: `""` is a
string, so FIELDS passes it, and "a digest of no characters" is a sentence for the
check that reads the digest. `summary`, `author.name` and `author.key_id` are the
fields no other check reads, and there FIELDS owns the shape the table names: a
non-empty string. `action` is an enumeration, and a string this version does not
define in it is UNKNOWN_FIELD, as an algorithm this version does not define is in
the manifest; a value that is not a string at all is MALFORMED, because it does
not hold the JSON value the table names. The digest is the value whose codes
section 5 spells out, and
both of them are here as they are there: NON_CANONICAL_ENCODING when the string is
not 64 lowercase hex characters — whatever the reason, a length, a case, or a
character that is not a hex digit — and MISSING when there is no such field at
all. An absent digest is not a misspelling, and it is not a malformation:
`L0.PROVENANCE.CONTENT_HASH_FORMAT` reports MISSING, because the value it reads is
not there, and `L0.PROVENANCE.FIELDS` reports MISSING for the same absence,
because the seven fields it requires are not all present. Two checks, one code,
one fact, and neither of them is a sentence about a string nobody has.

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

Every way a string fails to be that one spelling — a character outside the
alphabet, a length no byte string is spelled with, `=` padding, trailing bits that
are not zero — carries NON_CANONICAL_ENCODING, from the check that reads the value.
A string that decodes, and decodes to a byte string of the wrong length for its
algorithm, carries MALFORMED instead: that is a fact about the value rather than
about its spelling. The empty string is the shortest case of it — `""` is the one
spelling of the empty byte string, so a signature field holding one has a
signature of 0 bytes where Ed25519 uses 64.

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

**A requirement has exactly one owner.** A check reports a defect only when the
requirement in its own row does not hold, and where two checks could measure the
same thing, the one that *reads* the value owns it. `L0.MANIFEST.FIELDS` and
`L0.PROVENANCE.FIELDS` answer whether a field is present and holds the JSON kind
§5 and §7 name for it, and the spelling of the string inside it belongs to the
check that uses the value: `L0.CONTENT.HASH` and
`L0.PROVENANCE.CONTENT_HASH_FORMAT` for a digest, `L1.MANIFEST.SIGNATURE` and
`L1.PROVENANCE.SIGNATURES` for a signature, `L1.MANIFEST.KEY_ID` for a public
key, `L2.CHAIN.LINKS` for a `parent`, and `L0.FORMAT.IDENTIFIER` for `format`. A
field no other check reads is FIELDS' whole requirement, and "a non-empty string"
is the whole of it there. §10.2 is that division, check by check. It is §10.1's
rule — one fact, one check that establishes it — applied to a value rather than
to a fact, and for the same reason: a defect reported twice is a defect two
implementations can disagree about.

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
conformance answers and may not be. The list is closed — a check may not report a
code that is not in it, and the vocabulary module `verifier/status.js` is the same
list, which `test/spec.test.js` holds: it fails the run when the codes this
section names and the codes that module declares stop being the same set.

What each code is for is fixed by the rule that produces it. Five of them are
shared by several checks, and they are the ones a reader is most likely to need:

| Code | What it means, and what produces it |
| --- | --- |
| `OK` | the requirement holds. It is the only code a `PASS` may carry |
| `MISSING` | a required thing is absent: a field that is not in the object, the log entry that is not in the log, the entry that is not in the archive. It is never a spelling problem and never a malformation, and a check that reads a value nobody wrote reports `MISSING` rather than inventing a string to complain about (§5, §7) |
| `NON_CANONICAL_ENCODING` | a field's string is not the one spelling this format fixes for its value. §5 states the rule and both codes it can produce; it is reported by the check that reads the value and by no other |
| `NON_CANONICAL` | the bytes are well-formed but are not the canonical form of the value they parse to — the same idea as `NON_CANONICAL_ENCODING` about a document's bytes rather than about a field's string. `L0.CONTENT.UTF8` also reports it for a byte order mark, because the bytes of the file are the content |
| `PREREQUISITE_FAILED` | a `SKIP`: the check was not reached because something it needed did not pass. The one code a skip may carry instead is `UNSUPPORTED_VERSION`, and section 10.1 says when |

The 30 checks, in the order they always appear in a verdict:

| Level | Check | Requirement |
| --- | --- | --- |
| L0 | `L0.ZIP.READABLE` | the artifact is a ZIP this verifier can walk |
| L0 | `L0.ZIP.VERSION` | no ZIP64, no multi-disk |
| L0 | `L0.ZIP.FLAGS` | no general purpose bit other than the three allowed |
| L0 | `L0.ZIP.LAYOUT` | every byte is accounted for, in order |
| L0 | `L0.ZIP.METADATA` | no host, disk, clock, attributes, extra field or comment; both copies of a claim agree |
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
| L0 | `L0.PROVENANCE.FIELDS` | the seven fields of every entry, present and correctly typed |
| L0 | `L0.PROVENANCE.EXTRA_FIELDS` | no field this version has no rule for |
| L0 | `L0.PROVENANCE.NONEMPTY` | at least one entry, counted as entries and not as lines |
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
the same in every implementation. That makes the dependency graph part of the
format, and the graph is a **rule rather than a table of counts**: every check
reads a fact, a fact has exactly one check that establishes it, and a check whose
fact was never established is SKIP. The rule is what an implementation follows;
the count an artifact records is what the rule says about the facts that artifact
did not establish, so no implementation carries the numbers.

Nothing here follows from the order of the registry. A check may need a fact
established by a check reported *before* it or *after* it: `L0.FORMAT.IDENTIFIER`
is reported before `L0.MANIFEST.PARSE` and cannot run until the manifest has been
read, and `L0.CONTENT.HASH` is reported before `L2.CHAIN.HEAD_MATCHES_CONTENT` and
needs the digest the manifest declares.

| The fact a check reads | The check that establishes it | The checks that cannot run without it |
| --- | --- | --- |
| the artifact is a ZIP that can be walked | `L0.ZIP.READABLE` | every other check — there is no container to read |
| the entry that is named is in the archive | `L0.ZIP.ENTRY_SET` | the checks that read that entry |
| the bytes of an entry decode | `L0.ZIP.ENTRY_DATA` | `L0.ZIP.SIZES`, `L0.ZIP.CRC32`, and the checks that read that entry |
| `manifest.json` is one JSON object | `L0.MANIFEST.PARSE` | `L0.FORMAT.IDENTIFIER`, the other three manifest checks, and every check that reads a manifest value |
| the format is the one this verifier implements | `L0.FORMAT.IDENTIFIER` | every check from `L0.MANIFEST.CANONICAL` onward, with reason UNSUPPORTED_VERSION |
| the manifest's fields are readable | `L0.MANIFEST.FIELDS` | `L0.CONTENT.HASH`, all of `L1.`, and `L2.CHAIN.HEAD_MATCHES_CONTENT` |
| `provenance.jsonl` is a list of objects | `L0.PROVENANCE.PARSE` | the other five log checks, all of `L1.PROVENANCE.`, and all of `L2.CHAIN.` |
| an entry's seven fields are readable | `L0.PROVENANCE.FIELDS` | all of `L1.PROVENANCE.` and all of `L2.CHAIN.` |
| the log holds at least one entry | `L0.PROVENANCE.NONEMPTY` | `L1.PROVENANCE.FIRST_AUTHOR`, `L2.CHAIN.FIRST_PARENT_NULL` and `L2.CHAIN.HEAD_MATCHES_CONTENT`: the three that name *the first* or *the last* entry |
| the manifest's public key is a key | `L1.MANIFEST.KEY_ID`, when it reports a key that does not decode or is the wrong length | `L1.PROVENANCE.FIRST_AUTHOR`, `L1.PROVENANCE.KEYS`, `L1.PROVENANCE.SIGNATURES` |

**The gate is the fact, not the status.** `L0.ZIP.ENTRY_SET` fails when a name
appears twice and when an entry should not be there, and in both of those cases
nothing is skipped: the fact the other checks need — that all three names are in
the archive — holds, and the verdict is broken for a reason no other check's
answer depends on. What gates is the entry being *absent*, which is the one way
that fact is not established.

The same rule one entry down: **a fact that names one entry gates that entry, not
the check that reads it.** `L0.ZIP.SIZES` and `L0.ZIP.CRC32` are asked of every
entry, so an entry whose bytes cannot be read leaves them with nothing to say
about *it* and everything to say about the rest — a declared size that is not the
size of the bytes is reported, because the check measured those bytes and that is
what it found. SKIP is for a check that has no answer at all, which here means
every answer it gave was "not measurable". A check that measured a defect and
reported an absence of evidence instead would be a verdict that reads worse than
the file, and the number of skips is part of the recorded answers precisely so
that this is not a matter of taste.

The facts are facts about named things, which is what makes the third row
answerable. The checks that read `manifest.json` are `L0.FORMAT.IDENTIFIER`, the
four `L0.MANIFEST.` checks, `L0.CONTENT.HASH`, all five `L1.` checks and
`L2.CHAIN.HEAD_MATCHES_CONTENT` — twelve of the 30. The checks that read
`content.md` are `L0.CONTENT.UTF8` and `L0.CONTENT.HASH`: two. The checks that
read `provenance.jsonl` are the six `L0.PROVENANCE.` checks, the three
`L1.PROVENANCE.` checks and the three `L2.CHAIN.` checks: twelve more. So an
archive with no `manifest.json` leaves twelve checks unrun, an archive with no
`content.md` leaves two, and a log whose entries cannot be read leaves six — and
each of those numbers is this paragraph applied to that file rather than a
constant a reader may carry.

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

### 10.2 One requirement, one owner

The paragraph at the head of this section is a rule about who answers. This is
that rule applied to all 30 checks: what each row requires, and the value the
check owns — the one no other check in a verdict reports. It is the same
registry, read against the question "if this goes wrong, which check says so?",
and it is here because that question has bitten: three times in this format's
history a check has measured a string that another check reads, and each time two
implementations that were both "right" disagreed about the answer. A row here
names one owner per value, so a defect reported twice is a defect a reader can
call a bug rather than a judgement.

| Check | The requirement its row states | The value it owns | Settled by |
| --- | --- | --- | --- |
| `L0.ZIP.READABLE` | the artifact is a ZIP this verifier can walk | whether there is an archive at all, and the end record's own version and disk facts: with neither, there is nothing else to read | `fixture` `not-a-zip`; `corpus` `central-offset-to-other-header`, `eocd-zip64-marker`, `eocd-multi-disk`, `entry-name-length-copies-differ`, `entry-byte-deleted-mid-directory`, `entry-name-not-utf8` |
| `L0.ZIP.VERSION` | no ZIP64 in what an entry needs | each entry's declared feature level, read from the directory's copy of its header | `corpus` `entry-version-needed-zip64`, `entry-version-needed-local-only` |
| `L0.ZIP.FLAGS` | no general purpose bit other than the three allowed | each entry's flag word, once the file has stated it the same way twice | `fixture` `encrypted-flag`; `corpus` `flag-word-above-the-format` |
| `L0.ZIP.LAYOUT` | every byte is accounted for, in file order | the byte ranges, and the three facts of the end record that describe them | `corpus` `local-extra-entry-uncounted` (a gap), `entry-central-record-twice` (an overlap), `eocd-cd-size-wrong`, `entry-extra-len-off-by-one` (a range past the directory), `central-extra-len-past-eof` |
| `L0.ZIP.METADATA` | no host, disk, clock, attributes, extra field or comment; both copies of every other claim agree | the container's metadata fields — the ones the format fixes at one value, and the two it fixes at none, plus every repeated claim but the flag word, which the gate refuses a disagreement about | `fixture` `stamped-by-a-clock`; `corpus` `local-compressed-size-off-by-one`, `local-crc-zeroed`, `entry-version-needed-local-only`, `local-extra-field-unread` |
| `L0.ZIP.ENTRY_SET` | exactly the three required entries | which names are in the archive | `fixture` `missing-entry`, `duplicate-entry`, `extra-entry` |
| `L0.ZIP.ENTRY_DATA` | stored or raw-deflated, and it decodes | each entry's method, the bytes it decodes to, and the entry's two ceilings | `fixture` `unsupported-method`, `stored-declared-deflated`, `entry-expands-past-ceiling`; `corpus` `entry-uncompressed-size-above-ceiling` |
| `L0.ZIP.SIZES` | the declared uncompressed size is the real one | the declared sizes, as the directory states them, for every entry that can be read | `fixture` `wrong-declared-size`; `corpus` `unsupported-method-beside-a-wrong-size` (the measurement a check keeps when another entry cannot be read) |
| `L0.ZIP.CRC32` | the declared CRC-32 is the real one | the declared checksums, as the directory states them | `fixture` `wrong-declared-crc` |
| `L0.FORMAT.IDENTIFIER` | `manifest.format` is exactly `"charter/0.1"` | `format`: absent is MISSING, not a string is MALFORMED, any other string — the empty one included — is a version this verifier does not implement | `fixture` `unsupported-format`; `probe` `manifest-format-missing`, `manifest-format-not-a-string`, `manifest-empty-format` |
| `L0.MANIFEST.PARSE` | one well-formed JSON object | the manifest's bytes as JSON | `fixture` `manifest-too-large`; `probe` `manifest-array`, `zero-lead`, `manifest-duplicate-key` |
| `L0.MANIFEST.CANONICAL` | the bytes are the canonical form plus one LF | the bytes as a spelling of the value they parse to | `fixture` `noncanonical-manifest`; `probe` `escape-solidus` |
| `L0.MANIFEST.FIELDS` | the required fields, present and correctly typed | presence and JSON kind; and, because no other check reads them, `title`, `author.name` and `author.key_id` as non-empty strings | `fixture` `manifest-field-unreadable`; `probe` `manifest-empty-key-id` |
| `L0.MANIFEST.EXTRA_FIELDS` | no field this version has no rule for | the manifest's field names, at any depth | `fixture` `manifest-extra-field`; `probe` `nested-unknown-author-field` |
| `L0.CONTENT.UTF8` | valid UTF-8, no byte order mark | the content's bytes as text | `fixture` `content-bom` |
| `L0.CONTENT.HASH` | the digest of the content matches the manifest | `content.sha256` as a digest: its spelling and, of course, its value | `fixture` `content-tampered`; `probe` `digest-uppercase` |
| `L0.PROVENANCE.PARSE` | one JSON object per LF-terminated line | the log's framing: its final byte, its lines, and each line as JSON | `fixture` `unterminated-log`; `probe` `log-is-not-an-object`, `log-is-a-bare-number` |
| `L0.PROVENANCE.CANONICAL` | each line is its canonical form plus one LF | each line's bytes as a spelling of the object it parses to | `probe` `log-line-with-crlf`, `log-line-not-canonical` |
| `L0.PROVENANCE.FIELDS` | the seven fields of every entry, present and correctly typed | presence and JSON kind; and, because no other check reads them, `summary`, `author.name` and `author.key_id` as non-empty strings, and `action` as a value this version defines | `probe` `log-line-not-canonical` (presence and kind), `manifest-empty-key-id` (the same reading, one document over) |
| `L0.PROVENANCE.EXTRA_FIELDS` | no field this version has no rule for | each entry's field names, at any depth | `fixture` `entry-extra-field`; `probe` `log-line-unknown-field` |
| `L0.PROVENANCE.NONEMPTY` | at least one entry, counted as entries and not as lines | whether the log holds an entry | `fixture` `empty-log` |
| `L0.PROVENANCE.CONTENT_HASH_FORMAT` | every `content_sha256` is a lowercase digest | `content_sha256` in every entry: its absence, its JSON kind, and its spelling | `probe` `log-line-empty-content-hash`, `log-line-not-canonical` |
| `L1.MANIFEST.KEY_ID` | the key id is the derivation of the public key | `author.public_key` as a key, and the comparison against `author.key_id` | `fixture` `key-id-not-derived`; `probe` `public-key-31-bytes`, `public-key-trailing-bits` |
| `L1.MANIFEST.SIGNATURE` | the manifest signature verifies | `signature` as a signature, over the bytes §4.1 names | `fixture` `bad-manifest-signature`; `probe` `signature-padded` |
| `L1.PROVENANCE.FIRST_AUTHOR` | the first entry names the manifest's key | the first entry's `author.key_id` as a claim about the key | `fixture` `key-id-not-derived` |
| `L1.PROVENANCE.KEYS` | every entry names the key the file carries | every other entry's `author.key_id` | `fixture` `foreign-key-entry` |
| `L1.PROVENANCE.SIGNATURES` | every entry signature verifies | every entry's `signature` | `fixture` `entry-edited`; `probe` `log-line-empty-signature` |
| `L2.CHAIN.FIRST_PARENT_NULL` | the first entry starts from nothing | the first entry's `parent`, whatever it holds: a chain that starts here may not name a predecessor | `probe` `log-first-parent-nonnull`; `fixture` `log-reordered` |
| `L2.CHAIN.LINKS` | every `parent` is the digest of the line before it | every later entry's `parent`: its spelling, its presence, and the line it hashes | `fixture` `parent-hash-unknown`; `probe` `log-line-bad-parent` |
| `L2.CHAIN.HEAD_MATCHES_CONTENT` | the head describes the content the manifest describes | the last entry's `content_sha256` against the digest the manifest declares | `fixture` `content-hash-rewritten` |

Four readings were ambiguous enough that two implementations read them
differently and no fixture asked about them, and this pass settled each by asking
which check the row gives the value to:

- **An empty string in a field another check reads.** `""` is a string, so FIELDS
  passes it; the length and spelling rules are the reading check's. An empty digest
  is `NON_CANONICAL_ENCODING` (not 64 lowercase hex characters), an empty signature
  and an empty public key are `MALFORMED` (0 bytes where the algorithm uses 64 and
  32), and an empty key id or title is `MALFORMED` from FIELDS, because no other
  check reads it.
- **A `parent` that is not a digest.** FIELDS passes anything that is a string or
  null; `L2.CHAIN.LINKS` reports `NON_CANONICAL_ENCODING` for a spelling that is
  not 64 lowercase hex characters, `MISMATCH` for a digest of the wrong line, and
  `MISMATCH` for `null` on an entry that is not the first. The first entry's parent
  is not LINKS' at all: any non-null value there is
  `L2.CHAIN.FIRST_PARENT_NULL`'s `MISMATCH`, because the requirement is that the
  chain start from nothing.
- **A value no enumeration defines.** `"rsa"` for `author.algorithm` and
  `"delete"` for an entry's `action` are `UNKNOWN_FIELD`, which is the
  vocabulary's word for a thing this verifier has no rule for, and §5 already said
  so for the algorithm: "reported as a field value it does not define, not skipped
  over". A value that is not a string at all is `MALFORMED`.
- **A `format` that is a string and not the identifier.** `UNSUPPORTED_VERSION`,
  the empty string included, because §5's three cases are "absent", "not a string"
  and "a value this verifier does not implement", and `""` is the third.

A reader can hold the table to that: in any verdict, a `FAIL`'s `detail` is a
sentence about the value in the third column, and no two checks report one
artifact's defect in the same value — the second check is SKIP, because the fact
it needed was never established (§10.1).

### 10.3 The audit's audit

The fourth column above says where each row's answer can be checked, and it is
the one column in this document whose values are names of files. Three kinds of
case appear in it, and each of them is committed, replayable, and recorded with
the answer the reference gives:

- **`fixture`** — a case in the conformance kit (`vectors/out/`,
  `vectors/expected.json`), which every implementation has to reproduce or fail
  the kit.
- **`probe`** — a case in the differential probe (`vectors/probe/`), which
  records both implementations' answers for questions the kit does not ask.
- **`corpus`** — a case in the container corpus (`vectors/container/`), which
  mutates one byte-level structure at a time and records what both
  implementations said about it.

The totals are **25 rows settled by a kit fixture, 16 by a probe case, 7 by a
corpus case, and none by prose alone**. Those numbers are larger than 30 because
several rows have more than one face: `L0.ZIP.READABLE` has a file that is not a
container at all and a container that is one disk of a set, `L0.ZIP.ENTRY_DATA`
has a method nobody implements, a size above a ceiling, and a stream that expands
past one, and each of those rows names a case for each face it has.

No row is `prose`, and the reason is the rule this column is made of: a
requirement that no single input can demonstrate is not a requirement about a
file. There is exactly one rule of that shape in this document, and it is the
paragraph at the head of §10 rather than a row — **a requirement has exactly one
owner**, which is a property of the table and is demonstrated by the table
itself: every row names one value, and no two rows name the same one. The two
`FIELDS` rows come closest to it, because their requirements carry the clause
"because no other check reads them". That clause is a property of the table as
well, and the cases cited for those rows are its observable form: a verdict in
which FIELDS fails and every check that would read the value is SKIP is what "no
other check reads it" looks like from outside a table.

The corpus is the newest of the three and the one whose first run changed the
most: 11 of its first 26 cases came back with two different answers, and one of
the two was wrong in every one of them. §3 now states the readings that settled
them — §3.1 the reason a refusal carries (a file that lies about its own shape is
`MALFORMED`, and two claims about one fact are `MISMATCH`), §3.2 which check
reports a ZIP64 marker or a second disk (`L0.ZIP.READABLE`, as an unsupported
archive rather than a broken one), §3.3 that two flag words are a refusal rather
than `L0.ZIP.METADATA`'s comparison, §3.4 that the layout rule is about byte
ranges walked in file order, with a gap and an overlap carrying different reasons,
§3.5 that the size and CRC-32 checks read the directory's copy of the claim, and
§3.7 which check carries a ceiling.

The corpus has grown eight cases since, built by hand from the three shapes a
fuzzer recommendation named and the sweep that decided against building one, and
each of them reached a sentence the first 26 had not. §3.1 now says the shape of
the directory is established before any record's name is compared, because one
byte removed from the middle of the directory reads as a *name* disagreement to a
reader that compares names as it walks, and it says that a name is a UTF-8 string
— `DECODE_ERROR` when it is not, since a reader that cannot read a name cannot say
which entry it read. §3.2 says which copy of an entry's feature level the check
reads: the directory's, which is §3.5's rule for every claim the file states
twice. §3.4 states the direction of the directory-offset comparison — `EXTRA` for
a gap before the directory and `MISMATCH` for a range that runs past it — and what
"the size its records use" is, so that a record whose declared extent reaches past
the file is a number the layout check reads rather than a refusal at the gate.
§10.1 gained the rule one entry down from its own **the gate is the fact, not the
status**: a fact that names one entry gates that entry and not the check that
reads it, so a check that measured a defect reports it instead of hiding it behind
an entry it could not read. That case is the one whose `spec` is null rather than
a section of 3, because its answer is §10.1's.

Five of the eight moved the port, one moved both implementations (`entry-extra-len-off-by-one`:
§3.4 had no direction to be wrong about, so both readers answered `EXTRA` where
the rule requires `MISMATCH`), and two moved nobody — one enforced a rule §3.1
already stated, and one recorded something no implementation could be wrong
about: `local-extra-field-unread` was a charter carrying a four-byte extra field,
and it verified in both, because §3.4 accounted for the bytes and no check read
them. That case was the one family the pass left open — settling it changes the
set of files that verify, which §14 makes a decision about the format rather than
a patch — and the decision has since been made where the case said it would be:
§3.6 now fixes the extra field and the record comment at zero bytes and gives
them to `L0.ZIP.METADATA` with reason `EXTRA`, §14 says which voice answers an
artifact that holds a shape charter/0.1 gives no rule to, and the case's answer
is a defect rather than a pass. Both implementations moved on it, and this time
neither was wrong before: the rule was the thing that was missing.
`implementations/python/README.md` records which implementation moved, case by
case, with `vectors/container/README.md` beside it.

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

What kind of contract this is, is worth saying plainly, because it is not the same
kind as section 3 or section 9. Sections 2 to 9 describe a file: nothing there
needs a command line, a reader that never prints anything is a conforming reader,
and no artifact becomes invalid because a program formats its answers differently.
This section constrains *programs* — it is the part of the interface a
specification has to fix if two implementations are to be compared at all. What
makes it binding is the record: the conformance kit compares two implementations
by comparing the verdict, the exit code, the failing checks with their reason
codes, the unsupported checks with theirs, and the number of checks that were
never reached, and every one of those five is a value in the object above. So an
implementation that offers `verify --json` prints this shape, and an
implementation that has no command line at all is not failing a requirement of
the format: what it omits is a program, not a claim about a document. The keys
that carry the format are the verdict, the exit code, the `summary` counts, each
check's `id`, `status` and `reason_code`, and each limitation's `id`; `file` and
`bytes` describe the invocation, and the prose fields are prose.

The commands that read out, write and describe files are the producer's:

```
node cli/charter.js keygen -o key.pem                  # an Ed25519 key, PKCS#8 PEM
node cli/charter.js seal <content.md> --key <key.pem> -o <out.charter>
node cli/charter.js edit <file.charter> <content.md> --key <key.pem> -o <out.charter>
node cli/charter.js inspect <file.charter>             # what a file claims
node cli/charter.js open <file.charter>                # the document it carries
node cli/charter.js cite <file.charter>                # one CSL-JSON item
```

`open` writes out the bytes of `content.md`, so a reader does not have to unzip the
container to get at the document inside it. It writes to standard output unless `-o`
names a file, it refuses to overwrite a file that already exists unless `--force` is
passed, and it prints the verdict beside the document rather than inside it: the
document goes to standard output and the verdict to standard error, so that a pipe
carries bytes and nothing else. The bytes it writes are the content entry this
format's reader read, not a second expansion of the container by another program.

It refuses what it cannot justify calling *the document*: a file whose manifest
cannot be read, one that declares a format this build does not implement, and one
that holds no content entry. In each of those the entry names have no fixed meaning,
so calling one of them the document would be a guess rather than a reading. It does
not refuse a file that fails to verify: a tampered document still comes out, with
the verdict printed beside it, because recovering a document from a damaged
container is a real thing to need and a document that fails is still a document.

Exit codes are five for `verify`, and they are the codes of a verdict: `0`
VERIFIED, `1` INCOMPLETE, `2` BROKEN, `64` the command line was not understood,
`66` the named file could not be read. The producer adds two, and neither is a
verdict: `65` the input was refused and the refusal has a reason code from the
vocabulary in `verifier/status.js`, and `73` the output file could not be
created. `64` is any verb's, and `65` is the producer's refusal, which every
verb can reach. The other two follow the invocation rather than the verb: `66`
belongs to the five that read a file named on the command line — `seal`, `edit`,
`inspect`, `cite` and `open` — and `73` to the four that create one: `seal`, `edit`,
`open` and `keygen`. `inspect`, `cite` and `open` exit `65` when a file holds nothing
they can read.
Section 14 changes a version when a *verdict* changes; these two codes belong to
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

The tests are written against this document, not against the implementation.
`test/spec.test.js` reads it: it fails the run when the reason codes section 10
names and the codes `verifier/status.js` declares stop being the same set, and
when the check ids this document names and the ids in that module's registry stop
being the same list — a check id in the spec that no implementation has, or a
check in the registry that the spec never names, is a drift in the one part of
this document that is also code. `test/purity.test.js` enforces the architectural
rule that makes any of this worth trusting: nothing under `verifier/**` may
import `node:`, read a file, touch the network, or consult a clock. The verifier
is a function from bytes to a verdict. `cli/charter.js` is the only file in the
project that reads a file, and `vectors/` and `test/` are the only other places
allowed to look at the world outside a byte array.

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
node vectors/run.js            # replay the kit: 56 artifacts, 56 recorded answers
node vectors/build.js          # rebuild the artifacts (the author's program)
node vectors/build.js --check  # rebuild in memory, and refuse if the record is stale
```

The 27 Phase 1 cases are the ways an artifact can be wrong. `valid` is the
artifact all of them are variations on, and `valid-deflate` is the same document
with deflated entries: they verify identically, because the compression method is
not part of what the document is. The container cases are `not-a-zip`,
`missing-entry`, `unreadable-manifest`, `extra-entry`, `duplicate-entry`,
`encrypted-flag`, `unsupported-method`, `wrong-declared-size`,
`wrong-declared-crc`, `entry-expands-past-ceiling` (an entry whose bytes expand
past the ceiling section 3.7 sets) and `stamped-by-a-clock` (a DOS stamp left in
by a writer that behaved like a file system). The document cases are
`noncanonical-manifest`, `manifest-extra-field`, `manifest-field-unreadable`,
`unsupported-format`, `content-bom` and `content-tampered`. The log cases are
`unterminated-log`, `truncated-log`, `empty-log`, `entry-extra-field` and
`entry-edited`. The signed-claim cases are `bad-manifest-signature`,
`foreign-key-entry` and `history-rewritten`.

The 28 that follow are the **adversarial pass**, and its enumeration is written
down in `test/adversarial.md` before it is run: one row per mutation, with the
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

One artifact is neither. **`produced-two-entries`** is `charter seal` followed by
`charter edit`: the only bytes in the kit that `vectors/build.js` does not write.
It is here because the question the rest of the kit asks — does a second writer
agree with the reader — cannot be asked of one implementation's own output, and the
question a producer has to answer is whether a history *it* wrote is readable by
readers that did not write it. **The 27 + 28 + 1 above are the 56 artifacts
`vectors/expected.json` records**: every case in exactly one group, and none left
over.

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

**The promise has a second half, and it is about the artifact rather than about
the declaration.** An artifact that declares charter/0.1 and holds something
charter/0.1's own sections give no rule for is not a charter/0.1 artifact,
whatever its `manifest.format` says, and a reader must not interpret the shape
by the rules of whichever other format uses it: a ZIP reader that honoured an
extra field's identifier, or a JSON reader that rounded a float, would be
applying rules this identifier does not promise, and two strangers running
different software would then disagree about the verdict while agreeing about the
identifier — which is the disagreement the paragraph above exists to prevent.

There is no version to report for such an artifact, and that is the rule.
UNSUPPORTED_VERSION names the artifact that *declares* an identifier this
verifier does not implement, and UNSUPPORTED_FEATURE names a feature the
*reader* does not implement; neither is a claim about the format, and a reader
that reached for one of them here would be reporting its own vocabulary instead
of the file. What such an artifact gets is a failure from the check whose own
requirement its shape breaks, with the reason code for a place the format gives
no rule to — `EXTRA` for a byte or a field where the format puts nothing (§3.3's
general purpose bit, §3.6's extra field), `UNKNOWN_FIELD` for a named field no
section defines (§5, §7), `MALFORMED` for bytes that are not the shape any
section names. The check and the code are the answer precisely because they say
*where* in the format the artifact stopped being one; a version identifier would
say only that the reader had run out of ideas.

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
file that was never edited. Writing the entries after it belongs to section 15.6
rather than here: `seal` writes the first line of a history, and `edit` is the
verb that adds a line to a history that exists. A reader is not affected by which
of them wrote a file: the format accepts any log section 9 accepts.

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
(`MALFORMED`). `edit` refuses all of those that apply to what it writes, and the
artifact it was handed as well: one it cannot read, with the reason code the
reader gave for that file rather than a name invented here; one whose log holds no
line to commit to (`MISSING`); one that declares a format this build does not
implement (`UNSUPPORTED_FEATURE`); one whose manifest holds a field charter/0.1
gives no rule to (`UNKNOWN_FIELD`); and one whose key is not the key named on the
command line (`MISMATCH`). `open` refuses what it cannot justify calling the
document: one it cannot read, with the reason code the reader gave for that file;
one that declares a format this build does not implement (`UNSUPPORTED_FEATURE`);
one that holds no content entry (`MISSING`); and an output path that is already
taken (`EXTRA`). Every one of those is a reason a reader would give
about the same file, which is the point: a caller branches on one vocabulary and
not two. A producer with a private set of failure names would be a second
vocabulary for one format, and a caller who had to learn both would eventually
confuse them.

### 15.6 A later entry

`seal` begins a history and `edit` writes the next entry in one. The entry it
writes is the `edit` action section 7 defines, and section 9 fixes all of it
except the parts below — which are producer rules precisely because nothing in an
artifact can check them:

- **`parent` is the digest of the line before it as that line stands in the
  file** — the canonical JSON of that entry plus the one LF that closes it —
  which is the same value the link check recomputes. Every earlier line of the
  log is copied into the new file byte for byte: an edit appends a line and does
  not reflow, reorder, or re-sign one, so a line written by something else is
  still that thing's bytes.
- **`content_sha256` is the new document's digest**, and the manifest's
  `content.sha256` moves with it. What the file carries afterwards is the new
  revision of `content.md`; the bytes of every earlier revision are gone, which
  section 11 states as a limitation and this subsection is where a writer is told
  not to pretend otherwise.
- **The manifest's other fields are the ones the artifact already carries.** An
  edit does not re-declare the author name, the creation time, the title, or the
  key unless the person editing states them: a stated title replaces the title,
  and nothing else does.
- **The key that signs is the key the artifact carries.** Section 8 says every
  entry names that one key, so an edit signed by any other key would be an entry
  a reader can only reject. The producer refuses it (`MISMATCH`) rather than
  writing it, because it knows the name of the key it holds.
- **A stated time is used, and with none stated the entry carries the no-time
  instant**: `1980-01-01T00:00:00Z`, the value `seal` writes when it is given no
  time. That instant can precede the entry before it, and that is not a
  contradiction to be repaired — section 11 says nothing in an artifact witnesses
  time, and `entry-with-earlier-timestamp` is a case the kit requires to come
  back `VERIFIED`. **A producer must not refuse an edit for stating an earlier
  time than its parent's**, because that is a rule the reader does not have, and a
  writer holding a rule the reader lacks would refuse what the format accepts.
- **A summary nobody stated is a summary that says so.** A seal's default
  describes what a seal is — "Initial draft." — because that is the fact. An edit
  records the absence, because a sentence this producer invented would be a
  sentence in a signed record that no signer wrote.
- **The name a later entry carries is the name stated for it**, and with none
  stated the name the artifact already carries. Only the first entry is held to
  the manifest's name, so a later entry may name someone else; what it may not do
  is name a key the file does not carry.

An edit requires an artifact it can **read**, not one it can *believe*: a
container it can walk, a manifest whose field shape it can read, a log with at
least one line and its final LF, and a document entry. It does not require the
file to verify, and it runs no verdict. The line it writes commits to the bytes
that are there, so an honest account of a file somebody else wrote does not become
dishonest because that file was already broken; `verify` is the command that
answers whether the file was true, and a producer that answered it too would be a
second verifier.

**The entries are copied and the container is written again.** An edit carries
forward the log and the document it was handed, and the manifest's values; the
container around them is this producer's, in the shape section 3 fixes, because
those fields are values the format fixes rather than claims a signer made. So a
file whose container a reader refuses — a feature level its two copies disagree
about, a metadata field that is not the value the table names — can still be read
for its entries, and what an edit writes around them has the container a
conforming writer writes. Nothing is laundered by that: the entries, their
signatures, and the links between them are the bytes the file already held, and a
producer does not repair a *claim*. A history with a stale signature stays a
history with a stale signature, which is the half of this rule that matters.

Three shapes it refuses rather than quietly repair:

- **a manifest field charter/0.1 gives no rule to** (`UNKNOWN_FIELD`). Writing the
  file back would drop a field it carried, and dropping a claim is not the same
  deed as never having made it.
- **an entry the format has no room for, or one name carried twice** (`EXTRA`,
  `DUPLICATE` — the codes the check that owns the entry set reports for the same
  two shapes). An edit copies the entries it read, so a fourth entry would have to
  be dropped and a repeated name chosen between; neither is a decision a writer
  may make silently.
- **a `format` this build does not implement** (`UNSUPPORTED_FEATURE`). Section 14
  says a verifier refuses what it does not implement, and a producer that extended
  such a file would be writing one it cannot check.

None of this changes a version. Section 14's list is about the artifact, the
verdict, and the limits; a verb for an action section 7 already defines adds
nothing to any of them, and a chain of many entries is what sections 5 through 9
always described. The module is `producer/edit.js`, and like `seal` it writes
through the reader's own serializer and the reader's own container writer.

An edit is deterministic in the same way a seal is (section 15.2): the same
artifact, document, key, and stated arguments produce the same bytes, on every run
and on every machine, because nothing here reads a clock, a file, or a random
source — and a later entry's `parent` is a function of the artifact it was given
rather than of when it was run.


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
`implementations/python` replays them through the port; 56 fixtures, the same
verdicts, the same reason codes, the same exit codes.

