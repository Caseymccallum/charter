# Changes

Recorded because they are decisions about published behaviour, not internal
tidying. The format identifier in `manifest.format` changes when section 14 of
[SPEC.md](SPEC.md) changes; this file records what changed, when, and why.

## Unreleased — the six field lists, and the arrays a verifier is handed

Sections 5 and 7 each introduce a table with a sentence that counts it. Section 5
says a manifest is "one canonical JSON object, one LF, and no other field than
these six", and section 7 says each entry carries "exactly these seven fields".
Two of section 5's rows describe the objects nested inside the manifest, and one
of section 7's does the same for an entry, so between them the document declares
six lists:

- the six fields of a manifest,
- the one field of its `content` object,
- the four of its `author`,
- the seven fields of a provenance entry,
- the two of that entry's `author`,
- and the enumeration an `action` must be one of.

Each is also declared twice in code — as an array in `verifier/manifest.js` or
`verifier/provenance.js`, and as a tuple in the Python reading's `documents.py` —
and nothing held any of the three copies together. **These arrays are not
decoration.** `findUnknownField` is handed them to answer
`L0.MANIFEST.EXTRA_FIELDS` and `L0.PROVENANCE.EXTRA_FIELDS`, so a name added to
one of them is a field the verifier *accepts* while the document forbids it, and
a name dropped from one is a field the verifier *rejects* while the document
allows it. Either is a verdict that disagrees with the specification, and until
now both would have left the suite green.

`test/spec.test.js` now reads all six lists from the tables themselves — the
nested ones are read out of the row that describes them, so no name is
transcribed — and holds them against both code copies. The comparison is as
**sets**, because the three orders genuinely differ: the document lists the
manifest's fields logically, the JavaScript arrays are alphabetical, and the
port keeps the document's order. Nothing turns on that ordering, so nothing is
claimed about it.

Two more claims were sitting in those sentences unread, and are now read: "these
six" and "exactly these seven" are counts, and each has to match the number of
rows beneath it. A table that grows a row while its sentence stays put fails,
and a sentence changed to match a table that was never edited fails too.

Seven ways this can drift are caught, each by the check that owns it: a field
added to or dropped from either JavaScript array, a field renamed or dropped in
the port, a row removed from a table, a stated count moved off its table, and an
action enumeration widened in the document.
## Unreleased — the nine published ceilings, and the third declaration nobody read

Section 3.7 ends with a sentence about its own table:

> These numbers are part of the published behaviour of charter/0.1. Changing one
> changes what a verdict means.

Nine ceilings, called published behaviour, and the section is right to say so:
the table, `verifier/limits.js` and the Python reading's `limits.py` each hold
all nine, and a reader that disagreed with the verifier about one of them would
produce a different verdict for the same bytes. That is the same class of claim
as §10's reason vocabulary and §12's verbs — a part of the specification that is
also code — and it was the only one of the three that nothing held. A ceiling
could have been changed in either module, or in the table, and the suite would
have stayed green while the three copies said different things.

`test/spec.test.js` now reads all three. It is a slightly different check from
the two beside it, because §3.7's table is the one declaration in this document
that does not name what it declares. Its first column is prose — "Whole file",
"One entry, compressed" — and its second is a number with a unit a person reads:
"256 MiB", "100,000", "65,535 bytes". Neither column contains anything a reader
could match against `MAX_ARCHIVE_BYTES`. What the three copies do share is their
order, so the comparison is **by position**: the table's row *n* is the *n*-th
ceiling `verifier/limits.js` declares, and the *n*-th the port declares. That
leaves the table's order under the same claim as its numbers — a table reordered
while keeping its rows passes nothing — and it needs no fourth copy of the truth
to say which row is which.

The port's half needed one thing the other two did not. Its ceilings are written
as arithmetic — `FILE_BYTES = 256 * 1024 * 1024` — because that is how the
numbers are read, and a reader that took only bare digits found four of the nine
and would have passed on the other five. The reader evaluates the expression
instead, over a grammar of multiplication, addition and parentheses, and fails on
anything outside it by naming the line: a value written some other way is a
refusal, not a silently skipped ceiling.

All four ways this can drift are caught, each by the check that owns it: a
magnitude changed in the table, in `verifier/limits.js`, or in the port's module,
and two rows of the table transposed.
## Unreleased — the exit code no verb was asked about, and the table that asks now

Section 12 states an exit code per verb, not just per program:

> `66` belongs to the four that read a file named on the command line — `seal`,
> `edit`, `inspect` and `cite` — and `73` to the three that create one: `seal`,
> `edit` and `keygen`.

That sentence exists because the version before it was **wrong**: it gave `keygen` a
use of `66`, and `66` means a *named file could not be read* when `keygen` reads no
file at all. The pass that fixed the sentence added the sentence; nothing added a
check. The gap is easy to miss because the mapping was true in every other cell, and
because the guard that *did* exist — `test/spec.test.js`, which holds the verbs
section 12 shows against the verbs `cli/charter.js` dispatches — asks a different
question. It compares two *sets*, so it catches a verb with no line in the document
and a line for a verb that does not exist. A code attached to a verb that does exist
is invisible to it, and that is precisely the shape the `keygen` error had: seven
verbs, seven rows, every count consistent, one cell false.

### What asks now

Three tests in `test/cli.test.js`, each one a process run rather than a comparison of
two lists, because an exit code is only ever evidence when a real invocation produced
it:

- **The table is complete in both directions.** Every verb section 12 shows is a verb
  this file asks about, and every verb this file asks about is one the document
  shows. A verb added to the command line and given no row there would be asked
  nothing; a row for a verb no document shows is a question about nothing.
- **`66` is asked of every verb.** The verbs the mapping names as readers — plus
  `verify`, whose five verdict codes section 12 states in the sentence before — are
  handed a path that holds nothing, and each has to exit `66`. Every other verb has to
  *not* exit `66`, which is the half that would have caught `keygen`: the negative
  case is the assertion the old sentence needed and nothing made.
- **`73` is asked of every verb.** The three the mapping names as writers are handed
  an output path that is already taken, and each has to exit `73`; the four that
  write no file have to not exit `73`.

The reader that feeds them also holds section 12's own number words against its own
lists — "the **four** that read", "the **three** that create one" — so a list that
grows by one while the number stays put fails the same way a number that moves while
the list stays put does. That is the drift `test/counts.test.js` refuses in prose,
applied to a sentence that is both a count and a rule.

The count of tests moved from 174 to **177**, updated in the three places `README.md`
states it.

## Unreleased — the boundary the courier's prose described, and the socket nobody asked

`editor/serve.mjs` is a courier that hands this repository to a browser, and the
rule that makes that safe is one branch: a request is resolved, and the resolved
path has to be inside the tree. Four documents state it. The module's own header
says "the resolved path has to be inside the repository, and the check is on the
resolved path rather than on the request"; `editor/README.md` says the courier
"reads files out of this repository and hands them to the browser"; `README.md`
and `docs/first-user.md` both say it serves on loopback. Every test that touched
the courier until now used it as plumbing — start it, point a browser at it, assert
what the page did — so the one sentence that describes a security boundary was the
one sentence with nothing behind it. A boundary only prose describes is a boundary
nobody has measured.

