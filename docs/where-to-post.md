# Where to post it

> **On hold, and why.** This plan was written before anyone asked whether the format has a
> job. `docs/who-needs-this.md` asks it, and the answer is that one job survives the
> format's own five caveats — release integrity for a document handed to a stranger — and
> that the embedded history is not part of it. Posting any of this before that question is
> answered with a real person buys one look and no adoption. The venues, the vocabulary
> notes and the questions below are kept because they are the right plan for *after* the
> gate, not because the gate is open. (The archives lists in particular should be read
> alongside the caveat that the custodian can rewrite the history, which is the threat that
> audience cares most about.)

`docs/announcing-charter.md` is the text. This file is the plan for putting it in
front of people, because that is now the project's whole remaining problem.

**One caveat before anything below.** These venues are named from a search and from
what each community says it is for. Their posting rules were not read, and they
change. Check the rules of any place before posting there — particularly Hacker News
and Reddit, where the self-promotion norms are specific and enforced.

## The two audiences are not one audience

The announcement is written for people who care about local-first software,
verifiable provenance, or portable document formats. The places worth posting split
into two groups that want different opening sentences, and the same text will
underperform in the second unless one thing is done first.

**Software people** want to know what the thing is and what makes it hard. The
announcement as written serves them.

**Archivists, records managers and preservation engineers** want the same facts under
different words, and those words are this format's own concepts: *fixity* (the content
digest), *authenticity* (the signature and the chain), *chain of custody* (the parent
links), *provenance* (the log), *significant properties* (the content bytes, never
rewritten). They already run fixity checks over collections, and they already treat
"the custodian can rewrite the history" as a known attack on authenticity rather than
as a caveat to be discovered — it is in the archival literature, not in a security
blog.

The awkward consequence: the announcement's one hard rule was that the word
"provenance" must not appear in its first paragraph, because a stranger does not know
what it means in this context. That rule is right for the software audience and wrong
for the archives lists, where the term is native and its absence reads as imprecision.
**Do not change the document.** Write a second opening for the archives posts in their
vocabulary and leave the general text alone.

## Venues, in the order I would try them

**1. The Open Preservation Foundation lists — the best fit by a distance.**
`dig@lists.openpreservation.org` is the general digital-preservation list.
`icrff@lists.openpreservation.org` is the International Comparison of Recommended
File Formats group: people whose actual job is evaluating and cataloguing file formats
for long-term keeping. A format with a normative specification, a conformance kit and
a third-party reading is exactly on topic there, and the kit is the first thing they
will ask about. The Archives Interest Group is the third door. These are mailing
lists, not feeds: send the announcement as a plain-text email with the link, and
expect questions rather than applause.

**2. Hacker News, as a Show HN.** HN rewards "here is a thing you can try" and
punishes marketing. The entrance added in the last pass is what makes this postable —
a reader can verify a file in well under a minute without reading anything. Keep the
title under eighty characters, and make the author's first comment the honest-limits
comment below: readers there go to the comments first, and a maker who states the
limits before being asked gets a different conversation from one who does not.

**3. Lobsters.** Smaller, technical, kinder, and tagged. Same text as HN.

**4. The local-first community.** `localfirstweb.dev` is the hub, with a chat, and
`localfirstnews.com` carries a newsletter; `offlinefirst.org` runs a chat too. This
audience will like the editor page and the absence of a server, and will ask what
happens when two people hold a copy of the same file. The answer is that the format
does not merge, which is a limit worth volunteering before it is asked.

**5. The C2PA and credentials communities.** A mention rather than a pitch:
`docs/prior-art.md` compares this format to C2PA, and someone there may care that a
self-contained alternative exists for documents rather than media. Lowest expected
return, highest chance of a useful technical conversation.

**Not recommended:** general programming subreddits, "awesome list" pull requests, or
anywhere that treats a link as an audience. A format needs a reader with a document;
those rooms have readers with opinions.

## The questions that will be asked, and where the repository answers them

Each of these already has an answer written down. Have the links ready and do not
improvise them, because the improvised answer is the one that will be wrong.

| The question | Where it is answered |
| --- | --- |
| "This is just signed git." | README, "What is inside a `.charter` file" — the history is *in* the file, so the copy you hand over carries it |
| "Why not PGP clearsigning?" | SPEC section 11 — a clearsigned file has no history, and its signature is not bound to a document digest |
| "What stops the key holder rewriting it?" | Nothing. Caveat `KEY_HOLDER_CAN_REWRITE_HISTORY`, and the kit's `history-rewritten` case verifies on purpose |
| "So the timestamps are meaningless?" | They are claims. Caveat `TIMESTAMPS_ARE_CLAIMS`; `entry-with-earlier-timestamp` is kept VERIFIED on purpose |
| "Why not C2PA?" | `docs/prior-art.md` — a different problem and a different trust model, refused deliberately rather than left unsolved |
| "Who uses this?" | Nobody yet. `docs/first-user.md` says so, and is the plan for the first one |

## What to do with what comes back

What is worth collecting is not stars. It is **implementation difficulty**. Anyone who
tries to write a reader and finds a rule missing, or two readings of one sentence, is
producing the only kind of finding that has ever improved this specification: the
Python port's 40 disagreements, two of which were holes in the document rather than
defects in either implementation. TUF's opening pages ask for exactly that in one
sentence. This project does not ask yet, and `docs/prior-art.md` records that as the
first recommendation I would make.