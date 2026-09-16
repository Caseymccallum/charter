# The adversarial table

Written down before it was run. One row per way a `.charter` file can be made to
lie, with the verdict the specification says it must produce. Every row names a
fixture in `vectors/out/`, so the adversarial pass is part of the conformance
kit rather than a one-off.

- **Expected status** is a verdict from SPEC.md section 10: `VERIFIED`,
  `INCOMPLETE`, or `BROKEN`.
- **Expected reason** lists the checks that must not pass, as
  `CHECK_ID=REASON_CODE`, in registry order. `-` means no check may fail and no
  check may be unsupported.
- **Actual** and **Pass** are filled in from `test/adversarial.test.js`, which
  replays every row and refuses to agree with this file unless the verdict, the
  reason codes, and the number of checks that were never reached all match.
  Replay it with `node --test test/adversarial.test.js`.

A reason is a `FAIL` unless it is the reason of an `UNSUPPORTED` check: a thing
this verifier cannot perform is never a pass, and it is never a failure either.

## Structural — the container

| Case | Mutation | Expected status | Expected reason | Actual | Pass |
| --- | --- | --- | --- | --- | --- |
| truncated-last-byte | The last byte of a valid file is removed | BROKEN | L0.ZIP.READABLE=MALFORMED | L0.ZIP.READABLE=MALFORMED | pass |
| truncated-eocd | The last 8 bytes are removed, cutting the end record | BROKEN | L0.ZIP.READABLE=MALFORMED | L0.ZIP.READABLE=MALFORMED | pass |
| truncated-mid-header | The last 40 bytes are removed, cutting the central directory | BROKEN | L0.ZIP.READABLE=MALFORMED | L0.ZIP.READABLE=MALFORMED | pass |
| missing-manifest | `manifest.json` is absent; the other two entries are intact | BROKEN | L0.ZIP.ENTRY_SET=MISSING | L0.ZIP.ENTRY_SET=MISSING | pass |
| missing-content | `content.md` is absent; the other two entries are intact | BROKEN | L0.ZIP.ENTRY_SET=MISSING | L0.ZIP.ENTRY_SET=MISSING | pass |
| missing-entry | `provenance.jsonl` is absent (the Phase 1 case of the same name) | BROKEN | L0.ZIP.ENTRY_SET=MISSING | L0.ZIP.ENTRY_SET=MISSING | pass |
| extra-entry | A fourth entry, `notes.txt`, is present (the existing fourth-entry case) | BROKEN | L0.ZIP.ENTRY_SET=EXTRA | L0.ZIP.ENTRY_SET=EXTRA | pass |
| duplicate-entry | The fourth entry is named `content.md` again (the existing duplicate case) | BROKEN | L0.ZIP.ENTRY_SET=DUPLICATE | L0.ZIP.ENTRY_SET=DUPLICATE | pass |
| stored-declared-deflated | `content.md` is stored and declares method 8, so its bytes are not a deflate stream | BROKEN | L0.ZIP.ENTRY_DATA=DECODE_ERROR | L0.ZIP.ENTRY_DATA=DECODE_ERROR | pass |
| deflate-declared-stored | `content.md` is raw-deflated and declares method 0, so its bytes are the compressed stream | BROKEN | L0.ZIP.SIZES=MISMATCH, L0.ZIP.CRC32=MISMATCH, L0.CONTENT.UTF8=DECODE_ERROR, L0.CONTENT.HASH=MISMATCH | L0.ZIP.SIZES=MISMATCH, L0.ZIP.CRC32=MISMATCH, L0.CONTENT.UTF8=DECODE_ERROR, L0.CONTENT.HASH=MISMATCH | pass |
| manifest-too-large | `manifest.json` is 1 MiB + 1, above the declared ceiling for one JSON document | BROKEN | L0.MANIFEST.PARSE=LIMIT_EXCEEDED | L0.MANIFEST.PARSE=LIMIT_EXCEEDED | pass |

`truncated-last-byte`, `truncated-eocd` and `truncated-mid-header` are points in
a neighborhood, not the neighborhood itself: `test/adversarial.test.js` also
truncates a valid file at *every* offset in its last 512 bytes and requires that
no truncation is ever `VERIFIED`. A reader that accepts a prefix of a file has
agreed to judge incomplete bytes.


## Canonical — the bytes that were signed