### Why the test is written against a socket and not against `fetch`

The first attempt looked like a finding and was not one. Asking `fetch` for
`/vectors/../../package.json` came back **200**, which reads as a traversal. It is
not: `fetch` — and `node:http`, and every browser — normalize `..` in the target
before the request goes out, so what reached the courier was `/package.json`. The
client had answered the question itself and asked an easier one. A test of a path
rule has to put the bytes on the wire by hand, so `rawGet()` opens a socket, writes
the request line itself, and reads the response; the rule is about what arrives.

That also turned up a second thing worth writing down. `serve.mjs` answers with
`response.end(body)` and no `content-length`, which is a **chunked** response, so a
reader that stopped at the end of the header block was comparing the page against a
buffer beginning with a hex length. The helper de-chunks before returning, because
what the assertions need is *the file*, not the transfer of it.

### Which 404s mean something

Most of the hostile targets a reader would reach for do not test the boundary at
all, and the test says so rather than implying otherwise:

- `/etc/passwd` resolves to `<root>/etc/passwd`, and `/C:/Windows/win.ini` to a
  name no process ever created. Both are **missing files inside the tree**. They
  come back 404, and they would come back 404 with the `inside` check deleted.
- The case that separates the boundary from a missing file is a file that genuinely
  exists outside the tree: the test writes one in this machine's temp directory and
  asks for it through the `..` segments that reach it from the repository root. A
  courier that resolved a request and served whatever it landed on would hand it
  over; the boundary is the only thing that can refuse it.

The same rule has a second half, and it is what makes it a rule about the *resolved
path* rather than a substring check on the request: `/../<repository>/package.json`
walks out and back in, is not an escape, and is served.

### What the test was measured against, and what moved

Deleting the `inside` check in `editor/serve.mjs` leaves every ordinary 404
unchanged and turns exactly the outside-the-tree case into a 200; changing the
binding from `127.0.0.1` to `0.0.0.0` fails the loopback assertion. Both mutations
were run before the test was trusted, and the module was restored unchanged — no
file under `verifier/**`, `producer/**`, `vectors/**` or `editor/` is different for
this pass.

- `test/editor.test.js` gained the courier half: one socket helper, one test that
  asks for the page at three targets and compares it with the bytes on disk, for
  the three content types that matter, for six targets it refuses and *why* each is
  refused, for the outside-the-tree case, and for both sides of the resolved-path
  rule. The module header now says what the three kinds of evidence in the file are.
- `editor/README.md`'s courier sentence now states the resolution rule and says
  which test asks it, instead of leaving the boundary implicit in "reads files out
  of this repository".
- `README.md`'s `editor.test.js` cell names the courier coverage beside the import
  graph and the browser run.
- The count of tests moved from 173 to **174**, updated in the three places the
  README states it. It remains the one number these documents state that the suite
  cannot check: a suite cannot run itself to read the number it is about to print.

## Unreleased — three documents nothing read, and a rule with no test behind it

The suite that checks these documents' counts was stated over "this project's
prose" and then read five of them: `README.md`, `SPEC.md`, `docs/first-user.md`,
and the two kit READMEs. Three documents that state counts about the present were
read by nothing:

- `editor/README.md` — "asks it for **all 56 artifacts** in the conformance kit".
- `implementations/python/README.md` — five counts: the probe's 27 questions, the
  34 hand-mutated containers, "**56 fixtures, 56 matched exactly.**", "the
  reference CLI's output for all 56 fixtures", and the 27 hand-built artifacts the
  kit does not cover.
- `test/adversarial.md` — "Totals: **37 cases**, 37 pass, 0 fail."

None of the three was wrong. That is the finding: the rule said *what* to check and
never said *where*, so the documents it applied to were whatever somebody happened
to list, and a document nobody listed was unread in silence. Nine of the ten
Markdown documents in this repository state a count about the present; the tenth
that does not is `NAMING.md`, and `CHANGELOG.md` is history by definition.

### The rule now names its reading list, and the list is checked

`test/counts.test.js` discovers every Markdown document from the directory tree
rather than from a list, and each one is either a document a claim reads a count
out of or one of the two excused in `NOT_READ` **with a reason**. A document in
neither list fails the suite, which is what would have caught these three. Two
consequences follow from that shape, and both are deliberate: a new document with a
count in it is a finding rather than an omission, and an excuse has to be a sentence
rather than a name — "not read" is exactly what went unnoticed, so a name with no
reason beside it fails too.

Seven claims were added: one for `editor/README.md`, one for `test/adversarial.md`,
and five for `implementations/python/README.md`.

### The near-miss this pass actually turned up

The reading list was already right when the assertion was finally written, and the
assertion passed on its first run. `DOCUMENTS` and `NOT_READ` had been declared a
pass earlier, with the reasons written out — and nothing consumed them. So the fix
had been *data only* and unenforced: a new document could have been added with a
count in it and the suite would have stayed green while reading none of it. What was
missing was the assertion, not the list. That is the same thing `test/spec.test.js`
states from the other side — "a rule that no check enforces is not a rule" — and it
is worth recording that this file broke its own rule for a pass while claiming to be
the file whose business that is.

One claim was also written from memory rather than from the sentence. The Python
README states its comparison across a line break — "compared key for key against
the / reference CLI's output for all 56 fixtures" — and a pattern that included the
leading `the` never matched anything. The pattern now reads the words that are on
one line. A claim has to be copied out of the document it is about, which is the
whole reason this file reads sentences rather than deriving numbers.

### What changed

- `test/counts.test.js` reads eight documents instead of five, holds
  `adversarial rows` as a measured value (37), and grew the rule-4 test above. Its
  header now lists the counts it holds, including the 37 rows of the adversarial
  table, which no document's number was checked against before.
- `README.md` says what the third thing is that this file refuses — a document
  nobody reads — where it explains which counts the suite holds and which the run
  prints.
- The count of tests moved from 172 to **173** for the added test, and is updated
  in the three places the README states it. It stays the one number these documents
  state that the suite cannot check, for the reason recorded above: a suite cannot
  run itself to read the number it is about to print.

## Unreleased — the command line's sixth verb, and the sentence that denied it

`edit` is the producer's second verb, and three sentences about this producer were
written before it existed. The one that matters is a denial. Section 15.1 ended its
account of what `seal` writes with:

> Writing the later entries of a history is a verb this producer does not have.

It does have it. Section 15.6 is headed "A later entry" and states that verb's rules
in full; `producer/edit.js` implements every refusal section 15.5 requires of it;
`charter edit` has been dispatched by `cli/charter.js` since the pass that added it;
and `produced-two-entries` is in the kit precisely because the two verbs were run to
make it. So the sentence was not a stale count but a stale **claim of absence**,
which is the harder kind to notice: no number moves when it stops being true, and
nothing in the tree contradicts it unless a reader goes looking.

