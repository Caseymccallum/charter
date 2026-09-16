# Charter

`.charter` is a local-first document format: one file that carries a document,
the edit history of that document, and the signature of whoever wrote both, in a
form a stranger can check without trusting the author, a server, or a clock.

This repository is the **verifier first**. It contains a pure verifier, a
conformance kit, a command line, and the tests that hold all three together.
There is no producer, editor, or app yet, and that order is deliberate: a
producer is easy to write once a verifier refuses forged files correctly, and
worthless before.

The format is specified in [SPEC.md](SPEC.md). The verifier is `verifier/**`;
everything else exists to feed it bytes or to check it.

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

No installation, no build step, no dependencies. **Node 20.12 or later**, and
nothing outside the standard library. The floor is where the two runtime
facilities the verifier needs both exist: WebCrypto Ed25519 (Node 20.0) and
`DecompressionStream('deflate-raw')` (Node 20.12). On an older runtime the
verifier does not throw and does not guess: it reports `UNSUPPORTED_FEATURE` for
every check it cannot perform, which is a verdict of `INCOMPLETE`, never a pass.

## Try it on the kit

```
node vectors/run.js     # replay 26 artifacts against 26 recorded answers
npm test                # the 47 tests, through node --test
```

`vectors/run.js` is written for a reader, not for the author: it reads
`vectors/expected.json`, reads the artifacts the record names, and asks the
verifier for a verdict. If the bytes on disk are not the bytes the record
describes, it says so instead of quietly agreeing.

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
| A producer or editor | the verifier has to refuse forged files before one is worth writing |
| Network access, in the verifier or the CLI | a verdict that depends on a server is not checkable offline |
| Key generation, storage, or lookup | keys belong to the user's own tools, not to this repository |
| Encryption | ZIP is not a confidentiality mechanism; a charter's size is visible and the format does not pretend otherwise |
| Revocation, transparency logs, timestamp authorities | these belong above the format; a charter is a self-contained file |
| Markdown parsing or normalization | the bytes of `content.md` are the content; the verifier never rewrites them |
| Any dependency, including a JSON parser | the canonical JSON rules this format needs (no duplicate keys, integers only, no unpaired surrogates) are stricter than `JSON.parse` |
| Guessing at anything | an unimplemented feature is UNSUPPORTED and an unrun check is SKIP, and neither is ever a pass |

## Repository layout

| Path | What it is |
| --- | --- |
| `SPEC.md` | the format, and why each rule exists |
| `verifier/` | the pure verifier: bytes in, verdict out. No clock, no disk, no network, no `node:` imports |
| `cli/charter.js` | the only file in the project that reads a file, and the only place a verdict becomes text |
| `vectors/` | the conformance kit: an independent builder, 26 artifacts, the recorded answers, and the replay |
| `test/` | 47 tests, including `purity.test.js`, which enforces that the verifier stays pure |
| `NAMING.md` | what the words in this project mean, and which ones are avoided |

## Development

```
npm test          # node --test: discovers test/*.test.js and runs all 47
npm run kit       # replay the conformance kit
npm run kit:build # rebuild the kit's artifacts (the author's program)
```

`vectors/build.js` shares no code with `verifier/**`. It writes the canonical
JSON and the ZIP bytes from SPEC.md with its own writer, and takes hashing and
signing from `node:crypto`. If two independently written implementations agree
that a byte sequence is the canonical form of a value, that agreement is
evidence about the format; two copies of one bug would be evidence about
nothing.

`.gitattributes` marks every artifact as not-text, so no checkout can rewrite a
line ending inside one: the kit's answers are recorded against a digest of each
file, and `vectors/run.js` is the program that would catch it if anything did.

Publishing is plain `git push`; nothing here needs the `gh` CLI or any other
tool that has to be installed first.

## License

MIT. See [LICENSE](LICENSE).
