# Why the project is called Charter

This file exists because the name is load-bearing. A file format is a promise
to strangers; its name has to survive being typed into a shell, spoken aloud in
a meeting, and read on a signature line. The alternatives were checked before
committing, and the rejections are recorded here so that the question does not
get reopened from memory in six months.

## The chosen name

**Charter** — the project. `.charter` — the file extension. `charter` — the
command.

A charter is a document that records rights, provenance, and terms. It is the
oldest word we have for "an artifact whose authority comes from what it
records", which is exactly the claim this format makes. The extension is not
abbreviated (`.chrt`, `.chtr`); a format that asks to be verified should not
make readers guess what the file is.

## What was checked, and what was rejected

| Candidate | Why not |
| --- | --- |
| **Sigil** | An existing software project in this exact space, and a busy word generally (e-book tooling, games, language tooling). Trademark risk is real, and the metaphor points at the seal rather than at the record. |
| **Vellum** | Strong connotation already taken by a well-known e-book/typesetting product. Also implies the *material* rather than the *terms*. |
| **Attest** | Correct meaning, but crowded as an English verb in the security space (attestation, remote attestation, TPM attestation). Searching for it returns everything and nothing. |
| **Ledger** | Owned by a hardware-wallet company in the public mind, and it implies accounting. Charter documents are not accounts, and the ledger metaphor suggests the tool is about money. |
| **Testimony** | Semantically close, but long, and it emphasizes the *speaker* rather than the *document*. Poor as a CLI verb; nobody types `testimony verify`. |
| **Provenance** | The most descriptive and the worst identifier: it names one axis of the format (history) while the format's whole point is that history, content, and authorship are one signed artifact. It is also an overloaded term in art, supply chain, and data tooling. |

Two other constraints drove the decision:

1. **The extension must be unambiguous.** An extension that collides with an
   existing widely used format creates a class of user error that no
   specification can repair (a tool silently reading the wrong file type).
   `.charter` is distinctive and self-describing.
2. **The CLI verb is not the project name.** `charter seal`, `charter verify`,
   `charter cite`. The name has to read as a noun here — you seal a charter,
   you verify a charter. Names that only work as verbs were rejected on that
   ground alone.

## Carried over from Vidimus

The project was called Vidimus earlier ("we have seen it" — the word written on
an inspected copy). It was retired because it is a Latin verb: it cannot be
used as a noun for the artifact, and its meaning describes the verifier rather
than the file. Charter keeps the discipline of the earlier work (spec first,
verifier first, no pass-with-warnings) and drops the name.

## Result

- Project: **Charter**
- Extension: **`.charter`**
- Command: **`charter`**
- Naming conflicts knowingly accepted: the word "charter" is used by schools,
  cities, and the UN. None of them ship a document format. There is no
  plausible confusion between a city charter and a `.charter` file.

## Status of these checks

These were manual checks of public search results and package registries at the
time of writing, not legal advice, and not a trademark clearance search. The
claim being made is narrow and worth stating precisely: **no candidate was
rejected on a hunch, and every rejection has a reason written down here.** If a
clearance search later contradicts something in this table, this file should be
corrected rather than quietly dropped, and the correction should say what
changed.
