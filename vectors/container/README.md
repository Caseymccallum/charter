# The container corpus

Thirty-four artifacts, each one a single hand-written mutation of
`vectors/out/valid.charter`, and the answers two implementations give for them.

```
node vectors/container/run.js            # ask both implementations, compare with the record
python implementations/python/tools/corpus.py --check   # fixtures against mutations
```

```
vectors/container/expected.json    the artifacts' answers, recorded from both implementations
vectors/container/out/*.charter    the 34 artifacts
vectors/container/run.js           the replay: reference, Python, and the record
```

`implementations/python/tools/corpus.py` builds these — `--build` writes the
artifacts and the record, `--check` rebuilds every artifact in memory and refuses
if the one on disk is not the one the mutation makes. It is the author's program;
the replay above is the reader's.

## Why a corpus, and not a field

The conformance kit holds 54 artifacts and the differential probe holds 27 more,
and between them they ask about every *field* a document has. Neither can reach
the container's byte arithmetic. A field-level case can say "this digest is
uppercase"; it cannot say "this entry's declared compressed size is one byte more
than the bytes that follow it", because that is not a field of a document but an
offset in a file. Two ZIP walkers that agree on 54 fixtures and 212 field-level
cases can still disagree about it — and, on the first run of this corpus, they
did.

Each case here changes one thing and leaves everything else alone:

| Where | The mutations |
| --- | --- |
| the entry table | an entry renamed `MANIFEST.JSON`; the three entries written in another order; the directory's records written in another order than the body; a fourth entry added; one local header named by two records |
| a local header | the compressed size off by one; the uncompressed size off by one; method 8 declared over stored bytes; the CRC-32 zeroed; bit 0x0002 set in one header only; bit 0x0001 set in one header only; bit 0x0010 set in both; a feature level above 2.0 in one copy only; an extra field carried with its declared length one byte too large; an extra field carried and declared honestly; a declared name length one byte larger than the name; a name byte in both copies that cannot stand alone in UTF-8 |
| the central directory | a record pointed at another entry's header; at the middle of another entry's data; past the end of the file; a size larger than the bytes remaining; a size above the ceiling; a record whose declared extra field reaches past the end of the file |
| the end record | a count off by one; the directory offset wrong; the directory size wrong; sixteen bytes appended after it; the ZIP64 markers; disk 1 of a set |
| what an entry asks for | a feature level of 4.5, in both copies |
| a byte removed | one byte out of the middle of the directory — the first byte of the middle record's name |
| two things at once | one entry's declared size wrong and another entry's method one this verifier does not implement |

## The first run found eleven disagreements

That is what the corpus is for, and every one of them was settled the way it had
to be: read the ZIP specification, read SPEC.md section 3, and if section 3 was
silent, amend section 3 **and then** fix whichever implementation was wrong. Ten
of the eleven were settled against the port and one against the reference:

- **The reference was wrong once.** It walked the entry ranges in the order the
  central directory lists them, so a directory whose records are sorted — which
  is what a writer that sorts does — read as a gap (`entry-central-order-swapped`
  came back BROKEN where the port said VERIFIED). ZIP fixes no order for the
  directory, section 3.4 now says the layout rule is about byte ranges, and
  `verifier/zip.js` walks them in file order.
- **The port was wrong ten times**, in three families: it never compared the two
  flag words (two cases, one of which it called VERIFIED); it used MALFORMED
  where the file states two claims differently, and EXTRA where two ranges claim
  the same bytes; and it read three numbers the format fixes and never compared
  — the directory's declared size, which a forged file could change for free, and
  the end record's ZIP64 and disk facts, which it turned into a failure instead
  of an unproven archive. It also measured the local copy of a size and a CRC-32
  in the checks that own the *value*, which reported one edited header twice.

Every case carries its question, the section of SPEC.md that answers it, and a
`note` that says which implementation moved for it — the record is the report.
`implementations/python/README.md` has the same findings in the port's own words,
and SPEC.md §10.3 is the count of what the corpus settled.

## The eight cases after them

Eight more artifacts were built by hand after that pass, from the shapes a
fuzzer recommendation named and from the sweep that decided against building one.
Five moved the port, one moved both implementations, and two moved nobody. Every
one of them reached a sentence of SPEC.md the first 26 had not.

