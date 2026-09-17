# The editor

A `.charter` file's claim, made visible to someone who is not going to read
[`SPEC.md`](../SPEC.md).

**This is a demonstration, not a product.** It does not compete with Notion,
Obsidian, or Google Docs, and it does not try: no sync, no account, no server, no
store, no network request, no build step, no dependency. It exists so that the
format's claim — *these are the bytes, these signatures were made by the key in
the file, this history is continuous with that document* — can be seen beside the
document it is about, in one page, without a terminal. Every feature it has is
there to make that claim easier to see, and that is the only rule it was built
under.

```
node editor/serve.mjs        # serves this repository on loopback and opens the page
```

Then drag `vectors/out/valid.charter` onto the page. Or serve the directory with
anything else that serves static files — `python -m http.server` works too.

## Why it needs to be served

The page imports the verifier and the writers from [`../verifier/`](../verifier),
which is the whole point: what it shows and what it makes is the format's own
code rather than a second copy of it. Browsers refuse to load an ES module from a
`file://` page, so `editor/index.html` cannot be opened by double-clicking it.
That is the browser's rule, not a design choice:

```
Access to script at 'file:///…/editor/editor.js' from origin 'null' has been
blocked by CORS policy: Cross origin requests are only supported for protocol
schemes: chrome, chrome-extension, chrome-untrusted, data, http, https,
isolated-app.
```

Measured in Chrome 153.0.8010.37, and true of Edge and Firefox for the same
reason. Opening the page from `file://` shows that sentence and the command above
instead of an empty page. `editor/serve.mjs` is a courier, not a server this
editor needs: it reads files out of this repository and hands them to the
browser, and it resolves each request before answering it, so a path that climbs
out of the tree is refused rather than served — that boundary is what makes
serving this directory safe at all. `test/editor.test.js` starts it the same way a
reader does, and then asks it over a socket for both halves of the rule.

