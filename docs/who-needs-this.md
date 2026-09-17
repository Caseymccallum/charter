# Who needs this

Written because the question was asked plainly and the documents did not answer it:
*do people actually need this product for what it is right now?*

**No. Not yet — and the reason is specific, not a matter of maturity.** This project has
spent twenty-six passes making its claims true and has never established that anyone has
the problem those claims solve. That is a different gap from "no users", and it is the one
worth closing first.

## The honest accounting

The format is 24 hours old: 35 commits between 2026-09-16 19:51 and 2026-09-17 20:09.
Nothing in that day was wasted — the verification really is deep, two readings really do
agree, and the caveats really are printed rather than hidden. But depth of verification
answers "is this correct", and the question a user asks is "does this do my job". Those are
different axes, and only one of them has been worked on.

The documents have been assuming the second followed from the first. `docs/first-user.md`
opens "no users. That is the largest gap this project has", and `docs/where-to-post.md` was
written as a plan to close it. Both assume the value proposition is self-evident. It is
not, and this file is an attempt to state it rather than assume it.

## What the format can and cannot promise

`verifier/caveats.js` prints five statements with every verdict. They are the right thing to
print, and they are also the specification of what jobs this artifact can be hired for.
Taken seriously, they decide the question. Each is unavoidable from the artifact alone —
that is what makes it a caveat rather than a bug — but *unavoidable here* and *irrelevant to
the job* are different things, and only the second one matters.

| A user's job | What they need to be true | What the artifact proves | Verdict |
| --- | --- | --- | --- |
| "These are the bytes the signer released, and nobody else altered them" | the content digest and the signature | exactly that | **works** |
| "This is the document as it stood at each revision" | every revision is bound to content | only the last is bound; intermediate hashes are claims | partial |
| "The edit history is authentic" | a rewrite is detectable | **the key holder can replace every entry and re-sign** | **fails** |
| "This was written by that person or organisation" | the key is tied to an identity | keys are self-declared; a signature proves possession and nothing more | **fails** |
| "This existed at that time" | an independent witness to the time | timestamps are the signer's own claim | **fails** |
| "This is fit to be preserved as evidence of custody" | the three rows above | — | **fails** |

The last row is the uncomfortable one, because it is what this project has been
recommending. `docs/where-to-post.md` puts the archives and preservation lists first, on the
grounds that those are the people with the problem. They may well be. But the format's
*central* feature is an embedded history, and against the threat an archivist actually cares
about — the custodian rewriting the record — an embedded history proves nothing. A format
that appears to answer that question and does not is worse for that audience than no format
at all.

## What is left, and whether it is worth anything

One job survives, and it is narrower than the documentation suggests:

> **A single file that carries a document, the public key that signed it, and a signature
> over both — checkable by a stranger, offline, with nothing installed and nobody's
> permission.**

That is real, and it is not nothing. Its distinguishing property against the obvious
alternatives is that **the key travels in the file**: a verifier needs no key distribution,
no PKI, no network, and no prior relationship with the signer. Compare:

- a `.sha256` beside a download protects the hash with nothing, and needs a trusted channel
  to deliver the hash itself;
- a PGP clearsigned file is one file with content and signature, but no key inside it, and
  no history;
- Sigstore and cosign answer identity beautifully and require a transparency log and an
  identity provider — they are online by construction, which is the one thing this format
  refuses to be;
- git plus signatures proves a history to people who already have the repository.

So the honest niche is: **self-contained release integrity for a document handed to someone
who does not know you and will not install anything** — an air-gapped transfer, a
twenty-year archive, a policy notice, a dataset description, a published standard.

And note what that niche does not require: the history. A charter with one entry is exactly
as useful for it. Which means the feature this project has spent most of its day on — the
chain, the parent links, `edit`, the append pane, the intermediate-revision caveat — is
**not required by the only job the artifact currently does.**

## The price of three refusals

The README refuses revocation, transparency logs, and timestamp authorities, on the stated
grounds that "these belong above the format". That is a reasonable scope decision. What has
never been written down is what it costs, and the cost is the whole of the history claim:

- a **timestamp authority** would move "timestamps are claims" out of the caveats;
- a **transparency log** — even a bare append-only digest log — would make a rewritten
  history *detectable*, which is the one thing the chain cannot do;
- **identity**, through any PKI or Sigstore-shaped mechanism, would move "keys are
  self-declared".

Three refusals, three caveats. That is not a coincidence: the caveats are the shape of the
hole the refusals leave. Whoever wants the history to mean something is asking for one of
those three back, and the honest answer — not written anywhere until now — is that the
format's *distinctive* feature is the feature with the weakest guarantee.

This is not an argument for building them. It is an argument for **pricing** them, so that
if a real user ever asks for an authentic history, the answer is a considered scope change
rather than a surprise.

## What would have to be true for a user story to exist

A user story this project could stand behind has all four of these, and none of them is
about the code:

1. **A document that matters** — where being altered in transit, or in storage, is a real
   loss rather than an inconvenience.
2. **A recipient who cannot be given a key beforehand** — no shared infrastructure, no
   account, no relationship. This is the property that makes the format worth choosing over
   a signature file.
3. **A signer who is not the adversary** — the guarantee is against everyone *except* the
   key holder. If the custodian is the threat, this is the wrong tool, and no amount of work
   here changes that.
4. **A reason the check has to be offline** — an air gap, a long horizon, no server to
   depend on, or a policy that forbids one.

Three of those four can be guessed at from a desk. The first and third cannot: they are
facts about somebody's work, and they are the reason this document ends with a test rather
than a plan.

## The one thing to do next, and it is not an announcement

**Ask three people who handle documents that matter, and ask them one question: if someone
handed you this file, what would you need it to prove?** Then compare their answer with the
table above. That is the whole test. It costs a conversation per person, and it is the only
step on this roadmap that no amount of work in this repository can substitute for.

Until that answer exists:

- **do not announce it.** `docs/reach.md` ranked the announcement second, on the grounds
  that nothing compounds without a user — right about the symptom, wrong about the order.
  Announcing a format whose job is unestablished buys one look and no adoption, and the
  look does not repeat.
- **do not build more format.** The verification is not the weak part.
- **do not build the integrations** in `docs/reach.md` yet. An editor plugin for a format
  with no established job is a plugin nobody installs.

There is also no hurry, and the sense of one was manufactured here. There is no deadline, no
competitor, and no funding clock; formats take years, and this one is a day old. The urgency
came from repeating `docs/first-user.md`'s framing back as advice instead of checking it,
which is its own failure mode worth naming: **a project's own documents are evidence of what
it believes, not evidence that the belief is true.**