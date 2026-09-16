# Charter

`.charter` is a local-first document format: one file that carries a document,
the edit history of that document, and the signature of whoever wrote both, in a
form a stranger can check without trusting the author, a server, or a clock.

This repository is the **verifier first**. It contains a pure verifier, a
conformance kit, a command line, and the tests that hold all three together.
That order was deliberate — a producer is easy to write once a verifier refuses
forged files correctly, and worthless before — and it is now the history of the
project rather than its state: `producer/**` seals documents, and it exists
because the verifier does.

The asymmetry is the point. The verifier may not read a file, a clock, or a
random source, and may import nothing outside `verifier/**`; the producer may
load a key and is the reference implementation of everything the verifier
refuses when it is wrong. Where the two must not be allowed to disagree, they
share code: the producer writes the canonical bytes with the verifier's own
serializer and derives a key id with the verifier's own derivation.

The format is specified in [SPEC.md](SPEC.md). The verifier is `verifier/**`,
the producer is `producer/**`, and everything else exists to feed the verifier
bytes or to check it.

## Verify a file

```
node cli/charter.js verify path/to/file.charter        # the verdict, and what did not pass
node cli/charter.js verify path/to/file.charter --all  # every check, including the ones that passed
node cli/charter.js verify path/to/file.charter --json # the verdict as JSON, and nothing else
```

Exit codes: `0` VERIFIED, `1` INCOMPLETE (nothing failed, but something was not
established), `2` BROKEN (something failed), `64` the command line was not
understood, `66` the file could not be read. Only `0` is a pass, and only `0`
means every requirement was actually established.

## Seal a document

```
charter keygen -o key.pem                           # an Ed25519 key, PKCS#8 PEM
charter seal notes.md --key key.pem -o notes.charter
charter verify notes.charter                        # VERIFIED, exit 0, or what failed
charter inspect notes.charter                       # what the file claims, and no verdict
charter cite notes.charter --accessed 2026-09-16    # CSL-JSON, for a reference manager
```