Section 12 had the matching hole from the other side. It lists "the commands that
write and describe files", and the list was `keygen`, `seal`, `inspect` and `cite` —
four verbs, where the command line dispatches five on that side of `verify`. The
exit-code paragraph underneath was wrong twice for the same reason. It named four
verbs that "also use `64` and `66`", omitting `edit`; and it gave `keygen` a use of
`66` that the verb cannot reach, because `66` means a *named file could not be
read* and `keygen` reads no file — it reads nothing and writes one. Both sentences
are now the mapping the code actually implements: `64` is any verb's, `65` is the
producer's refusal, `66` belongs to the four verbs that read a file named on the
command line (`seal`, `edit`, `inspect`, `cite`), and `73` to the three that create
one (`seal`, `edit`, `keygen`).

### What the suite checks now

`test/spec.test.js` already held section 10's vocabulary against
`verifier/status.js`, on the argument that the part of SPEC.md which *declares*
something cannot be allowed to drift from the thing it declares — that check is how
`L0.MANIFEST.FORMAT`, a check id section 5 named and the registry never had, was
caught. Section 12's command block is the same kind of claim, so it is now checked
the same way: the verbs are read out of three places — the dispatch table and the
`HELP` block in `cli/charter.js`, and the command lines in section 12 — and all
three have to be one set, in both directions. A verb the command line dispatches and
no document shows fails; so does a documented verb with no command behind it. That
is what would have caught the missing `edit` line the day it appeared.

### What this does not check, and why the README still says its own number

The count of tests is a claim about a run, not about the tree, and this pass moved
it: `spec.test.js` gained the verb check, so `npm test` prints **172** where the
README said 171 in three places. Those three are updated, and they stay the one
number in these documents that the suite cannot hold — a suite cannot run itself to
read the number it is about to print, and `test/counts.test.js` deliberately leaves
that kind of count alone. Everything else the README and SPEC.md state about the
present is read back off the disk: the kit's artifacts and recorded answers, the
probe's, the corpus's, the Phase 1 and adversarial cases, the one artifact a tool
wrote, the test files, and the size of the editor's page.

## Unreleased — two artifacts nobody accounted for, and the counts nobody read back

`charter edit` left the kit one artifact richer and the documentation two counts
poorer, and this pass followed both the wrong way.

The first is the specification's own accounting of its own kit. Section 13 tells a
reader to replay 56 artifacts and then divides them: "The 26 Phase 1 cases … The
other 28 are the **adversarial pass**." That is 54. The case the last pass added —
an entry whose bytes expand past section 3.7's ceiling — went into the Phase 1
group and moved that count to 27. `produced-two-entries`, the one artifact in the
kit that `vectors/build.js` does not write, was in neither group, because section
13 had never had a group for it: the paragraph that describes what the kit holds
described 54 of the bytes the same section asked a reader to run, and the two it
left out were the two most recent passes had added. Nothing about the verifier was
wrong. Everything about the accounting was, and no reading of section 13 would have
said so.

The second is smaller and worse, because it was in the first file anyone reads.
`README.md` said "148 tests" in three places for a suite that had run 166 since
`edit` landed, and said its test list was "including" a set of ten files in a
directory of seventeen. A count that nobody checks is a sentence that reads exactly
like a true one.

### What a number in a document has to be

There are two kinds of count in this project's prose, and they are not the same
claim.

- **A number a record on disk holds.** The kit's artifacts and its recorded
  answers, the probe's and the corpus's, the adversarial pass, the Phase 1 cases,
  the test files, the size of the editor's page: each is held by something a
  reader can open. Those are checked.
- **A number a run prints.** The tests `npm test` performs, the tests the Python
  port's suite performs, the sweep's field-level questions: a number like that
  cannot be read back from a tree, so a document states it beside the command that
  prints it. That is why the README's counts now sit next to their commands, and
  why the README says which of the two kinds each one is.

`test/counts.test.js` is where the first kind is checked. It reads the sentences
themselves — a phrase that stops matching fails the test rather than going quietly
unchecked, the same arrangement section 10 has with `test/spec.test.js` — and it
holds the numbers against the record and against the directories of artifacts they
are about. It also refuses the two shapes of drift this pass found:

- **A kit case in no group.** Section 13's three groups — the Phase 1 cases, the
  adversarial pass, and the one artifact a tool wrote — must be exactly the names
  `vectors/expected.json` holds, each in one group and none left over. A case added
  to the kit and described by nothing now fails the suite, which is how the ceiling
  case and the tool-written artifact were found.
- **A test file nobody names.** Every `*.test.js` in `test/` is named in the
  README's layout row, and every name there is a file. `runtime.test.js` — the file
  that holds section 12's runtime promise as a test — was added by the pass that
  patched that hole and was named nowhere.

`CHANGELOG.md` is deliberately not read by it. A count in a changelog entry was
true when the entry was written, and rewriting one to match today would falsify the
record rather than check it; the same reasoning keeps every historical count in
this file exactly as it was, including the ones this pass made stale.
`docs/first-user.md` is read for one present-tense claim only: the size of the page
it says it served before the session it is waiting for.

### What changed, and what did not

- Section 13 now says **27 + 28 + 1 = 56**, names `unreadable-manifest` and
  `entry-expands-past-ceiling` among the Phase 1 cases, and gives
  `produced-two-entries` the paragraph it never had: the artifact `charter seal`
  followed by `charter edit` produces, here because the question a *producer* has to
  answer — is a history it wrote readable by readers that did not write it — cannot
  be asked of a writer's own bytes.
- `README.md` states the count the suite actually runs, names all of its test
  files, and says where each of its counts comes from.
- No artifact, no recorded answer and no verdict moved: this pass changed prose and
  added a test. The kit is still 56 artifacts with the same digests; the suite is
  171 tests; the port's is still 114; the probe 27; the corpus 34; the sweep 212
  field-level questions, and both implementations still answer every one the same
  way. The first-user session has still not been run, and `docs/first-user.md` still
  says so.

## Unreleased — `charter edit`, and the two holes a second verb found

`seal` begins a history and nothing in this project could write the second entry in
one, which left the format's central claim — a document that carries its own edit
history — as something the tool could state and not continue. `charter edit` is that
verb: `producer/edit.js`, the subcommand, the `npm run edit` script, and 42 tests in
`test/producer.test.js`. It is also the first thing here that writes a file it did
not entirely make, and that is what it cost: four questions the spec had never been
asked because no producer had been in a position to ask them — all four about *what
a writer does with a file that is already wrong* — and then two more once the file it
wrote had been read back, this time of the verifier.

The four writer questions are rules in a new §15.6, because nothing inside an
artifact can check what a producer decided before writing one. The two found
afterwards were holes rather than disagreements, and both are patched: `verifier/zip.js`
inflated a deflated entry without a bound where §3.7's ceiling says stop, and it
reported a runtime it did not have as a failure of the file where §12 promises
`INCOMPLETE`.

Every suite is green: the kit is 56 artifacts, `node --test` is 166 tests, the port's
own suite is 114, the probe is 27 cases, the corpus is 34, and the sweep's 212
field-level questions come back the same way through both implementations. The
first-user session has still not been run, and `docs/first-user.md` still says so.

### What a later entry commits to, and what an edit refuses

An edit reads an artifact, appends one signed line to its log, writes the new
document, and moves the manifest's `content.sha256` with it. Everything else about
the file it was handed is carried forward, and that is where the questions were:

