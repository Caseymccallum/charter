# Reach

Written because the question changed. Everything up to now has been about making the
claims true: 220 tests, two independent implementations, a kit of 56 artifacts, a corpus
of 34 mutated containers, a probe of 27 cases, a declaration registry, an audit with
thirteen of fourteen gaps closed. That work is what the format *is*.

None of it has produced a user. And the next question — "how do we make this the best
product possible, and reach as many people as possible" — has an uncomfortable answer
worth stating before the plan: **those two goals pull in opposite directions, and this
project has spent its whole life on the first one.** More verification is diminishing
returns. More distribution is untouched. The switch is the plan.

## The UI question, answered

**No. Do not fork another product's interface, and do not adopt a framework for ours.**

The editor this project has is not a product, and that is load-bearing rather than
modest. Three things are true of it because it is small, and `test/editor.test.js`
enforces all three:

- it imports nothing outside `verifier/**` — so a page cannot become a second
  implementation of the format;
- it makes **no network request at all**, checked live by recording what the server is
  asked for while the page is driven;
- it has **no build step and no dependency**, which is why `dependencies: {}` in
  `package.json` is still literally empty.

Dropping ProseMirror, CodeMirror, TipTap or Milkdown into it would break all three at
once. A framework means a dependency, a bundle and a build, and `dependencies: {}`
becomes `dependencies: {"@tiptap/core": "..."}`. The sentence this project is built on —
*a stranger can check without trusting the author, a server or a clock* — survives on the
fact that there is nothing in the trust path to trust. That is worth more than a rich
text toolbar.

The deeper reason is that **our UI is not the reach story at all.** A format's reach comes
from other people's interfaces. PDF did not win because Adobe wrote the best reader; it
won because everyone else could write one. `age` did not spread through its own CLI; it
spread through `rage`, through plugins, and by being embeddable. If `.charter` is ever
used, most of the using will happen inside tools this project does not write.

So the choice is not "our editor or their editor". It is **one demonstration we can
check, plus integrations into interfaces people already have open.**

## The integrations, and what each one needs

Each row *is* "using another product's UI", and none of them is a fork:

| Integration | The interface it borrows | What it needs from this project |
| --- | --- | --- |
| A VS Code extension | the editor millions of people already run | the **reading surface** — shipped this pass — and a verdict panel |
| An Obsidian / Zettlr plugin | a notes app, where documents that matter already live | the reading surface **and the writing surface**: seal a note, append a revision |
| A git hook, or a CI action | the repository | the command line, plus the reading surface for a script. This is how a format reaches the place documents are actually kept |
| An ingest queue | Archivematica, or a preservation pipeline | **identification** — the item measured below — and the collection verb for a directory |

Nothing on that table requires a new format feature. Three of the four require only what
this pass shipped: a documented, stable, importable surface with two entry points, one
pure and one Node-only.

## The reach levers, ranked by what a unit of work buys

**1. Identification. This is the entry ticket, and it is missing.** A format nobody can
identify does not get catalogued, and an uncatalogued format does not get preserved. The
first question the preservation world asks about any new format is *does DROID know it*,
and today the answer is no — `editor/serve.mjs` does not even have a media type for
`.charter` and serves it as `application/octet-stream`.

The signature was measured rather than guessed, across every artifact this project has:

| What was scanned | Files | Begin `PK\x03\x04` | Carry `manifest.json` at byte 30 |
| --- | --- | --- | --- |
| the kit, `vectors/out` | 56 | 55 | 54 |
| the corpus, `vectors/container/out` | 34 | 34 | 32 |
| the probe, `vectors/probe/out` | 27 | 27 | 27 |
| **total** | **117** | **116** | **113** |

The four misses are exactly the four *deliberately* mutated to move the entry name or its
order — `not-a-zip.charter`, `missing-manifest.charter`, `entry-name-uppercase.charter`,
`entry-order-reordered.charter`. A signature that identified those would be identifying a
file the format does not describe. So **`PK\x03\x04` at byte 0 and `manifest.json` at
byte 30 identifies every conforming artifact and nothing else**, and the key file is
armored text opening `-----BEGIN CHARTER ENCRYPTED KEY-----`.

The deliverable is small, and it is not done here: a `file(1)` magic snippet,
`application/charter` written down as the media type, and a signature proposal for
Siegfried and PRONOM. Note what this item is *not*: it is not verification, and it
deliberately does not try to be. Identification answers "is this the kind of file I
think it is", which is a question every ingest pipeline asks long before it asks whether
the file is true.

**2. The announcement, which is written and unposted.** Nothing else compounds until a
person with a document uses this. It is the highest-leverage act available and it costs
nothing but the decision to do it.

**3. A third implementation, in a language nobody here has used.** This is free research,
and it is the only thing that has ever found a hole in `SPEC.md`: the Python port
disagreed 40 times, and **two of those turned out to be missing rules rather than bugs** —
where a malformed number ends, and whether a charter may carry an extra field. Both were
settled by writing the rule that was missing. A Go or Rust reading by someone who has not
opened `verifier/**` will find different holes. It is recruitment rather than coding, and
it is the one item here that no amount of work in this repository can substitute for.

**4. The integrations in the table above.** Each is small, each is a new audience, and
each is a place where the format becomes *useful* rather than merely correct.

**5. A collection verb** — a directory, one report, a record that can be filed. Last, and
deliberately: building it before an archivist has said what their report must contain
would be guessing at requirements with a specification in hand, which is the mistake this
project has avoided for twenty-six passes.

## What not to build

Merges and three-way reconciliation · sync · a key-management UI · a hosted service or a
"verify this online" page · WASM builds · a plugin marketplace · anything with an LLM in
it. Each is a new claim this project would then have to keep, several are already refused
in the README's table of deliberate absences, and none of them is reach: they are features
looking for an audience that does not exist yet.

The rule for the next pass is one sentence: **if it does not either put a `.charter` file
in front of a new person or make somebody else's tool able to read one, it waits.**