`seal` takes the document, the key, and where to write the artifact, and it also
takes `--title` (the title to record), `--author` (the signer's name),
`--created-at` (the time to record, `YYYY-MM-DDTHH:MM:SSZ`), `--now` (record the
current time), `--summary` (the first entry's summary), `--force` (overwrite an
existing output) and `--json`.

Two decisions about that command line are worth knowing before you use it:

- **A seal is deterministic.** The same content, key and arguments produce the
  same bytes on every run and on every machine, because nothing in the producer
  reads a clock, a file or a random source. `--now` is the one flag that reads a
  clock, and without it or `--created-at` the file states no time at all:
  `1980-01-01T00:00:00Z`, the same instant the container's fixed DOS stamp means.
  A record that says "no time stated" is honest; a record stamped with a time
  nobody chose is not.
- **The producer does not grade its own homework.** `seal` does not verify what
  it just wrote. The agreement between the two halves is asserted where it is
  evidence — in `test/producer.test.js`, which seals and then asks the verifier,
  through this same command line.

If you would rather make the key with your own tools,
`openssl genpkey -algorithm ed25519 -out key.pem` produces exactly the PKCS#8 PEM
that `--key` reads. `charter keygen` is here because that command assumes
`openssl` is installed, and it often is not.

`seal` refuses what it cannot write, and every refusal prints a reason code from
the same vocabulary a verdict prints: content that is not valid UTF-8
(`DECODE_ERROR`) or that begins with a byte order mark (`NON_CANONICAL`), a key
that is not Ed25519 (`UNSUPPORTED_FEATURE`), a key file that holds no key
(`MALFORMED`), a named file that is not there (`MISSING`, exit 66), an output
path that is already taken (`EXTRA`, exit 73), and a stated time that is not the
form the format fixes (`MALFORMED`, exit 65). The producer's exit codes are `0`
it did what it said, `64` the command line was not understood, `65` the input was
refused and has a reason code, `66` a named file could not be read, and `73` the
output file could not be created. They are not verdicts, and `verify`'s five
codes are unchanged.

`inspect` prints what a file claims — format, title, author, key id, declared
time, content digest, entry count — and says whether the declared format is one
this build implements. It never prints a verdict word: it answers "what is this
file?", and `verify` answers "is it true?". `cite` prints one CSL-JSON item and
nothing else. Its identifier is the claim hash, the SHA-256 of the document the
last entry was signed over, and the item records where its title came from:
`asserted` when `--title` was passed, `derived` when it was read out of the
captured document (a `<title>` element, or the first Markdown heading), and
`claimed` when it fell back to the manifest's own title. Times stated in the file
are the author's claims, and the citation says so.

No installation, no build step, no dependencies. **Node 20.12 or later**, and
nothing outside the standard library. The floor is where the two runtime
facilities the verifier needs both exist: WebCrypto Ed25519 (Node 20.0) and
`DecompressionStream('deflate-raw')` (Node 20.12). On an older runtime the
verifier does not throw and does not guess: it reports `UNSUPPORTED_FEATURE` for
every check it cannot perform, which is a verdict of `INCOMPLETE`, never a pass.

## Try it on the kit

```
node vectors/run.js     # replay 54 artifacts against 54 recorded answers
npm run probe           # 20 more artifacts, asked of two implementations
npm test                # the 126 tests, through node --test
npm run kit:python      # the same 54 answers, through a second implementation
npm run test:python     # 92 Python tests, including that replay
```

`vectors/run.js` is written for a reader, not for the author: it reads
`vectors/expected.json`, reads the artifacts the record names, and asks the
verifier for a verdict. If the bytes on disk are not the bytes the record
describes, it says so instead of quietly agreeing.

`vectors/probe/` is the same idea for the cases the kit does not contain: 20
artifacts built by hand — a leading-zero integer, four spellings of an escape, an
uppercase digest, a key of 31 bytes, a base64url tail whose unused bits are not
zero, a log line that is not an object, a CRLF line — asked of the reference and
of the Python implementation at once. It is the harness that found the findings
below (and, once committed, two more: see
[`vectors/probe/README.md`](vectors/probe/README.md)), and `npm run probe`
re-runs it. It needs Node; the Python leg is skipped, with a sentence saying so,
on a machine that has no interpreter.

`implementations/python/` is a second reading of the same spec, in Python, by a
reader who did not read `verifier/**` — no shared code and no shared crypto
library, canonical JSON and the ZIP walk and the Ed25519 arithmetic written out
again — and it replays the same 54 answers. Agreement between two readings is the
only evidence about a format that is not also evidence about one program; where
they disagreed, the spec was wrong or silent, and it was amended. What that found
is written down in
[`implementations/python/README.md`](implementations/python/README.md), and the
amendments are section 5, section 7, section 10.1, section 12.1 and section 16 of
[`SPEC.md`](SPEC.md).

28 of those 54 artifacts are the **adversarial pass**: every way a file can lie
that we could think of, written down in [`test/adversarial.md`](test/adversarial.md)
before it was run, with the verdict each one must produce and the observed
result beside it. Truncated containers, missing and duplicated entries, entries
that lie about their own encoding, manifests that are well-formed JSON but not
the canonical bytes, signatures computed over a different serialization, a
signature one byte short, a key id that does not derive from its key, a fork in
the chain, an entry removed from the middle — and two cases that are supposed to
come back `VERIFIED`, because the format genuinely cannot tell:
`history-rewritten` (the key holder re-signs everything) and
`entry-with-earlier-timestamp` (nothing witnesses time). A verifier that admits
what it cannot see is more trustworthy than one that claims to see everything.

## The editor

```
npm run editor     # serve this repository on loopback and open editor/index.html
```

`editor/` is a single static page that shows a `.charter` file's claim to someone
who is not going to read [SPEC.md](SPEC.md): drop a file on it and you get the
verdict, every check, the document it is about, the history, and the statements
of what a `VERIFIED` verdict does *not* mean — and then a write pane that seals
one, with the key you paste into it.

It is a **demonstration, not a product**, and that is the whole reason it exists:
the format's claim is easy to describe and hard to see, and a page that shows it
beside the document is the cheapest way to show it. It has no sync, no account,
no store, no key storage, no build step, no dependency, and no network request —
it imports the verifier and the writers out of `verifier/**`, which is why those
two writers live there rather than beside the producer, and `test/editor.test.js`
asserts all of that. A file sealed in the page and the same file sealed by
`charter seal` are the same bytes, and the test compares them.

It has to be opened over http rather than by double-clicking the file: browsers
refuse to load an ES module from a `file://` page, and the page is made of
modules. `npm run editor` is a courier for exactly that,
[`editor/README.md`](editor/README.md) says so in the browser's own words, and
`python -m http.server` works just as well.

## What is inside a `.charter` file

A ZIP archive with exactly three entries, and nothing else in the file at all:

| Entry | What it is |
| --- | --- |
| `manifest.json` | the format version, a title, a creation time, the digest of the content, the author's Ed25519 public key, and a signature over all of it |
| `content.md` | the document itself, as UTF-8 bytes |
| `provenance.jsonl` | one signed JSON object per line: who, when, what changed, a digest of the revision, and the SHA-256 of the previous line |

Each entry's `parent` is the hash of the line before it **as it stands in the
file**, trailing LF included, so the history is a chain of exact bytes rather
than a list of claims. The last entry's `content_sha256` is the digest of
`content.md`, which is what ties the history to the document you are reading.

## Three claims, and nothing more

A `VERIFIED` verdict means:

- these are the bytes of the document;
- these signatures were made by the key the file carries;
- this history is continuous with that document.

It does **not** mean the document is true, recent, or written by anyone in
particular. The verifier prints those limits with every verdict, and SPEC.md
section 11 states all of them: intermediate revisions cannot be re-checked, the
key holder can rewrite the whole log and re-sign it, a key travels inside the
file it signs, every timestamp is the signer's own claim, and the content is
never judged. Those are not gaps to be filled later; they are things no verifier
can decide from the artifact alone, and they are printed rather than guessed at.

## Deliberate absences

| Absent | Why |
| --- | --- |
| A server, an account, a sync engine | the format is the product; `editor/` is one static page that reads and seals a file, and it stores nothing |
| A store of keys, or a lookup for one | `keygen` writes one file and keeps nothing, and the editor holds a key in memory for as long as the page is open: a key belongs to whoever holds it |
| Network access, in the verifier or the CLI | a verdict that depends on a server is not checkable offline |
| Encryption | ZIP is not a confidentiality mechanism; a charter's size is visible and the format does not pretend otherwise |
| Revocation, transparency logs, timestamp authorities | these belong above the format; a charter is a self-contained file |
| Markdown parsing or normalization | the bytes of `content.md` are the content; the verifier never rewrites them, and the one thing read out of them is a title, reported as derived |
| Any dependency, including a JSON parser | the canonical JSON rules this format needs (no duplicate keys, integers only, no unpaired surrogates) are stricter than `JSON.parse`, and the producer writes through the verifier's own serializer rather than a second one |
| Guessing at anything | an unimplemented feature is UNSUPPORTED and an unrun check is SKIP, and neither is ever a pass |

## Repository layout

| Path | What it is |
| --- | --- |
| `SPEC.md` | the format, and why each rule exists |
| `verifier/` | the pure verifier: bytes in, verdict out. No clock, no disk, no network, no `node:` imports. It also holds the two writers a page may import — the canonical ZIP writer and the base64url encoder — which no module the reading path reaches can see |
| `producer/` | the reference implementation: writes the format, reads a file's claims, cites one. No clock, no disk, one `node:` import (`node:crypto`, for keys) |
| `editor/` | a demonstration, not a product: one static page that shows a file's claim and seals one, importing `verifier/**` and nothing else. `editor/serve.mjs` hands it to a browser |
| `cli/charter.js` | the only file in the project that reads or writes a file, and the only place a verdict or a refusal becomes text |
| `vectors/` | the conformance kit: an independent builder, 54 artifacts, the recorded answers, and the replay |
| `vectors/probe/` | the differential probe: 20 more artifacts, the answers the reference gives for them, and the replay that asks both implementations |
| `implementations/python/` | a second reading of the spec: a Python verifier with no shared code, no shared crypto and its own replay of the same 54 answers, plus what the exercise found |
| `test/` | 124 tests, including `purity.test.js` (the verifier stays pure, the serializer shares no code with the parser, and no writer is reachable from a verdict), `parser.fuzz.test.js` (no input throws), `canonical.roundtrip.test.js` (every committed artifact is a fixed point of the reader and the serializer, both directions), `adversarial.test.js` (the table in `adversarial.md` is a claim the tests check), `producer.test.js` (seal, then verify, then every way a sealed file can be made to lie), `probe.test.js` (the probe's record, replayed), and `editor.test.js` (the page's import graph, and the page itself in a headless browser). `test/corpus.js` is not a test file: it is the hostile-text corpus both fuzz suites are stated over, so `node --test` lists it and finds nothing in it. |
| `NAMING.md` | what the words in this project mean, and which ones are avoided |

## Development

```
npm test          # node --test: discovers test/*.test.js and runs all 124
npm run kit       # replay the conformance kit
npm run kit:build # rebuild the kit's artifacts (the author's program)
npm run probe     # ask the reference and the Python port about 20 hand-built artifacts
npm run seal      # the producer's verbs: seal, inspect, cite, keygen
npm run editor    # serve the repository and open the editor
npm run kit:python  # replay the same kit with the Python verifier
npm run test:python # the Python port's 92 tests
```

`vectors/build.js` shares no code with `verifier/**`. It writes the canonical
JSON and the ZIP bytes from SPEC.md with its own writer, and takes hashing and
signing from `node:crypto`. If two independently written implementations agree
that a byte sequence is the canonical form of a value, that agreement is
evidence about the format; two copies of one bug would be evidence about
nothing.

`producer/**` is the opposite arrangement, on purpose. It is not a second
opinion about the format: it is the writing half of it, so wherever the two
halves could disagree it calls the verifier's own code — `canonicalDocument` and
`signingInput` for the bytes a signature covers, `deriveKeyId` for the name of a
key, the reader's timestamp rule, the reader's CRC-32, the reader's entry names
and actions. The producer has no private writer, no private reason codes, and no
private vocabulary for anything the format defines, and `test/producer.test.js`
asserts that the whole directory reads nothing but a key from outside a byte
array.

`.gitattributes` marks every artifact as not-text, so no checkout can rewrite a
line ending inside one: the kit's answers are recorded against a digest of each
file, and `vectors/run.js` is the program that would catch it if anything did.

Publishing is plain `git push`; nothing here needs the `gh` CLI or any other
tool that has to be installed first.

## License

MIT. See [LICENSE](LICENSE).