- **The earlier lines are copied byte for byte.** An edit appends a line and does
  not reflow, reorder, or re-sign one, so a line written by something else is still
  that thing's bytes. `parent` is the digest of the line before it *as that line
  stands in the file*, which is the expression the link check already recomputes
  rather than a second reading of §9.
- **The entries are copied and the container is written again.** §3's fields are
  values the format fixes rather than claims a signer made, so an artifact whose
  container a reader refuses — two copies of a feature level that disagree, a
  metadata field the table does not name — can still be read for its entries, and
  what the edit writes around them is the container a conforming writer writes.
  Nothing is laundered by that, because a producer does not repair a *claim*: a
  history with a stale signature stays a history with a stale signature. Both halves
  are one paragraph in §15.6, rather than one rule and one thing a reader has to
  infer from the code.
- **An edit requires a file it can read, not one it can believe.** It runs no
  verdict and does not refuse a broken artifact: the line it writes commits to the
  bytes that are there, so an honest account of a file somebody else wrote does not
  become dishonest because that file was already broken. A producer that ran the
  verifier over its input would be a second verifier, which is the one thing this
  project must not grow.
- **A summary nobody stated records the absence.** `seal` has a default because a
  seal's fact is that this is the first revision; an edit has no such fact to state,
  and "No summary stated." is a sentence about the missing argument rather than a
  claim in a signed record that no signer wrote.
- **Three shapes are refused rather than quietly repaired.** A manifest field
  charter/0.1 gives no rule to is `UNKNOWN_FIELD`: writing the file back would drop
  a field it carried, and dropping a claim is not the same deed as never making it.
  A fourth entry or a second copy of one name is `EXTRA` or `DUPLICATE` — the two
  codes the check that owns the entry set reports for the same two shapes, since
  copying the entries it read leaves no room to drop one silently or choose between
  them. A `format` this build does not implement is `UNSUPPORTED_FEATURE`, the code
  §14 gives a verifier for the same file.
- **The kit's one producer-written artifact is deliberate.** `produced-two-entries`
  is written by `charter seal` and then `charter edit`, and it is evidence that the
  tool's bytes are the reader's bytes — a seal and an edit that both verify — and not
  independent-writer evidence, which is what the other 55 artifacts are for. The
  README says which one it is, so that nobody reads it as a second builder.

### The ceiling that said stop, and the reader that did not

§3.7's table has said **inflation stops past it** since the ceilings were written, and
the reference has always stopped: `inflateRaw` is handed the ceiling and cancels the
stream once the total passes it. The port did not. Its `decompress` inflated through
`zlib.decompress`, which has no bound, so an entry declaring 8 bytes and expanding to
200 MB was 200 MB of memory spent answering `L0.ZIP.SIZES`=MISMATCH — a verdict about
a document nobody sent, in the one reader whose §3.7 exists so that it never allocates
one.

What made it a finding rather than a bug report is that no case could have caught it.
The corpus's two ceiling cases both *declare* the number — a size field of
`0xFFFFFFFF` — so everything that reaches them is the comparison §3.7 states, which
both implementations do. The stop is the half of a ceiling that a declaration cannot
satisfy, and it had no case anywhere: the corpus's notes say which check carries a
ceiling and never that anything is stopped at one, and the kit had no entry ceiling
case at all.

- **§3.7 states the stop out loud**, in a paragraph of its own: one of these ceilings
  is enforced while the work it bounds is done as well as before it, `L0.ZIP.ENTRY_DATA`
  carries it with `LIMIT_EXCEEDED` however few bytes a header declares, and the two
  halves are one ceiling.
- **The kit gained `entry-expands-past-ceiling`.** `content.md` is a raw-deflate stream
  of 64 MiB of zero bytes and one more, its header declares 8 uncompressed bytes, and
  its CRC-32 is the honest one. The declaration is inside the ceiling, so the
  comparison passes and only the stop can answer this file: `BROKEN`,
  `L0.ZIP.ENTRY_DATA`=LIMIT_EXCEEDED, and 4 checks skipped behind it. The fixture is
  65 KiB of artifact, because a case about a ceiling may not cost a reader what the
  ceiling exists to refuse.
- **The port moved.** `_inflated` decodes through a `decompressobj` given a length one
  byte past the ceiling and reads the three endings apart: DECODE_ERROR for bytes that
  are not a stream, LIMIT_EXCEEDED for a stream that expands past the ceiling whatever
  it declared, and DECODE_ERROR again for one that ends inside its own bytes — which
  `decompressobj` reports by leaving `eof` false, where `zlib.decompress` raised. Every
  recorded answer in the kit, the probe, the corpus and the sweep is unchanged.

### The runtime promise the code did not keep

§12 says what happens on a runtime older than the floor: every check that cannot be
performed is reported `UNSUPPORTED` with reason `UNSUPPORTED_FEATURE`, which is
`INCOMPLETE`, and `INCOMPLETE` is not a pass. The branch that takes the deflate
facility away ends in `readEntryData`, which returned `status: FAIL` for every way
`inflateRaw` can fail — so a runtime without `DecompressionStream('deflate-raw')`
turned a check the *reader* could not do into a verdict about the *file*: `BROKEN` and
exit 2, against the promised `INCOMPLETE` and exit 1.

`test/runtime.test.js` was written to say so, with its second test skipped and the
divergence in the skip message rather than patched, because a test that asserts a
promise the code does not keep is a finding before it is a fix. The status now follows
the reason code instead of the call: `UNSUPPORTED_FEATURE` is `STATUS.UNSUPPORTED` and
the other two are `FAIL`, which is what §3.7 and §3.3 ask for. The test is un-skipped,
and the file records what the branch did when the test was written.

## Unreleased — the two findings settled, and the session that waits on a person

The pass before this one recorded two findings rather than patching them, and both
were the right shape. Neither was an editor problem: both were format problems, and
they had to be settled first. A first-user session that hits a format hole tells you
about the format, not about the editor, and the session is the one chance to find
out about the editor. Both are settled here, every suite is green on the pinned
floor, and the session has still not been run — `docs/first-user.md` says so and is
otherwise the document it was.

### An extra field is a shape charter/0.1 has no room for

`local-extra-field-unread` was the corpus's first recorded *hole* rather than a
difference: a local header carrying the four-byte UNIX extended-timestamp field,
declared honestly, which both implementations accepted because §3.4 accounted for
the bytes and no check read them. §3.6's own rule — *a byte the reader never looks
at is a byte a forged file can change for free* — is the sentence that argued with
that, and §3.6 is where the settlement went, because the question is what a header
field may hold and that is the section whose table fixes that:

- **§3.6's table gains two rows.** A header's extra field is zero bytes long, in the
  local header and in the directory record, and a directory record's comment is
  zero bytes. Both copies are read, so two copies that disagree about a length are
  this check's failure too.
