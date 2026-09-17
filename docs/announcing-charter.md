# Announcing Charter

A `.charter` file is one document, the history of how it came to say what it says,
and a signature over both, kept in a single file. It opens with no network, no
account, no server and no clock to agree with: you can check for yourself that
nothing in it has changed since it was signed, that each step in the history
follows the one before it, and that the same file gives the same answer on any
machine. A `.charter` file is a file the way a PDF is a file.

The problem it addresses is the one you have when you need to be able to show,
later, that a document is the document you had — and you cannot rely on where it
was kept. A document in a word processor can be revised with the revision
tracking switched off, and whatever history there is lives on someone else's
server. A repository keeps history in a folder of objects rather than in the
file, so the copy you hand over carries none of it. A PDF signature shows that a
file was signed, not that its text was ever revised. A `.charter` file carries the
history inside itself, so the document you send is the document plus the evidence.

It is not a way to prove a document is true, and it cannot tell you who someone
really is.

**What a `.charter` file establishes:**

- that every revision was signed by the key the file carries
- that the revisions form one unbroken, ordered chain
- that the final revision is exactly the bytes the file claims
- that the file's structure stays inside what the format allows

**What it does not, and says so beside every verdict:**

- the earlier revisions cannot be confirmed — only the last one is in the file
- whoever holds the key can rewrite every revision and re-sign the lot
- a key is not a person: it travels inside the file it signs, so a signature
  proves only that someone held the matching private key
- no time is established anywhere. Every timestamp is written by the author, so it
  is a claim and not a fact
- the content is not judged: a valid file can hold something false, unlawful or
  worthless
- nothing is known about what happened before the first entry, and a history of
  one entry is as valid as one of a hundred

The specification is [SPEC.md](../SPEC.md). The conformance kit is
[`vectors/`](../vectors/), and it runs without trusting this implementation. The
reader is [`editor/index.html`](../editor/index.html) — one page, no build step:
open it and drop a file on it. All of it is at
[github.com/Caseymccallum/charter](https://github.com/Caseymccallum/charter).

Most of the work is not in the reader. Three implementations of the checks exist —
the reference one, a Python port written from the specification rather than from
the JavaScript, and a third inside the browser page — and they are held against
each other by a kit of 56 artifacts with 56 recorded answers, 27 hand-built cases,
and 34 deliberately corrupted containers whose verdicts were written down in
advance. The specification's own list-shaped rules are held to the code by an
audit and a registry of 44 declarations, so a rule that drifts out of agreement
with the code fails a test. That was the order it had to happen in: make the file
checkable first, then write something that produces one. Nobody outside this
project has used a `.charter` file yet.