| Case | Mutation | Expected status | Expected reason | Actual | Pass |
| --- | --- | --- | --- | --- | --- |
| noncanonical-manifest | The right value, signed correctly, with its keys in reverse order | BROKEN | L0.MANIFEST.CANONICAL=NON_CANONICAL | L0.MANIFEST.CANONICAL=NON_CANONICAL | pass |
| manifest-pretty-printed | The right value, signed correctly, indented by `JSON.stringify` | BROKEN | L0.MANIFEST.CANONICAL=NON_CANONICAL | L0.MANIFEST.CANONICAL=NON_CANONICAL | pass |
| manifest-spaced | The right value with one space between every pair of tokens | BROKEN | L0.MANIFEST.CANONICAL=NON_CANONICAL | L0.MANIFEST.CANONICAL=NON_CANONICAL | pass |
| manifest-no-trailing-newline | Canonical bytes with no LF after the value | BROKEN | L0.MANIFEST.CANONICAL=NON_CANONICAL | L0.MANIFEST.CANONICAL=NON_CANONICAL | pass |
| manifest-two-trailing-newlines | Canonical bytes followed by two LFs | BROKEN | L0.MANIFEST.CANONICAL=NON_CANONICAL | L0.MANIFEST.CANONICAL=NON_CANONICAL | pass |
| manifest-signature-over-pretty | Canonical manifest bytes; the signature covers the indented spelling | BROKEN | L1.MANIFEST.SIGNATURE=MISMATCH | L1.MANIFEST.SIGNATURE=MISMATCH | pass |
| manifest-signature-without-lf | Canonical manifest bytes; the signature covers them with no LF | BROKEN | L1.MANIFEST.SIGNATURE=MISMATCH | L1.MANIFEST.SIGNATURE=MISMATCH | pass |

The last two are the case SPEC.md section 4.1 exists for: a signature covers a
*byte sequence*, and a different serialization of the same value is a different
sequence. Both defects are invisible in the value and fatal to the claim.

## Content

| Case | Mutation | Expected status | Expected reason | Actual | Pass |
| --- | --- | --- | --- | --- | --- |
| content-tampered | The bytes of `content.md` change; digest, signature and chain untouched | BROKEN | L0.CONTENT.HASH=MISMATCH | L0.CONTENT.HASH=MISMATCH | pass |
| content-same-length-swapped | `content.md` is replaced by a different valid Markdown document of the same byte length | BROKEN | L0.CONTENT.HASH=MISMATCH | L0.CONTENT.HASH=MISMATCH | pass |
| content-hash-rewritten | The manifest's digest changes and the bytes do not | BROKEN | L0.CONTENT.HASH=MISMATCH, L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | L0.CONTENT.HASH=MISMATCH, L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | pass |
| content-and-manifest-changed | Content and manifest digest change together; the manifest signature is not recomputed | BROKEN | L1.MANIFEST.SIGNATURE=MISMATCH, L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | L1.MANIFEST.SIGNATURE=MISMATCH, L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | pass |
| empty-content | `content.md` is empty, and both the manifest and the log declare the digest of the empty string | VERIFIED | - | - | pass |

`empty-content` is a decision, not an oversight. The empty byte string is valid
UTF-8, carries no byte order mark, and has a SHA-256 like any other byte string,
and a format whose central claim is that the bytes of the file are the document
does not also get to require that the document say something. The rule for an
absent *history* is the opposite, and `empty-log` below is that case.

## Signature and key