- **`L0.ZIP.METADATA` is the check**, and it reports `EXTRA`. Not `MISMATCH`: a
  mismatch is a value that is not the one the format fixes *in a field the format
  has*, and there is no field here for a value to be in — a charter/0.1 header is
  its fixed part, its name, and then the data. Not `UNSUPPORTED` either: an extra
  field needs nothing implemented, since a reader skips the bytes the length
  declares and reads the entry, so that code would be a claim about the reader
  rather than about the file. `EXTRA` is the word §3.3 already gives a general
  purpose bit charter/0.1 has no room for, and §3.4 gives bytes where the format
  does not put them. ZIP's own tables say an extra field's identifier means
  something — 0x0001 is a ZIP64 size, 0x5455 a timestamp — and reading those would
  be applying another format's rules to a file that declares this one.
- **§14 gains the rule the rest of the format needed anyway**: an artifact that
  declares charter/0.1 and holds a shape charter/0.1 gives no rule to has no version
  to report. `UNSUPPORTED_VERSION` is for an artifact that *declares* an identifier
  this verifier does not implement and `UNSUPPORTED_FEATURE` is a claim about the
  reader, so the answer is the check whose requirement the shape breaks, with the
  code for a place the format gives no rule to — `EXTRA` for §3.3's flag bit and
  §3.6's extra field, `UNKNOWN_FIELD` for a named field no section defines,
  `MALFORMED` for bytes that are not the shape any section names.
- **§10's registry and §10.2 say so**, §10.3's account of the family that pass left
  open now records the settlement, and the case's `spec` moved from §3.4 to §3.6,
  because the column means where an answer lives and that is where this one lives.

**Both implementations moved**, and this is the one case in the project where
neither was wrong before the rule existed: the rule was what was missing. Two other
corpus cases carry an extra field of their own — `entry-extra-len-off-by-one` and
`central-extra-len-past-eof` — so their recorded answers gained
`L0.ZIP.METADATA`=EXTRA beside the failure each was built to ask about, and the
failure each was built for did not move. `verifier/zip.js` now keeps each entry's
local extra-field length, `charter_verify/checks.py` reads the same two lengths, and
nothing else under `verifier/**` changed.

### A number token ends where the format says it ends

The second finding was a disagreement the probe's builder refused to record, and the
builder was right to: replace the first byte of `created_at`'s value with a newline
and the bytes `2026-01-01T00:00:00Z` stand where a value belongs. The reference
reported `L0.MANIFEST.PARSE`=NON_INTEGER_NUMBER and the port reported MALFORMED
about an object holding a `-` where a comma or a brace was due. §4's integer rule
named `01` as NON_INTEGER_NUMBER and said nothing about how far a malformed number
runs, so the silence was in §4 — not §4.1, which is about the bytes a signature
covers — and that is where the rule went:

- **A number token runs to the first character that cannot occur in one.** The
  characters that can are the ten ASCII digits, `-`, `+`, `.`, `e` and `E`, and the
  digits are named as ASCII because `str.isdigit()` is true of digits no number in
  this format is written with. The token is then compared against `0` or
  `-?[1-9][0-9]*`, and a token that is not that spelling carries
  NON_INTEGER_NUMBER whatever part of it is wrong: a fraction, an exponent, a minus
  with no digits, a second sign (`2026-01-01`), a leading zero, or a run of them.
- **`MALFORMED` is for the character where a value is due that cannot begin a
  number** — `+1`, `@`, `.5` — and a number-shaped token out of the 53-bit range is
  NUMBER_OUT_OF_RANGE.
- This is deliberately not JSON's grammar, and `01` was already the precedent: JSON
  calls `01` a syntax error and this format calls it a number the reader would not
  have written. The case that made the rule necessary is the same family.
- **The port moved.** Its scanner stopped at the `-`, kept `2026` as its number, and
  reported a structural error about a character it had itself refused to read as
  part of the number — its own stopping point, described as a defect of the file.
  `_number` now scans the class §4 names, and the constant the port carried for the
  `01` answer is gone, because the spec states the rule now and there is nothing
  left for a constant to record.

**The case is `created-at-value-opens-a-number`**, added to the differential probe
with the recorded answer `L0.MANIFEST.PARSE`=NON_INTEGER_NUMBER and 11 checks
skipped behind the parse. The probe is 27 cases, and every suite passes: corpus 34,
kit 54, probe 27, sweep 212, `node --test` 148, the port's own suite 114.

## Unreleased — three cases by hand, and the sweep that decided against a fuzzer

The previous pass ended with a recommendation: three byte-arithmetic mutations no
field-level case can state, then a decision about a differential container fuzzer,
and then the first user. This pass did the first, measured its way to an answer for
the second, and left the third where it is.

Eight cases were added to the container corpus — the three the recommendation
named, a fourth they led to, and four the measurement produced — and they found six
differences: five the port's, and one where both implementations had answered the
same wrong thing. Two more cases moved nobody: one enforces a rule §3.1 already
stated, and one records a *hole* rather than a difference (settled by the next pass —
see the head of this file). §3.1, §3.2, §3.4 and §10.1 changed, all 34 cases agree,
and `manifest.format` is still `charter/0.1`.

### The three cases, and the fourth they found

Each of the three is one mutation of `vectors/out/valid.charter`, and each has an
answer in the record:

- **`entry-extra-len-off-by-one`** — `provenance.jsonl`'s local header carries four
  bytes of extra field and declares five, so the entry's declared data starts one
  byte late and its declared end lands one byte inside the central directory.
  **Both implementations were wrong the same way**: each reported
  `L0.ZIP.LAYOUT`=EXTRA, which §3.4 gives a *gap*, and this is not a gap — the last
  entry's data and the directory were two claims about one byte, which is §3.4's
  overlap and MISMATCH. §3.4 stated the comparison in one sentence with one code and
  no direction, and `verifier/zip.js` measured the difference with `Math.abs`, which
  is how a reader can tell the author knew it could be negative. §3.4 now states both
  directions, and both implementations report the one they are in. This is the first
  case in the corpus's history where the two implementations agreed and were both
  wrong, and the finding is the *silence* that let them.
- **`entry-name-length-copies-differ`** — `content.md`'s local header declares
  `name_len` 11 where the name is ten bytes and the directory says ten. **Nobody
  moved**: both refuse at the gate with `MISMATCH` and 29 checks never run. The case
  is the answer to its own second half — the data offset the declared length moves is
  never reached, because a reader that has not agreed with itself about the name does
  not know which bytes are the sizes — and that order is the one §3.1 now states for
  the directory as a whole.
- **`entry-byte-deleted-mid-directory`** — one byte removed from the middle of the
  directory, so every later record is one byte early while the count, every offset
  and the declared directory size are exactly what they were. **The port moved.** The
  reference reads every record before it compares any record's name with the local
  header that record points at, so it found the third record missing and reported
  MALFORMED; the port compared each name as it walked, so it reported MISMATCH about
  a name at an offset its own walk had already broken, and never said the plainer
  thing. §3.1 now fixes the order — the shape of the directory is established before
  its records' claims are compared — and `walk` reads the whole directory in one pass
  and resolves local headers in a second.
