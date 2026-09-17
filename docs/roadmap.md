# The road from here

Written because "push it further" needs a definition, and the wrong one would undo
the work. The format is complete; the verification is extensive; what is not
finished is the **last mile** — the distance between a file that verifies and a
person who can use the thing they were sent.

The numbers in this file are *targets*, not counts of the tree. Nothing here is a
claim about the present, so there is nothing to read back off the disk.

## The finding that defines this work

**There is no way to get the document out of a `.charter` file.**

- `verify` prints a verdict and checks. `inspect` prints what the file *claims*.
  `cite` prints CSL-JSON. `seal` and `edit` take Markdown *in*.
- `content.md` appears in `cli/charter.js` only in help text and doc comments. No
  verb writes it to a file.
- The editor shows the document in a `<pre>` and cannot save it.

Today the only way to read the document you were sent is to unzip the container with
a tool that checks nothing — `unzip notes.charter content.md`. That inverts the
project's central claim. Every sentence in the README says a stranger can check the
bytes *without trusting the author, a server, or a clock*; the practical instructions
say that to read the bytes you must bypass the only reader in the project that checks
anything. The format is not missing a feature here. **It is missing the end of its
own sentence.**

This is Phase 1, and it is the reason this document exists.

**How that was checked, on a file this project sealed.** A 40-byte Markdown document
whose only body sentence is `Revenue was flat.` was sealed with `charter seal`. Then:

| Question | Answer |
| --- | --- |
| Is the body in the file? | Yes. `content.md`, 40 bytes, read out with the operating system's own ZIP reader |
| Does `verify --all` print it? | No — 139 lines of output, and the sentence is in none of them |
| Does `inspect` print it? | No |
| Does `cite` print it? | No |

The *title* does travel, as a manifest claim: `verify` prints `title Quarterly Review`.
So the file's claims are readable and the file's content is not. The only command that
produced the body was a ZIP reader that checks nothing, which is the problem stated
exactly: to read the document, you must leave the verifier.

## What "whole" means, and what it does not

Three of the four things below finish a sentence the project already started. One is
new surface, and it is deliberately last.

| | Missing | Which claim it finishes |
| --- | --- | --- |
| 1a | extract the document | "one file carries the document — and you can check it" |
| 1b | append a revision in the editor | "the history is in the file" — the page writes entry one and stops |
| 1c | install the command | "no installation" is true of the *verifier*; the producer has no path at all |
| 2 | a key at rest | `keygen` writes an unencrypted PKCS#8 PEM; nothing in the format or the tools asks otherwise |

## Phase 1 — the last mile

**1a. `charter open <file.charter> [-o <out.md>] [--force]` — done.** It writes the bytes
of `content.md` that this format's own reader read, so what comes out is the content
of a file this project checked rather than a third-party unzip of it. The document
goes to standard output unless `-o` names a file; the verdict goes to standard error,
so a pipe carries bytes and nothing else.

- Touches `SPEC.md` §12: **yes, and it would not let us skip it** — §12's verb table
  is a listed claim, and `test/spec.test.js` asserts the verbs §12 shows are the verbs
  the command line dispatches. The suite failed until the spec was edited, and it
  failed again until `cli.test.js` gained a row for the new verb. That is the
  mechanism working as designed, and it is why this change could not be made quietly.
- Format identifier: **unchanged.** A verb is not a file.
- New tests: yes — five in `test/cli.test.js`: the round trip (seal a document, open
  it, compare the bytes), the standard-output route, a tampered document still coming
  out, the refusal to overwrite without `--force`, and the two files it will not call
  a document.
- New registry rows: **none.** This file predicted "likely one"; the prediction was
  wrong, because nothing new is exported from `verifier/**`. It is left here rather
  than deleted, since a document that quietly corrects itself is the failure mode the
  whole audit exists to catch.
- Corpus / probe: **unchanged** — both are about artifacts, not commands.

**1b. The editor appends a revision — done, and the read pane hands the document
over.** The page seals and could not edit; it showed the document and could not save
it. Both gaps are closed, and neither is a new implementation of anything: the page
imports the writers that already live in `verifier/**`, and assembles an entry and a
manifest exactly as `producer/edit.js` does — the duplication that a browser's import
rules force, which is why the proof is byte-for-byte rather than structural.

- Touches `SPEC.md`: **no** — §15.6 already specifies `edit`, and §6 already says the
  bytes are the content, which is what the save button hands over.
- New tests: two in `test/editor.test.js`, both byte-for-byte against the command
  line: the saved document against `charter open`, and the appended revision against
  `charter edit`. The append test also asks for a second key and requires `MISMATCH`.
- New registry rows: **none**, again — nothing new is exported from `verifier/**`.
- One consequence: `docs/first-user.md` states the editor page's byte size and
  `counts.test.js` holds it to the file, so growing the page made that number false
  and it had to be corrected. Recorded here rather than done quietly.

**1c. A path to an installed command — done, and the name is decided.** The package
is `charter-cli`, the command it installs is `charter`, and `bin` is what connects
those two names — so the verb did not have to be renamed for a registry. `charter`
on npm is held by an unrelated, abandoned package, so it was unavailable and always
will be; `NAMING.md` records that check and the rejections.

