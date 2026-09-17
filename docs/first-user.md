# The first user

The format has three implementations, a conformance kit, a container corpus, a
differential probe, an editor, a specification with no known contradictions — and
no users. That is the largest gap this project has, and this document is where its
first session is recorded.

Nothing here is a finding yet. It is the protocol, written down before the session
so that the session cannot be designed around what it would be convenient to learn,
and the place the transcript goes afterwards. **The session has not been run.** No
part of it is written as if it had been, and no sentence below is a paraphrase of
something nobody said.

## What the person is given

- The editor. On the repository as it stands, that is:

  ```
  npm run editor          # or: node editor/serve.mjs
  ```

  It serves this repository on loopback and opens the page. The page needs nothing
  installed and sends nothing anywhere; `editor/README.md` says what it is and what
  it is not, and none of that is said to the person.
- One sentence, and this is the whole of the hand-over:

  > drop your document in, seal it, send the `.charter` file to whoever needs to
  > check it, and tell them to drop it on the same page
- Nothing else. No walkthrough, no tour of the checks, no explanation of what a
  digest is, no note about which button does what, and no mention of this document.
  If a question can be answered by reading the screen, it is not answered out loud.

The person is chosen for three things and not for a fourth: a document whose
content matters to them, a reason to want a stranger to be able to check it, and no
interest in reading a spec. They are not a developer and not a collaborator on the
project — someone who has read `SPEC.md` is the wrong person, because they would be
testing their own reading of it.

## The three moments, verbatim

The first three places they got stuck, recorded as they happen: what the screen
said, what they said, and what they did next. `—` where a moment has nothing to
quote, and the exact words wherever there are words, including the misspelled ones,
the ones that name the wrong thing, and the ones that sound like a complaint about
something else.

| # | Where the screen was | What they said | What they did next |
| --- | --- | --- | --- |
| 1 | | | |
| 2 | | | |
| 3 | | | |

Help is not given in the moment. If they cannot complete the task without being
talked through it, that is the finding, and it is a better finding than a completed
task that needed a person who had read the code. If they complete it, the three
moments are still the finding, because three places where a stranger stopped are
three places the page is not finished.

## The one question, and its answer

Asked when the session ends, in these words and no others:

> what would you need to be able to do that this does not let you do?

Recorded verbatim, with a note about what they were doing when they answered.

## The rule this session is under

**If the first user cannot complete the task, the editor is not fixed first.** The
finding is recorded, reported, and waited on. This project's whole history is
building a format to a standard a stranger can read; this session exists to find
out whether a stranger can *use* it, and an editor improved in the same session as
the finding is an editor that answers a question nobody wrote down.

## What the session changed about my understanding

One paragraph, written the same day, and not about the editor: what the session
changed about my understanding of the format — which rule turned out to be one two
people can hold, which sentence turned out to be legible only to the person who
wrote it, and what the person did that no reading of the specification would have
predicted.

Empty until the session happens. A paragraph guessed at here before the session
would be indistinguishable afterwards from one written from what was said, which is
the one thing this document is for.

## What was prepared, and what it is not

- The editor was verified to serve before the session was arranged, so that a
  failure of the hand-over is a finding about the editor rather than about a broken
  command: `node editor/serve.mjs --no-open --port 8123` answers
  `GET /editor/index.html` with 200 and 12,784 bytes and `GET /verifier/verify.js`
  with 200, which is the page and the module it imports. This is a check that the
  door opens, not a rehearsal of the session: nothing was dropped on the page, and
  no one has used it who did not write it.
- The sentence above is the whole of the hand-over and it is the sentence this
  protocol fixes. It is not lengthened or softened to make the page easier to
  explain, and it stays one sentence: a hand-over of two sentences is a walkthrough
  with the first sentence kept.