| Case | Mutation | Expected status | Expected reason | Actual | Pass |
| --- | --- | --- | --- | --- | --- |
| bad-manifest-signature | One bit of the manifest signature is flipped (the Phase 1 case) | BROKEN | L1.MANIFEST.SIGNATURE=MISMATCH | L1.MANIFEST.SIGNATURE=MISMATCH | pass |
| manifest-signature-truncated | The manifest signature is one byte short: 63 bytes, not 64 | BROKEN | L1.MANIFEST.SIGNATURE=MALFORMED | L1.MANIFEST.SIGNATURE=MALFORMED | pass |
| manifest-signed-by-other-key | The manifest signature comes from a second key, and the manifest carries the first | BROKEN | L1.MANIFEST.SIGNATURE=MISMATCH | L1.MANIFEST.SIGNATURE=MISMATCH | pass |
| manifest-public-key-swapped | `public_key` is a second key's; `key_id` and every signature are the first key's | BROKEN | L1.MANIFEST.KEY_ID=MISMATCH, L1.MANIFEST.SIGNATURE=MISMATCH, L1.PROVENANCE.SIGNATURES=MISMATCH | L1.MANIFEST.KEY_ID=MISMATCH, L1.MANIFEST.SIGNATURE=MISMATCH, L1.PROVENANCE.SIGNATURES=MISMATCH | pass |
| key-id-not-derived | `key_id` is not the derivation of the `public_key` beside it | BROKEN | L1.MANIFEST.KEY_ID=MISMATCH, L1.PROVENANCE.FIRST_AUTHOR=MISMATCH, L1.PROVENANCE.KEYS=MISMATCH | L1.MANIFEST.KEY_ID=MISMATCH, L1.PROVENANCE.FIRST_AUTHOR=MISMATCH, L1.PROVENANCE.KEYS=MISMATCH | pass |
| foreign-key-entry | An entry names a key other than the one the artifact carries (the Phase 1 case) | BROKEN | L1.PROVENANCE.KEYS=MISMATCH | L1.PROVENANCE.KEYS=MISMATCH | pass |


## History — the chain

| Case | Mutation | Expected status | Expected reason | Actual | Pass |
| --- | --- | --- | --- | --- | --- |
| parent-hash-unknown | An entry's `parent` is a digest that appears nowhere in the file | BROKEN | L2.CHAIN.LINKS=MISMATCH | L2.CHAIN.LINKS=MISMATCH | pass |
| forked-log | A third entry declares the same parent as the second: two entries share one predecessor | BROKEN | L2.CHAIN.LINKS=MISMATCH | L2.CHAIN.LINKS=MISMATCH | pass |
| log-reordered | The two entries of a valid log are swapped, signatures untouched | BROKEN | L2.CHAIN.FIRST_PARENT_NULL=MISMATCH, L2.CHAIN.LINKS=MISMATCH, L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | L2.CHAIN.FIRST_PARENT_NULL=MISMATCH, L2.CHAIN.LINKS=MISMATCH, L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | pass |
| log-middle-entry-removed | A three-entry log loses its middle entry | BROKEN | L2.CHAIN.LINKS=MISMATCH | L2.CHAIN.LINKS=MISMATCH | pass |
| head-describes-other-content | The last entry's `content_sha256` is another revision's digest, correctly signed | BROKEN | L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | L2.CHAIN.HEAD_MATCHES_CONTENT=MISMATCH | pass |
| entry-with-earlier-timestamp | A third entry carries a valid signature and a timestamp *before* its parent's | VERIFIED | - | - | pass |
| history-rewritten | The key holder rewrites every entry and re-signs the whole log (the Phase 1 case) | VERIFIED | - | - | pass |
| empty-log | `provenance.jsonl` is present and empty (the Phase 1 case) | BROKEN | L0.PROVENANCE.NONEMPTY=MISSING | L0.PROVENANCE.NONEMPTY=MISSING | pass |

`parent-hash-unknown`, `forked-log`, `log-middle-entry-removed` and
`head-describes-other-content` each fail one check and nothing else, which is the
point: the chain is the only structure that notices them, and every signature in
each of those fixtures is still valid.

### The two rows that must stay `VERIFIED`

**`history-rewritten`.** Whoever holds the private key can replace every entry,
recompute every parent, and re-sign the whole log. Nothing in the file can
distinguish that from a document that was written that way, because it *is* a
document that was written that way. `VERIFIED` is the correct answer, and the
verdict must carry `KEY_HOLDER_CAN_REWRITE_HISTORY` in its limitations:
`test/adversarial.test.js` asserts the verdict, the exit code, and that the
caveat is printed.

**`entry-with-earlier-timestamp`.** No check compares two timestamps. An entry
whose `timestamp` precedes its parent's is signed, chained, and `VERIFIED`,
because the chain fixes *order of inclusion* and nothing in an artifact witnesses
*time*. SPEC.md section 11 says so, and this row is what says the spec means it.

**If you find yourself changing the verifier to catch either of these, you are
breaking the spec.** A verifier that admits what it cannot see is more
trustworthy than one that claims to see everything.

## Totals

Totals: 37 cases, 37 pass, 0 fail.