- **Two installs, and one of them needs no decision:** `npm install -g
  github:Caseymccallum/charter` works today, from this repository, with no registry
  account. Publishing under `charter-cli` is the author's step and is not taken here.
- **`files` is the substance of it.** Without the allowlist a publish ships the
  whole repository: 255 files, 2.4 MB, including `test/`, `vectors/`,
  `implementations/` and `docs/`. With it: 30 files, 388 kB unpacked, 109 kB packed
  — `cli/`, `producer/`, `verifier/`, `SPEC.md`, and the README and LICENSE npm adds
  by itself.
- `private: true` is gone, and `repository`, `homepage`, `bugs` and `keywords` are
  filled in, because a published package with no source link is a dead end.
- Touches the format: **no.**
- Proved by installing it: into a throwaway prefix, then running `keygen`, `seal`,
  `edit`, `verify`, `open` and `inspect` with the installed command from a directory
  outside the repository, and comparing the document that came back out with the one
  that went in. The git-URL install was run too, and verified an artifact.

## Phase 2 — the artifact in a user's hands

**A key with a passphrase — done.** `keygen --encrypt` writes a private key behind a
passphrase, and `seal` and `edit` open one. SPEC.md §15.7 is the format,
`producer/keyfile.js` is the implementation, and `test/keyfile.test.js` holds the two
together. The editor refuses a protected key by name, because a browser takes no
passphrase for a key import and a second key derivation for one format is the thing
this project's tests exist to prevent.

**This file predicted that Node's own `crypto` would do the job — "a PKCS#8 PEM can be
encrypted on export and decrypted on read" — and that was wrong.** Measured before it
was rejected: Node writes scrypt at **N=2048** (2 MiB, 7.4 ms, about 135 guesses per
second per core); it **reads `iterations` and ignores it**; its cipher is
**AES-256-CBC with no MAC**, so a modified ciphertext is not detected at all; and
`aes-256-gcm` is refused through that API. Since the cost of a guess is the entire
defence of a passphrase-wrapped key, the container is written here instead — the same
argument that already put a ZIP writer in `verifier/zip-write.js`.

- Touches the format: **no** — a key file is not an artifact, and no `.charter` field,
  rule, limit or verdict moved.
- Touches `SPEC.md`: **yes**, and not where this file guessed. §15.1 describes what
  `seal` writes, not what `keygen` writes; the key file needed a section of its own,
  §15.7, because a format the project tells a reader to rely on has to be a format it
  writes down. §12's keygen line and §15.5's refusals moved with it.
- The honest caveat, written down in the README and in the tool's own output: an
  attacker who has the file can guess at it forever offline, so **the passphrase's
  length is the whole of the protection** and everything else is arithmetic.
- The lesson came from `C:\Users\Casey\Web Apps\plain-forms`, whose own audit records a
  stored salt plus a known-plaintext verification token as an offline brute-force
  oracle whose zero-knowledge claim is "contingent on passphrase strength".

## Phase 3 — the audience, and the surface other programs use

**The surface other programs use — done.** `package.json` had no entry point at all: a
bare `import 'charter-cli'` failed (measured against a real install), so the only way in
was to deep-import `charter-cli/verifier/verify.js`, which is a promise about nothing.
Now there are two documented entry points — `charter-cli` for reading, pure and
browser-safe, and `charter-cli/producer` for writing, Node-only — and
`test/api.test.js` holds both to the table in `README.md`, reading the table from there
rather than keeping a copy.

That is the enabling work for everything below it, and it is why this came before the
integrations rather than after.

**The plan for the rest is `docs/reach.md`**, which answers two questions this file
should not answer twice. Whether to fork another product's interface: **no**, and the
reason is the property it would spend. What to do instead: **integrations**, because a
format's reach comes from other people's interfaces and not from ours.

## Phase 3 — the audience, and only after 1 and 2

For the archives and preservation audience — the one with a real need for a portable,
offline-checkable container of a document and its custody — the thing that matters is
a **collection**: many files, one report, and a record that can be filed. `verify`
takes one file.

That is the fifth verb nobody has asked for yet. Building it before a single archivist
has said what their report must contain would be guessing at requirements with a
specification in hand — the specific mistake this project has avoided for
twenty-four passes.

## Deliberately not building

Each of the following would be a new claim, and each is already refused in the
README's "Deliberate absences" table for a reason that has not changed:

merge or three-way reconciliation · threshold or multi-key signatures · revocation ·
transparency logs · timestamp authorities · encryption of the content · a key store
or key lookup · a server, an account, or sync · any dependency.

Two of them will be proposed by users. The answer is the README's own sentence: these
belong *above* this format, and a format that absorbs them stops being a file.

## The invariants this work must not break

- **The format identifier does not move.** None of Phase 1 or 2 changes a file. If one
  ever does, §14's rules apply and `format` changes — a different pass, with its own
  migration, not a patch inside this one.
- **The audit stays true.** The registry's rows, and the audit's accounting of its
  gaps, stay as they are. An exported constant without a row fails the suite, which is
  the mechanism working rather than an obstacle.
- **The kit stays the record.** If a change moves a recorded answer, it is because the
  format changed, and then the record is regenerated deliberately rather than edited
  to agree.
- **The verification floor holds.** Whatever is added passes on the Node version the
  spec promises. Browser-only work is excused there and skips with a reason; the
  verifier itself is never excused.