- **`entry-name-not-utf8`** — the fourth case, found by hand while building the
  three: one byte of `content.md`'s name, in both copies, set to a byte that cannot
  stand alone in UTF-8. **The port moved**, and not by a word: the reference refused
  at the gate with DECODE_ERROR and 29 checks never run, and the port decoded the name
  with replacement characters, carried on, and reported `L0.ZIP.ENTRY_SET`=MISSING
  with 2 checks never run. No case in the kit or the probe asked this and §3.1 said
  nothing about whether a name has to be a string; it does now, and the port decodes
  each record's name as it walks.

**Did any of them reach behaviour neither implementation was written for?** Two of
them, and they are the two the recommendation predicted.
`entry-byte-deleted-mid-directory` is the one: neither reader was written *against*
§3.1, because §3.1 did not say in which order the directory's shape and its records'
claims are settled — the reference happens to settle them one way and the port the
other, and only a misaligned directory can tell. `entry-extra-len-off-by-one` is the
other: neither reader was written for a range that ends past the directory's own
offset, so both took the branch their code had and gave the code they had for it. The
corpus is what turned both into sentences in the spec.


### What the measurement found, and what it settled

The recommendation asked whether to build a differential container fuzzer, and said
to build it only if the hand cases suggested more of the same were out there. Rather
than answer that from the three cases alone, the question was measured: a throwaway
differential sweep moved every field of every record through seven values, moved the
two copies of each repeated claim together, and (separately) wrote random bytes into
two to four positions of the record regions. Before this pass's fixes it found 20
disagreements in 1301 structured mutations and 17 in a 400-mutation random run.

Three families, all now cases:

