# The differential probe

Twenty-six artifacts the conformance kit does not hold, and the answers two
implementations give for them.

```
node vectors/probe/run.js      # ask both implementations, compare with the record
```

```
vectors/probe/expected.json    the artifacts' answers, recorded from the reference
vectors/probe/out/*.charter    the 26 artifacts
vectors/probe/run.js           the replay: reference, Python, and the record
```

`implementations/python/tools/probe.py` builds these — `--build` writes the
artifacts and the record, `--check` rebuilds every artifact in memory and refuses
if the one on disk is not the one the recipe makes. It is the author's program;
the replay above is the reader's.

## What it is for

The conformance kit is 54 artifacts with recorded answers. It is not the whole
format: a fixture can only ask about a rule somebody already thought of, and the
places where two implementations drift apart are exactly the places nobody wrote
down. So this probe asks the questions the kit does not: an integer with a
leading zero, four spellings of a string escape, a digest in uppercase, a public
key 31 bytes long, a base64url tail whose unused bits are not zero, a signature
with `=` padding, a log line that is not an object, a log line ending in CRLF, a
log line with a space in it, a nested field nobody defines in four places.

**It is how the findings in `implementations/python/README.md` were found.** That
run began at nine disagreements between the reference and the Python verifier and
ended at zero, and every change it forced was either a SPEC.md amendment or a
change in the port. Committing the harness and its fixtures is what turns that
claim from a sentence in a report into something a fresh clone can re-run:

- **An absent field is MISSING, and this is settled.** The probe
  `log-line-not-canonical` carries an entry with no digest field at all, and
  `L0.PROVENANCE.CONTENT_HASH_FORMAT` used to report `NON_CANONICAL_ENCODING` —
  whose definition is "a field encoding is not the canonical encoding of the value
  it carries" — while its own sentence said "entry 1's `content_sha256` is absent
  (MISSING)", and the vocabulary has a code for exactly that. Both implementations
  agreed, so this was never a divergence; it was the first finding that was a bug
  in the reference rather than a silence in the spec. It is settled in SPEC.md §5,
  §7 and §10: a field that is not there carries MISSING, from the check that asks
  whether it is present and from the check that reads it, and both implementations
  report it. The recorded answer for this case changed with it, and
  `implementations/python/tests/test_spec_gaps.py` freezes the answer.
- **A verdict whose title is outside the host's code page did not survive a
  pipe.** On Windows, with stdout redirected, Python encodes text with the
  console code page and raises on the first character outside it — so asking the
  port about `escape-surrogate-pair`, whose title is U+1F600, produced an empty
  verdict and a traceback. The reference writes UTF-8 through
  `process.stdout.write` and never noticed. The port's `cli.py` now writes UTF-8
  explicitly, and `implementations/python/tests/test_cli.py` holds it there. No
  fixture in the kit reaches it: all 54 titles are ASCII.
- **A field measured a string that the check reading the value owns.** Three
  cases, added in step 7: an entry whose `content_sha256` is `""`, one whose
  signature is `""`, and one whose `parent` is the digest of the line before it in
  uppercase. All three are strings, so `L0.PROVENANCE.FIELDS` has nothing to say
  about them, and the reference said `MALFORMED` anyway — one FAIL where the
  format has two sentences, and seven checks skipped that had an answer. The rule
  they are the test of is now the head of SPEC.md §10 ("a requirement has exactly
  one owner"), §10.2 is that rule applied to all 30 checks, and the same pass
  found 23 more cases of it by sweeping every field of both documents eleven ways
  (`implementations/python/tools/sweep.py`). `--build` now refuses to write the
  record when the reference and the port disagree about any case, so a case like
  these cannot be recorded as an answer before it is settled.

The second is a bug in a program, which is the other thing a differential harness
is for. The first changed one recorded answer — a reason code, in a fixture whose
bytes are the same bytes they were — and no artifact in the kit or here is a
different file than it was. The third added three artifacts and changed no
existing record: `--build` was re-run for it, and `git diff` on `expected.json` is
the note above plus the three new cases, nothing else.

Three more cases were added after that, and they are the opposite of a finding:
each of them is a reading the one-owner rule had already settled — an empty
`format`, an empty `author.key_id`, and a first entry whose `parent` is a valid
digest where `null` is required — and both implementations agreed about all three
the moment they were asked. They are here because agreement between two
implementations is not the same thing as a rule a stranger can check: these three
were written down in SPEC.md, applied by §10.2's table, and held by this
repository's own tests, which is exactly the shape §10.2's new `settled by`
column was added to expose. `git diff` on the record for that pass is the three
cases and nothing else, and §10.2 no longer has a row that says `prose`. The third
case is worth reading in the record rather than at a glance: its fixture replaces
the first line's `parent` and recomputes the second line's digest over the first
line as it now stands, so `L2.CHAIN.LINKS` passes and the first-parent rule is the
only requirement under test — but the entries' signatures are not recomputed, so
`L1.PROVENANCE.SIGNATURES` reports them stale alongside it. That is a second
defect and not part of the question, which is why `asked` names the one failure the
case is about and the one check that has to pass, and `expected` is the whole
verdict.

## Running it, and what it needs

The replay needs **Node**, which is running it, and it uses the **Python
interpreter** if this machine has one (`python`, `python3` or `py`). A machine
without one is not a failure: the Python leg is skipped, the summary says so in
as many words, and the exit code stays 0. The reference leg always runs, because
the record's answers are the reference's.

The builder needs Node, because it records the reference's answers by running it
as a black box (`node cli/charter.js verify <file> --json`). `--check` needs
neither runtime.

```
node vectors/probe/run.js                                   the replay
python implementations/python/tools/probe.py --check        fixtures against recipes
python implementations/python/tools/probe.py --build        rebuild the record
```

## What is compared

The five things the conformance kit compares, and nothing else: the verdict, the
exit code, the failing checks with their reason codes, the unsupported checks
with theirs, and the number of checks that were never reached. Prose is not
compared, because SPEC.md 10 allows a detail to be reworded between releases
while a reason code may not — the two sentences in the absent-digest finding
above are what that rule looks like when it is exercised.

Each artifact's length and SHA-256 are checked first, so "this file is not the
one the record describes" and "this answer is wrong" stay two different claims,
which is the same discipline `vectors/run.js` follows for the kit.

## Each case carries the question it asks

`expected.json` holds, per case, the question (`asked`: a verdict, the checks that
have to report the defect for the case to be the case it says it is, and — where
the question is "which check owns this value?" — the checks that have to *pass*)
and the answer (`expected`). The builder refuses to write the record twice over:
when the reference's answer contradicts a question, and when the *port* answers a
case differently from the reference. Either way it says which case and which
check. An artifact whose recorded answer is not the answer the format requires is
a broken fixture rather than a finding, and a case the two implementations do not
agree about *is* the finding — both have to be settled in SPEC.md rather than
papered over by overwriting a record with one of the two answers.

Twenty-two of the twenty-six questions were derived from SPEC.md alone and every
one of them was confirmed by the reference. Four took a change to the reference
or to the port for the recorded answer to be the answer the format requires — the
absent-digest case and the three cases of a field measuring a string another
check reads — which is what the probe is for: it asked the question in the spec's
words and the two answers did not match. The three cases added last agreed from
the first run, and they are in the record for a different reason — see the section
above. The list of what each case asks and why is in
`implementations/python/tools/probe.py`, above the case.