| Case | What it asks | What it moved |
| --- | --- | --- |
| `entry-extra-len-off-by-one` | a local header declares five bytes of extra field and carries four, so the entry's declared end lands one byte inside the directory | **both implementations**: each answered `EXTRA`, the code §3.4 gives a *gap*, and §3.4 did not say which of its two sentences this is. It does now, and both readers report the direction they are in |
| `entry-name-length-copies-differ` | a local header declares the name eleven bytes long where the name is ten and the directory says ten | **nobody**: both refuse at the gate with `MISMATCH`, and the size comparison the lie would have moved is never reached, which is the order §3.1 now states |
| `entry-byte-deleted-mid-directory` | one byte removed from the middle of the directory, so every later record is one byte early and every number still agrees | **the port**: the reference read the whole directory and reported `MALFORMED`; the port compared each name as it walked and reported `MISMATCH` for a record whose position its own walk had broken. §3.1 fixes the order |
| `entry-name-not-utf8` | one byte of a name, in both copies, that cannot stand alone in UTF-8 | **the port**: the reference refused at the gate with `DECODE_ERROR` and 29 checks never run; the port decoded with replacement characters and reported a missing entry with 2 skips. §3.1 now says a name is a UTF-8 string |
| `entry-version-needed-local-only` | one entry's *local* header declares feature level 0xFFFF while its directory record says 2.0 | **the port**: it read both copies and reported `UNSUPPORTED_VERSION`; §3.2 now says the check reads the directory's copy, which is §3.5's rule for every claim the file states twice |
| `central-extra-len-past-eof` | a directory record declares 0xFFFF bytes of extra field, so its extent reaches past the file | **the port**: it refused at the gate with `MALFORMED` where the reference reported `LAYOUT`=`MISMATCH`; §3.4 now says what "the size its records use" is, and the gate reads names |
| `unsupported-method-beside-a-wrong-size` | two defects at once: one entry's bytes cannot be read and another entry's declared size is wrong | **the port**: it reported `SKIP` for the size check and hid the defect it had measured. §10.1 gains the rule one entry down from "the gate is the fact, not the status" |
| `local-extra-field-unread` | an extra field carried and declared honestly | **both implementations**, when the hole it recorded was settled: the file used to verify in both, and it is a defect now — see below |

The last of the eight is the one to read twice. §3.4 puts an extra field in the
list of things every byte of the file is accounted for by, nothing reads what is
inside it, and both implementations accepted it, so a four-byte region of a
charter/0.1 artifact could be filled with anything without a verdict changing.
§3.6's last paragraph — *a byte the reader never looks at is a byte a forged file
can change for free* — is the sentence that argued with that, and it won: the case
was left settled-once-the-format-decides, and the format has decided. §3.6's table
now fixes a header's extra field and a directory record's comment at zero bytes and
gives them to `L0.ZIP.METADATA` with reason `EXTRA` — the word the spec already
uses for a general purpose bit charter/0.1 has no room for, and not `MISMATCH`
(which is a value that is not the one a field the format *has* should hold) or
`UNSUPPORTED` (which is a claim about the reader, and an extra field needs nothing
implemented). §14 is the other half of the settlement, and it is the part that
applies to artifacts this corpus has not generated: an artifact that declares
charter/0.1 and holds a shape charter/0.1 gives no rule to has no version to
report, so the answer is the check that owns the shape and the code for a place the
format puts nothing. Both implementations moved on this case, and it is the only
case here where neither was wrong before the rule existed. The field's identifier
in this artifact is the extended-timestamp one, which is the shape of the hole: the
fact §3.6 removes from the header is the fact that field carries.

Two of the eight are not one mutation of one field, and the record says so rather
than hiding it: `entry-byte-deleted-mid-directory` removes a byte, and
`unsupported-method-beside-a-wrong-size` changes two entries, because its question
is about a file wrong in two places at once. It is also the only case here whose
`spec` is `null` rather than a section of 3 — its answer is §10.1's, and the
column exists to say where an answer lives.



Nothing here is a conformance kit. The kit is `vectors/out/` and it enforces:
an implementation that does not reproduce its 54 answers fails. This corpus
records what each implementation said, case by case, and the replay fails when an
implementation has *moved* rather than when the two disagree. A case whose record
says they disagree is reported as a finding, both answers side by side, and the
`note` says which one the format requires — that is the shape a future
disagreement arrives in. It is the same discipline the probe follows, one level
down: the probe asks about the fields of a document, and this asks about the
bytes a document is stored in.

## What each case asks, and what a reader needs

Each case in `expected.json` carries `mutation` (the one thing changed),
`question` (what a reasonable reader should do about it), `spec` (the section of
SPEC.md that answers it), `asked` (the check and reason code the case requires,
where the format states one), `expected` and `port` (what each implementation
said), `agreement`, and `note`. The builder refuses to write a record whose
artifacts do not match their mutations or whose answers contradict the questions
they ask.

One case's `spec` is `null`, and it is the only one:
`unsupported-method-beside-a-wrong-size` asks a question about check statuses
rather than about the container, so §10.1 answers it and no section of 3 does. The
column means "where this answer lives", and null is how a case says "not in
section 3" — the record's `note` names the section that does.

The replay needs **Node**, which is running it, and uses the **Python
interpreter** if this machine has one. A machine without one skips that leg, says
so, and still exits 0.