- **Which copy of a repeated claim a check reads.** A feature level above 2.0 in the
  *local* copy only: the reference reported `L0.ZIP.METADATA`=MISMATCH and left
  `L0.ZIP.VERSION` passing (it reads the directory's copy); the port read
  `max(central, local)` and reported `UNSUPPORTED_VERSION` as well. **The port
  moved.** §3.2 now names the copy, which is §3.5's rule for every claim the file
  states twice, and the case is `entry-version-needed-local-only`. The direction is
  the point: the two copies are one claim written twice, not two opinions, and a
  reader that takes the larger of them has invented a requirement.
- **A record whose declared extent reaches past the file.** The reference walked all
  three records and reported `L0.ZIP.LAYOUT`=MISMATCH; the port refused at the gate
  with `MALFORMED`. **The port moved.** §3.4 now says what "the size its records use"
  is and that the gate reads *names*; the case is `central-extra-len-past-eof`, and
  it is the first case where the reference had the better answer and the port refused
  too early.
- **A defect a check measured and did not report.** One entry's method is one this
  verifier does not implement and another entry's declared size is wrong: the
  reference measured the entry it could read and reported `L0.ZIP.SIZES`=MISMATCH,
  and the port gave up on the check and reported `SKIP`. **The port moved**, and this
  is the pass's worst finding, because the port was not wrong, it was *silent* about
  evidence it had. §10.1 gains the rule one entry down from its own "the gate is the
  fact, not the status": a fact that names one entry gates that entry and not the
  check that reads it, so a check whose requirement is about every entry is SKIP only
  when every answer it gave was "not measurable". The case is
  `unsupported-method-beside-a-wrong-size`, and it is the only case in the corpus
  whose `spec` is null — its answer lives in §10.1, and the column says where an
  answer lives.

And one case moved nobody, because no implementation can be wrong about it:
**`local-extra-field-unread`** is a charter whose local header carries a four-byte
extra field, declared honestly, and it came back VERIFIED from both. §3.4 puts an
extra field in the list of things every byte of the file is accounted for by,
nothing reads what is inside it, and §3.6's own rule — *a byte the reader never looks
at is a byte a forged file can change for free* — is the sentence that argues with
that. This was the corpus's first recorded hole rather than a difference, and the
next pass settled it the way §14 said it had to be settled: §3.6's table now fixes a
header's extra field and a directory record's comment at zero bytes, `L0.ZIP.METADATA`
reports them with reason `EXTRA`, and §14 says which voice answers an artifact that
holds a shape charter/0.1 gives no rule to. **Both implementations moved** when it
was settled, and neither was wrong before the rule existed. The next pass's section
at the head of this file, *An extra field is a shape charter/0.1 has no room for*,
has the rule.


This pass asks one question of the repository rather than of the format: **which
of the rules stated here can a stranger check?** A rule held by this project's
own tests is a rule two copies of one author's reading agree about. Three of them
had no case at all — only a sentence in SPEC.md and the tests here — and §10.2,
the table of one requirement and one owner per row, carried no column saying
where a row's answer could be checked: a row backed by a committed artifact and a
row backed by prose looked the same. All three are cases now, every row of §10.2
### The fuzzer: not built

The decision is **no**, and it rests on the measurement rather than on taste. After
the three families above were settled, the same sweep finds nothing: 0 disagreements
in the 1301 structured mutations, and 0 in each of two runs of 600 random multi-byte
mutations over the same records. That is not an accident of the sample: the class the
recommendation named — *a two-byte change that preserves self-consistency* — is the
class where the two implementations already agree, and that was measured before
anything was built. Four such mutations were built by hand and all four agreed: a
name length moved into the extra length so the data offset is unchanged, a byte moved
from one entry's data into the next entry's, a bit set in both flag words, and an
extra field carried with its declaration honest. What the sweep did find, it found in
the first thousand mutations and in one shape per family, and every one of those is
now an artifact with a recorded answer — which is the thing the corpus is for and the
thing a fuzzer cannot produce. A generator whose queue is empty is a tool a reader
has to trust without evidence.

One disagreement the sweep found was named and left open here, and it is not in the
container at all: replace the first byte of `created_at`'s value in `manifest.json`
with a newline and the bytes `2026-01-01T00:00:00Z` stand where a value belongs. The
reference reported `L0.MANIFEST.PARSE`=NON_INTEGER_NUMBER ("2026-01-01 is not a
canonical integer") and the port reported MALFORMED ("an object holds '-' where ','
or '}' was due"). §4's integer rule reports `01` as NON_INTEGER_NUMBER and said
nothing about which characters a malformed number runs to, so this was a silence in
§4 rather than a container question, and its case belongs in the differential probe —
whose builder refused to record a case the two disagreed about, which is why there
was no probe case here. **The next pass settled it**, and it moved the port: §4 now
says a number token runs to the first character that cannot occur in one, and the
probe holds `created-at-value-opens-a-number` with the recorded answer. The section
at the head of this file, *A number token ends where the format says it ends*, has
the rule.

### The first user

Part three of the brief was the one that does not happen in this file. The editor is
ready to be handed over (`npm run editor`), the one sentence it needs is written
down, and the session itself needs a person who is not a developer, has one document
they need a stranger to be able to check, and has no interest in reading a spec. No
such session has been run for this pass, and none is recorded as if it had been: the
protocol, the three things to watch for, and the one question to ask are in
[`docs/first-user.md`](docs/first-user.md), which is where the verbatim record goes
the moment the session happens. The rule the brief sets out is kept: nothing about
the editor was changed to make the session easier.

### What did not move

- **No kit artifact, and no recorded kit answer.** `vectors/out/` and
  `vectors/expected.json` are byte-for-byte what they were, and the 54 verdicts are
  the ones they were. The probe's 26 cases and answers are untouched as well.
- **No format identifier.** `manifest.format` is still `charter/0.1`. The sections
  this pass touched are §3, §10.1, §10.2 and §10.3, and §14 is not among them.
- **No new reason code, and no new check.** Both readers were fixed to the codes the
  vocabulary already carried, and the two implementation changes that are not
  one-line are in the port: `walk` reads the directory in two passes, and
  `check_sizes` and `check_crc32` keep measuring the entries they can read.
- **The corpus grew and changed no earlier answer.** All 26 of the first pass's cases
  still carry the same two answers, `agreement: true`, and the invariant both
  `test/corpus.test.js` and `tests/test_corpus.py` assert — zero recorded
  disagreements — holds over all 34.

## Unreleased — the corpus, and the three readings that were only prose

This pass asks one question of the repository rather than of the format: **which
of the rules stated here can a stranger check?** A rule held by this project's
own tests is a rule two copies of one author's reading agree about. Three of them
had no case at all — only a sentence in SPEC.md and the tests here — and §10.2,
the table of one requirement and one owner per row, carried no column saying
where a row's answer could be checked: a row backed by a committed artifact and a
row backed by prose looked the same. All three are cases now, every row of §10.2
names the cases that settle it, and the third thing in this pass went one level
below every case the repository had: the container's bytes.

### Three readings that only prose held, and are fixtures now

§5 and §7 settled three questions that the kit does not ask, and until this pass
the only thing that decided them was the sentence in the document plus the tests
here. Each is now an artifact with both implementations' answers recorded:

- **`manifest-empty-format`** — `format` is `""`. §5's third case: a string that
  is not `charter/0.1` is a version this verifier does not implement, so
  `L0.FORMAT.IDENTIFIER` reports `UNSUPPORTED_VERSION` and the verdict is
  `INCOMPLETE`. Not `MALFORMED`, and not a `FIELDS` complaint: the value is a
  string, and what is wrong with it is that nobody implemented it.
- **`manifest-empty-key-id`** — `author.key_id` is `""`. `L0.MANIFEST.FIELDS`
  reports `MALFORMED`, because this is the one field in the manifest whose
  requirement no other check can carry — nothing else reads a key id — which is
  the clause §10.2's two `FIELDS` rows exist to make visible.
- **`log-first-parent-nonnull`** — the first entry's `parent` is a valid digest
  where the format requires `null`. `L2.CHAIN.FIRST_PARENT_NULL` reports
  `MISMATCH`. It is not `L2.CHAIN.LINKS`' value, and the case says so in the
  record rather than assuming it: the chain in this fixture was rebuilt so that
  `LINKS` *passes* and only the first-parent rule fails. A fixture where both
  fail would have settled nothing.

Both implementations answered all three the way §5 and §7 say on the first run,
which is the whole result: **no implementation moved for this pass.** What moved
is what a stranger can now check. `node vectors/probe/run.js` asks the three, and
`test/probe.test.js` asserts each of them by name — including that the third one
leaves `L2.CHAIN.LINKS` alone.

### The column that says what settles each row

§10.2 is 30 rows: what each check requires, and the value it owns. It had no
column saying where the row's answer can be *checked*, and a reader had no way to
tell a row backed by a committed artifact from a row backed by a sentence. It has
one now — `| Settled by |` — and every value in it is a case that exists:

| Kind | Where | Rows |
| --- | --- | --- |
| `fixture` | `vectors/out/`, replayed by `vectors/run.js` | 25 |
| `probe` | `vectors/probe/`, replayed by `vectors/probe/run.js` | 16 |
| `corpus` | `vectors/container/`, replayed by `vectors/container/run.js` | 6 |
| prose | — | 0 |

The numbers are larger than 30 because rows have faces rather than answers:
`L0.ZIP.READABLE` has a file that is not a container at all and a file that is
one disk of a set, and each face names a case. §10.3 states the totals and the
rule behind them; `test/spec.test.js` holds the column to the records it names,
in both directions — a case named in the table that is not in the record it
names fails, and so does a row that names nothing. It was proven by changing a
tally and watching it fail, then reverting.

One rule in this document still cannot be a row, and it is worth saying why. *A
requirement has exactly one owner* is the head of §10, and it is a property of
the table rather than a requirement about a file: no single input demonstrates
it. Its observable form is the cases the two `FIELDS` rows cite — a verdict in
which FIELDS fails and every check that would read the value is SKIP — and those
are cases like any other.

### The container corpus: eleven disagreements on its first run

Every artifact in the kit and in the probe is a JSON *document* inside a
container, and every check they exercise reads a field. Neither can reach the
container's byte arithmetic, because "this entry's declared compressed size is
one byte more than the bytes that follow it" is not a field — it is an offset.
`vectors/container/` is 26 hand-written mutations of `vectors/out/valid.charter`,
one change each, with both implementations' answers recorded:
`python tools/corpus.py --build` writes them, `--check` rebuilds every artifact in
memory and refuses one that is not the file its mutation makes, and
`node vectors/container/run.js` asks both implementations.

**Eleven of the 26 disagreed on the first run**, and this port was the
implementation at fault in ten of them. The list, case by case, is in
[`vectors/container/README.md`](vectors/container/README.md) and in
`implementations/python/README.md`; the shape of it is:

- **The two flag words were never compared.** A file with `0x0002` set in one
  header and not the other came back `VERIFIED` from the port. A reader that
  cannot agree with itself about flags cannot decode anything, so §3.3 makes this
  a refusal at `L0.ZIP.READABLE` with reason `MISMATCH`, and that is what both
  implementations report now.
- **`MALFORMED` where the file makes two claims about one fact, and `EXTRA` where
  two ranges claim the same bytes.** Two records naming one local header is two
  claims about the same bytes, and the port called it `MALFORMED` in one case and
  `EXTRA` in another. §3.1 now draws the first line — bytes that are not the shape
  the format requires, versus two well-formed claims where one is false — and
  §3.4 the second: a gap between ranges is bytes nothing accounts for (`EXTRA`),
  and an overlap is two claims about the same bytes (`MISMATCH`). §3.4 had defined
  only `EXTRA`, and the port reported it for both.
- **Three numbers the format fixes that the port read and never compared** — the
  directory's declared size (a byte a forged file could change for free), and the
  end record's ZIP64 markers and disk count, which the port turned into a failure
  where §3.2 makes them an archive this reader will not interpret. Those two
  verdicts are `INCOMPLETE` with `UNSUPPORTED_VERSION` and `UNSUPPORTED_FEATURE`,
  never `BROKEN`.
- **One reason code for a feature level above 2.0** — `UNSUPPORTED_FEATURE` where
  §3.2's voice is `UNSUPPORTED_VERSION`, the same code a ZIP64 end record
  carries. The same edit removed the port's reading of a bare `0xFFFFFFFF` size
  field as ZIP64; that is a ceiling, which is §3.7's to report.
- **The local copy of a size and a CRC-32, measured in the checks that own the
  value.** §3.5: `L0.ZIP.SIZES` and `L0.ZIP.CRC32` read the central directory's
  copy, and the local copy is `L0.ZIP.METADATA`'s to compare. One edited header
  was being reported twice, and the second report was not the size check's to make:
  §10.2 gives each value one owner, and what a reader gets from a second one is a
  defect that looks like two.

**The reference was wrong once**, and it is the one to read twice:
`entry-central-order-swapped` writes the directory's records in a different order
than the body — which is what a writer that sorts its records by name produces,
and is not a defect. The reference's layout walk took the directory's order for
the file's and read the first record's offset as a gap: `BROKEN` where the port
said `VERIFIED`. §3.4 now says the layout rule is a property of the byte ranges
and that the ranges are walked in file order, which is what `verifier/zip.js`
does.

Every one of the eleven was settled the same way — read the ZIP specification,
read §3, amend §3 where it was silent **and then** fix whichever implementation
was wrong — so §3.1 through §3.5 and §3.7 changed, `verifier/zip.js` and
`charter_verify/{container,checks}.py` changed, and all 26 agree now.
`tests/test_corpus.py` and `test/corpus.test.js` hold that as an invariant: the
number of cases with `agreement: false` is asserted to be zero, so a corpus that
has grown a new divergence fails the suite rather than quietly becoming a record
of one. The replay itself fails only when an implementation has *moved* — a case
that still reads two ways is reported as a finding, with both answers side by
side, which is the shape the next disagreement will arrive in.

### What did not move

- **No kit artifact was rebuilt.** `vectors/out/` and `vectors/expected.json` are
  byte-for-byte what they were, and the 54 recorded verdicts are the ones they
  were.
- **No format identifier moved.** `manifest.format` is still `charter/0.1`, and
  the sections this pass touched are §3, §10.2 and §10.3. §14 — what changes a
  version — is not among them, and `git diff -U0 -- SPEC.md` stops before it.
- **The probe's record gained three cases and changed none.** Nothing recorded
  before this pass has a different answer, so no earlier finding was re-settled
  by re-recording one, and the probe's build-time refusal (added in the pass
  below) still holds: the builder writes nothing when the two implementations
  disagree about a case.
- **Silence was not mistaken for agreement.** The corpus is a finding tool rather
  than a kit on purpose: its record is evidence, and its failures are about
  movement. Every case that agreed on the first run says so in its own `note` —
  including the ones where the agreement *is* the finding, like
  `entry-order-reordered`, which settled that the format fixes the order of the
  kinds of thing rather than the order of the entries.

## Unreleased — the spec, before anyone else reads it

Ten findings from the two passes before this one are settled in
[SPEC.md](SPEC.md), and exactly one of them changed a reason code. The version
string is still `charter/0.1`, no artifact in `vectors/` is a different file than
it was, the 54 recorded verdicts are the ones they were, and both implementations
still replay 54 of 54 — and every case in the probe, which this section grew from
20 to 23 and the pass above carried on to 26. What changed is what the document
says about the ten places a third implementer would otherwise have had to guess,
and that is the point of doing it now: a third implementation written against an
ambiguous rule freezes the ambiguity.

### The last of the residuals: a field that measures a string nobody has read

Three times now the same shape has appeared, and this pass is where it stopped
being a coincidence. A reader — `L0.MANIFEST.FIELDS`, `L0.PROVENANCE.FIELDS` —
measured a string that the check *reading* the value owns: an uppercase digest
under FIELDS, then an absent `content_sha256` reported as a second spelling, and
now three more. The first two were found by hand. The third family was found by
asking systematically — every field of both documents, rewritten eleven ways each,
with both implementations asked about all 212 of them — which turned up 40
disagreements in eight families, a great many for two programs that had already
replayed 54 fixtures and the 20 probes that existed then without a difference.

Three families were the *reference*:

- an empty `content_sha256`, an empty signature and an empty public key are
  strings, so FIELDS has nothing to say about them — 5 of the 212 cases. The
  reference measured emptiness in the field specs (`non_empty`) and reported
  `MALFORMED` from FIELDS, which took the complaint away from the check that reads
  the value and skipped the seven checks that had an answer;
- a `parent` that is not 64 lowercase hex characters was measured where it is
  *declared* (a `hex_or_null` field spec) instead of where it is *read* — 8 cases,
  because a parent can be short, empty, uppercase, padded or a character outside
  the alphabet, and the first entry's parent is a different check's. A parent in
  uppercase was a malformed field rather than a second spelling of a digest, and
  §5 names that case in so many words;
- `format` holding `""` was `MALFORMED` — 1 case, where §5's own three cases make
  it the third: `""` is a string, and a string that is not `"charter/0.1"` is a
  version this verifier does not implement.

Four families were this port's, which is the other half of what a differential
harness is for:

- `base64url.decode` answered `MALFORMED` for a character outside the alphabet and
  for a length no byte string is spelled with. §5's rule is "the string is not the
  one spelling this format fixes for that value, whatever the reason it is not",
  and this port's README stated that rule two sections above the code that did not
  follow it;
- `"rsa"` for `author.algorithm` and `"delete"` for an entry's `action` were
  `MALFORMED`; §5 says a value this version does not define is "reported as a field
  value it does not define", which is `UNKNOWN_FIELD`;
- a `content_sha256` that is not a string at all was reported by
  `L0.PROVENANCE.CONTENT_HASH_FORMAT` as a spelling problem, where §5's second
  paragraph makes "it is not a string" `MALFORMED`;
- an empty `key_id` passed the field rules and was compared against the derived
  key, so one defect arrived as four `MISMATCH`es instead of one `MALFORMED` from
  the check that owns the field's shape.

What the pass settled is a rule rather than a dozen fields: **a requirement has
exactly one owner.** It is the head of §10 now, §10.2 is that rule applied to all
30 checks — what each row requires and the value it owns — and §5, §7 and §8 say it
where the fields and the encodings are described. `test/schema.test.js` holds the
code to it: every kind the schema declares is exercised with a value it accepts and
one it refuses, the two readers use only declared kinds, no field whose string
another check reads carries `non_empty` or a spelling kind, and the fields that do
carry `non_empty` are exactly the fields no other check reads.

Three probes were added rather than one, because the finding is about a *family* of
fields and the fixture is the smallest artifact that shows it:
`log-line-empty-content-hash`, `log-line-empty-signature`, `log-line-bad-parent`.
The probe's builder also refuses a *second* thing now, and it is the change that
keeps this pass from happening again: it writes nothing when the reference and this
port disagree about a case, and says which case and which check. Recording either
of two answers would have filed a divergence as a settled answer, which is what the
first 20 probes were one `MISSING` away from doing. Both gates were proven by
breaking them on purpose and reverting: the probe's refusal by making this port
answer one case differently (it named the case and wrote nothing), and
`test/schema.test.js` by putting `non_empty: true` back on `content.sha256` and by
giving `parent` a spelling kind again (it failed both ways, with the sentence that
says why).

`git diff -- verifier/` for this pass is field specs, two owning checks and the
base64url reader: no check's logic changed, no artifact in `vectors/out/` is a
different file, and `node vectors/run.js` still replays 54 of 54 against the same
54 recorded answers — the probe is what grew, from 20 cases to 23, and `git diff`
on `vectors/probe/expected.json` is that file's note plus the three new cases.

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

