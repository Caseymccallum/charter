# The prior art

This is a comparison, written because the next problem this project has is not a
missing mechanism: it is that nobody outside it has used a `.charter` file. Three
existing specifications were read for what they do that this one does, or does not.

**How much was read matters, so it is stated.** Each was read from its published text
in a single pass. Where only the structure and named sections came back — which is
the case for the largest of the three — this file says so, and nothing here is a
claim about a specification's behaviour that was not read in that text.

## age: the size of a specification that gets implemented

`age` is a file encryption format, published as a C2SP document and rendered at
`age-encryption.org/v1`. Its editor's copy is about 27 KB: the whole format fits in
one sitting, and its test material is a short section pointing at a testkit rather
than a directory in the repository.

What it does with a limit is the part worth copying. `age` has no limitations
chapter. It states the limit where the limit is created, in the paragraph about ASCII
armor: an armored file "is malleable unless care is taken to reject any data before
and after the PEM encoding", with a strict parser and canonical base64 enforced. The
reader meets the caveat in the same breath as the feature.

**The relevant number is the contrast.** charter's own [SPEC.md](../SPEC.md) is
101,930 bytes — almost four times the length of `age`'s entire document — and none of
it is padding. Every rule in it is one a verifier obeys and an audit holds to code,
and the rules have only ever been added: the Python port's 40 disagreements were
settled by writing a rule that was missing (§4's number-token rule), not by deleting
one.

**What follows is not "shrink the specification."** What follows is that the
*entrance* to a format has to be smaller than its specification, and until this week
this one's entrance did not exist: the README's first command pointed at a file the
reader did not have, and the two facts a stranger needed — the kit holds files, and a
command verifies one — were never in the same paragraph. The three commands now under
"Verify a file" are that entrance. They take seconds, they need no key and no
reading, and two of the three show the format refusing something.

## TUF: writing the threat model down, and asking to be told

The Update Framework is a specification for securing software update systems, at
version 1.0.36, and it is the best available model for one thing this project cares
about: it treats its own limits as part of the specification rather than as an
apology. Its table of contents carries "1.4 Non-goals" as a top-level section, "1.5
Goals" split into goals for implementation and goals to protect against specific
attacks, and a "2.2 Threat model and analysis" section.

It also names its attackers and says where the names came from — rollback, freeze,
fast-forward and arbitrary software attacks, with the Mercury paper cited for the
last of them. charter's section 11 does the same work in a different shape: five
statements printed with every verdict, and three more limits that no caveat id
carries.

Two differences are worth recording.

- **TUF writes an unsolved problem down as an open question.** Its "7. Future
  directions and open questions" contains a subsection titled "Support for bogus
  clocks". charter treats the same problem as settled instead: every timestamp is a
  claim, nothing in the format witnesses a time, and the container carries no clock
  reading either. Both are honest. TUF's shape says *we know, we have not solved it*;
  charter's says *we removed the dependency*, and pays for that by having no time at
  all beyond what the author signed for.
- **TUF asks to be told when it is hard to implement.** In its opening pages it says:
  "We strive to make the specification easy to implement, so if you come across any
  inconsistencies or experience any difficulty, do let us know."

That second one is the mechanism this project is missing, and it costs one sentence.
The evidence that it matters is this repository's own history: the most valuable
finding in it — 40 disagreements between two implementations, two of which turned out
to be holes in the specification rather than defects in either implementation — came
from one person implementing the document from scratch. A specification that asks for
that receives it more often than one that does not. **This is recorded as a
recommendation and not made**, because it changes the specification's voice, and that
is the author's to change.

## C2PA: the closest relative, and what its vocabulary is better at

Content Credentials is the closest living relative of this format: a signed manifest
bound to content, with a formal vocabulary for what that binding does and does not
prove. It is also far larger — the 2.2 technical specification is a book, with
top-level sections for the claim, the manifest, versioning, the trust model,
validation, user experience and information security — and it was read here through
its structure and the sections named below rather than end to end.

**Two things are worth taking, and one absence is worth naming.**

**Hard and soft bindings have names.** Section 9 separates "Hard Bindings" from "Soft
Bindings": a binding is hard when breaking it is detectable from the artifact, and
soft when it is not. charter has exactly this distinction in prose — the content
digest, the signature and the chain links are hard; the title, the author's name, the
timestamps and the entry summaries are soft — and it has no word for it anywhere.
Naming which of charter's claims are hard and which are soft would put section 11's
five statements into one frame instead of five, and it is a paragraph of work in the
specification rather than a change to the format. Recorded, not made, for the same
reason as the last one.

**Trust is a different problem here, deliberately.** C2PA has a trust model with
identity of signers, validation states, trust lists and X.509 certificates. charter
refuses all of it by design: a public key travels inside the file it signs, a
signature proves only that the signer held the matching private key, and there is no
revocation, no transparency log and no freshness, because "anything of that kind
belongs above this format, not inside it". That is not a gap to close. It is the
boundary that makes a charter a file.

**Harms are first-class there and absent here.** C2PA ships a harms-modelling
document and gives information security its own section, with "Threats and Security
Considerations" and "Harms, Misuse, and Abuse". charter's section 11 is cryptographic
honesty: it says what a verdict does not prove. It says nothing about what a document
that verifies can be *used* to do — a forged-looking-true invoice, a genuine letter
presented as the final revision when it is not. For a format aimed at documents that
matter, that absence is real rather than principled, and it is the one finding here
that this comparison does not resolve.

**No interoperability is proposed.** C2PA attests media inside asset formats, binds
identity to certificate infrastructure, and takes an enormous specification to do it;
charter attests one self-contained file with a key it carries. C2PA has an appendix
for embedding manifests into ZIP-based formats, and charter *is* a ZIP — but sharing a
container is not sharing a problem, and nothing read here suggests otherwise.

## What was not concluded

- **Nothing about adoption follows from a specification's size.** `age` is small and
  widely implemented. C2PA is enormous and widely implemented. Size bears on the
  entrance, not the outcome, and an entrance is fixable without touching the rules.
- **No prior art was found that makes this format redundant.** A signed git history, a
  PGP clearsigned file and a C2PA manifest all bind a signature to bytes. None of them
  carries the edit history *inside* the document it is about, which is the one thing
  this format exists for. That is a statement about three documents that were read,
  not a survey of the field.
- **No dependency, and no code, came out of this reading.** The three things worth
  acting on are a sentence of invitation in the specification, a paragraph naming hard
  and soft bindings, and an entrance that now exists in the README. All three are
  prose, and two of them are the author's to accept or refuse.