**No network requests are made.** The page asks for `editor/index.html`, its own
module, and the modules under `verifier/` that module imports — all from the same
local server — and for nothing else, not even a favicon, which is a `data:` URL.
A browser's own developer tools show exactly that: the Network tab lists the
document, `editor.js` and the `verifier/**` modules, and if you leave it open
while you drop a file and seal one, it stays that list. That is asserted twice
here as well: statically, by scanning the page for every API that could reach out
(`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, …) and for every resource
it names; and live, by recording what the server is asked for while the tests
drive the page, and asserting that every request is `editor/…` or
`verifier/…`.

## Read mode

- Drop a `.charter` file on the page, or choose one.
- The verdict is shown with every check, its status and its reason code, and the
  prose of each check one click away. The whole verdict is also available in the
  exact shape `charter verify --json` prints, so the page and the command line
  can be compared.
- `content.md` is shown beside the verdict, as the bytes are: the format does not
  parse Markdown and neither does this page. A **Save the document** button hands
  those bytes over as a file, which is what the command line's `charter open` does —
  and `test/editor.test.js` compares the two, because a page that saved its
  rendering of the text rather than the bytes would produce a file that no longer
  matches the digest the verdict was about.
- The provenance history is listed — entry, action, author and key id, timestamp,
  the digests, the signature — with the two things a reader must not forget
  printed where they apply: every timestamp is a claim its signer made, and only
  the last entry's digest is bound to `content.md`.
- What a `VERIFIED` verdict does not mean is shown with it, always: the five
  statements of [`verifier/caveats.js`](../verifier/caveats.js). Load
  `vectors/out/history-rewritten.charter` and the caveat the format's credibility
  rests on is right there — `KEY_HOLDER_CAN_REWRITE_HISTORY` — beside a verdict
  that says the file verifies.
- An entry is marked *judged* only when every check that reads entries passed.
  Those checks read the log as a whole and the verifier stops at the first failure
  it reports, so a page that marked one row would have to read that failure's prose
  for an entry number; SPEC.md 10 says prose may be reworded and reason codes may
  not, so the marker stays at the level of the checks.

## Write mode

Two verbs share one form. **Seal and download** writes a new file: one entry,
action `create`, `parent` `null`, the content's digest, and a signature over the
canonical bytes — exactly as `charter seal` does. **Append a revision** adds one
entry to the file that is open, action `edit`, `parent` the digest of the line
before it, and the manifest re-signed with `content.sha256` moved to the new
revision — exactly as `charter edit` does (SPEC.md 15.6).

Both are held to the command line byte for byte. `test/editor.test.js` seals a
document here, seals the same document with `charter seal`, and compares the bytes;
and it seals a base, appends a revision here, appends the same revision with
`charter edit`, and compares those bytes too. Neither comparison is a coincidence:
the canonical bytes come from `verifier/canonical-write.js`, the container from
`verifier/zip-write.js`, the key id from `deriveKeyId()`, and Ed25519 signatures are
deterministic.

Appending needs three things the form cannot supply, and each is why the page reads
the open file again rather than using the values the verdict reported:

- **the bytes of the log**, because the chain is over bytes and not over objects.
  The earlier lines are copied byte for byte and never re-serialized: a re-encoded
  line would still verify, and it would no longer be the bytes the next entry
  commits to;
- **the values the file carries** — the creation time and the author name come from
  the artifact's own manifest, not from the form, because an append does not
  re-declare who created the document or when;
- **the key the file carries.** Every entry of a file names the one key it carries,
  so a second key is refused with `MISMATCH` rather than added: accepting it would
  write a history that changes signer halfway through it, which is the difference
  between extending a history and starting a new one inside the same file.

- **Content**: a textarea, seeded from the document that was read, if one was.
- **Key**: a PKCS#8 PEM, chosen from disk or pasted. **Nothing is stored.** No
  `localStorage`, no IndexedDB, no "remember this key", no telemetry: the key is
  read in the page, held in memory, and gone when the page closes. Holding a
  private key is your decision each time, and the page says so.
- **Claims**: title, author name, summary. The command line derives a title from
  the document when none is stated (SPEC.md 15.3); this page does not derive one,
  because the derivation lives in `producer/title.js`, which a browser may not
  import. It takes the title you state.
- **Time**: *no time stated* is the default, `now` is a button, and a stated time
  is a field — the command line's `--now`, `--created-at` and neither, surfaced
  instead of hidden. The page says, before you seal, which of the three the file
  will carry. With no time stated the file carries `1980-01-01T00:00:00Z`, the
  instant the container's fixed DOS stamp means (SPEC.md 15.2), and no clock is
  read.
- Sealing downloads a `.charter` file and then reads it back into read mode, so
  the verdict on what was just written is on screen next to nothing else.

A file sealed in the page and the same file sealed by the command line are the
same bytes: same content, same key, same stated metadata, same file. That is not
a happy accident of two implementations — the canonical bytes come from
`verifier/canonical-write.js`, the container from `verifier/zip-write.js`, the key
id from `deriveKeyId()`, and Ed25519 signatures are deterministic.
`test/editor.test.js` seals a document in a browser, seals the same document with
`charter seal`, and compares the bytes.

## What it is not

- No sync, no accounts, no server of its own, no network requests.
- No key storage and no key generation: sealing and appending are the only things it
  does with a key, and a key never leaves the page.
- No reimplementation of `seal`, `edit`, `verify`, `cite` or `inspect`: it imports
  `verify.js`, `provenance.js`, `manifest.js`, `canonical-write.js`, `zip-write.js`,
  `base64url-write.js`, `base64url.js`, `zip.js`, `digest.js`, `bytes.js`,
  `canonical.js`, `limits.js`, `schema.js`, `refuse.js` and `status.js` from
  `verifier/`, and uses Web Crypto for the signature. It writes no canonical JSON
  of its own, no ZIP of its own, and no Ed25519 of its own. What it does assemble
  itself is the shape of an entry and of a manifest — which the command line
  assembles in `producer/seal.js` and `producer/edit.js`, modules a browser may not
  import — and that is exactly the duplication the byte-for-byte tests above exist
  to hold to one answer.
- No Markdown parsing: the content is shown as text in a `<pre>`, which is enough
  for the claim to be visible.
- **One revision at a time, and no rewriting.** Appending adds an entry and copies
  the earlier ones byte for byte; the page cannot drop an entry, reorder a history,
  or sign with a second key. Those are the operations the format's own caveat says
  the key holder can do *outside* the page, and a page that offered them would be
  inviting them.

## The tests

`test/editor.test.js` asserts the rules above statically, and — when this machine
has Chrome, Edge, Chromium, or a browser named by `CHARTER_BROWSER` — runs the
page in a headless one and asks it for all 56 artifacts in the conformance kit,
comparing every check status with the reference's, driving the read pane on five
fixtures, saving the document a pane shows and comparing those bytes with
`charter open`'s, sealing a document and comparing the bytes with `charter seal`'s,
appending a revision and comparing the bytes with `charter edit`'s, asking for a
second key and checking that it is refused, and reading the browser's own download
back with the verifier. Without a browser it skips that half and says so.
