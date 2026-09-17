# The first visitor

`docs/announcing-charter.md` is written for people who have never heard of this
project, and it ends by sending them here. This file asks what those people meet
when they arrive, and answers from `README.md` as it stands, quoting it. It is a
documentation pass: it changes nothing but the one sequence named in question 2.

## 1. In the first screen, does a stranger learn what a `.charter` file is?

**Yes — in the first sentence, and then not again for three-quarters of the file.**
This is the one sentence in that screen that teaches it:

> `.charter` is a local-first document format: one file that carries a document,
> the edit history of that document, and the signature of whoever wrote both, in a
> form a stranger can check without trusting the author, a server, or a clock.

That is the idea in plain words, before anything is asked of the reader. It is the
best sentence in the repository for the purpose and it is where it should be.

There is no second and no third sentence in that screen doing the same work. What
follows is about how the repository is built:

> This repository is the **verifier first**. It contains a pure verifier, a
> conformance kit, a command line, and the tests that hold all three together.

> The asymmetry is the point. The verifier may not read a file, a clock, or a
> random source, and may import nothing outside `verifier/**` ...

Both are true, and both are addressed to someone who has already decided to work
on this. The sentences a stranger would want next are in the file, under a heading
at line 277 — "Three claims, and nothing more":

> A `VERIFIED` verdict means:
>
> - these are the bytes of the document;
> - these signatures were made by the key the file carries;
> - this history is continuous with that document.

> It does **not** mean the document is true, recent, or written by anyone in
> particular.

So: yes, with a qualification worth writing down. The file introduces the idea in
its first sentence and then spends its first screen on module boundaries. Nothing
it says is wrong, and the order is what a visitor meets. The material that would
hold a stranger — what a verdict means, and what it refuses to claim — sits below
the point where most of them stop reading.

## 2. Is there a path from curious to convinced in under five minutes, without `SPEC.md`?

**There was not. The gap was one missing sentence, and it is now closed.**

The section headed "Verify a file" gave commands and pointed them at a file the
reader does not have:

> node cli/charter.js verify path/to/file.charter        # the verdict, and what did not pass

`path/to/file.charter` is a placeholder. A stranger who has just cloned the
repository has no `.charter` file, and that section never said where one is. The
repository holds them — the kit's artifacts are checked in under `vectors/out/` —
and the kit is presented instead as a replay harness: `node vectors/run.js` reads a
record of recorded answers and asks the verifier for a verdict about each artifact.

Replaying that record shows this implementation agrees with the answers it wrote
down for itself. That is worth knowing, and it is not the same thing as putting a
file into a stranger's hand and letting them watch a verdict come back. The two
facts — files are here, and a command verifies one — were never in the same
paragraph. That is the whole finding: not a missing feature, a missing sentence.

**What was added.** Three commands under "Verify a file", using only commands that
already existed and files already checked in. The exact text is quoted in section 5.
## 3. Does the README link to the spec, the kit, and the editor?

Yes, and in that order — which is the right order for this repository: the
artifact, then the evidence for it, then the cheapest way to look at it. The links,
in the order they appear:

| Order | Line | Link | What it is |
| --- | --- | --- | --- |
| 1 | 21 | `SPEC.md` | the format |
| 2 | 169 | `vectors/probe/README.md` | the differential probe |
| 3 | 194 | `vectors/container/README.md` | the container corpus |
| 4 | 218 | `implementations/python/README.md` | the second reading |
| 5 | 220 | `SPEC.md` | the format, again |
| 6 | 223 | `test/adversarial.md` | the adversarial table |
| 7 | 242 | `SPEC.md` | the format, a third time |
| 8 | 259 | `editor/README.md` | the page |
| 9 | 371 | `LICENSE` | the licence |

Three things are worth recording beside that list.

- **The spec is the first link in the document**, at line 21, before the reader has
  been told what a verdict is or has seen a command. It is the deepest document in
  the repository and it is offered first. That is defensible for a project whose
  artifact is a specification, and it is the opposite of what a visitor arriving
  from an announcement needs.
- **The kit is never linked as a unit.** There is no `vectors/README.md`, so the
  kit reaches the reader as two sub-directory READMEs — the probe's and the
  corpus's — while its own entry point is a command rather than a link.
- **The editor is linked as `editor/README.md`, and the announcement links
  `editor/index.html`.** Different targets for the same thing, in the two documents
  a visitor meets in sequence. Not a contradiction; not the same door.

## 4. What does a visitor do after the five-minute path?

The next two things exist. In the README's order the next section is "Seal a
document", and it is the natural second thing: make a file of your own and watch it
verify. It is written with an installed command:

> charter keygen -o key.pem                           # an Ed25519 key, PKCS#8 PEM

`charter` is the bin name in `package.json`. It is not on the path of a fresh clone
— it is not on the path of the machine this audit was written on — and the same
file that uses it says, a screen later, "No installation, no build step, no
dependencies." So the second thing does not work as printed. It works as
`node cli/charter.js keygen ...`, which is how every other command in the file is
written, and is what the newly added sequence uses.

The third thing is the editor, `npm run editor`, which does work from a clone. It is
the surface the announcement points at, it needs no specification and no key, and
it is at line 235 — four sections below where a stranger will be.

**This is reported rather than changed.** Rewriting the seal block to
`node cli/charter.js` is a real improvement and it is not this pass's edit: this
pass adds the smallest sequence that makes a first path exist, and a second finding
acted on quietly is a finding nobody records.

## 5. What was added

Under "Verify a file", after the general commands and before the exit codes:

> A file to try it on, with nothing installed and nothing built — the kit holds a
> document, the same document with one byte of its content changed, and a history
> that was rewritten and re-signed:
>
> ```
> node cli/charter.js verify vectors/out/valid.charter             # VERIFIED, exit 0
> node cli/charter.js verify vectors/out/content-tampered.charter  # BROKEN, exit 2
> node cli/charter.js verify vectors/out/history-rewritten.charter # VERIFIED, exit 0
> ```

All three were run before they were written down: the first returns `VERIFIED` and
exit `0`; the second differs from it by one byte of `content.md` and returns
`BROKEN` with exit `2`, naming the digest it measured against the digest the
manifest declared; and the third returns `VERIFIED` because a rewritten history is
a file this format cannot tell from an original — which is the limit the verdict
prints about itself. Two commands show what the format catches and one shows what
it does not, and the reader needs no key, no network, and no specification.

## What this pass did not do

The three findings in question 3 and the one in question 4 are recorded above and
not acted on. Nothing here is a test, a fixture or a tool: the questions were
answered by reading the file and running four commands that already existed.

The format is complete and the verification is extensive. What is missing is not a
mechanism — the claim that a stranger can check a file was the last thing worth
building, and it is built. What is missing is a person with a document that matters
to them, which is `docs/first-user.md`, and is not an agent's to run.