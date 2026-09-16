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
browser, and `test/editor.test.js` starts it the same way a reader does.

**No network requests are made.** The page asks for `editor/index.html`, its own
module, and the modules under `verifier/` that module imports — all from the same
local server — and for nothing else, not even a favicon, which is a `data:` URL.
That is asserted twice: statically, by scanning the page for every API that could
reach out (`fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, …) and for every
resource it names; and live, by recording what the server is asked for while the
tests drive the page, and asserting that every request is `editor/…` or
`verifier/…`.

## Read mode

- Drop a `.charter` file on the page, or choose one.
- The verdict is shown with every check, its status and its reason code, and the
  prose of each check one click away. The whole verdict is also available in the
  exact shape `charter verify --json` prints, so the page and the command line
  can be compared.
- `content.md` is shown beside the verdict, as the bytes are: the format does not
  parse Markdown and neither does this page.
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

Seals one document, exactly as `charter seal` does: one entry, action `create`,
`parent` `null`, the content's digest, and a signature over the canonical bytes.

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
- No key storage and no key generation: sealing is the only thing it does with a
  key, and a key never leaves the page.
- No reimplementation of `seal`, `verify`, `cite` or `inspect`: it imports
  `verify.js`, `canonical-write.js`, `manifest.js`, `zip-write.js`,
  `base64url-write.js`, `base64url.js`, `provenance.js`, `zip.js`, `digest.js`,
  `bytes.js`, `limits.js`, `schema.js`, `refuse.js` and `status.js` from
  `verifier/`, and uses Web Crypto for the signature. It writes no canonical JSON
  of its own, no ZIP of its own, and no Ed25519 of its own.
- No Markdown parsing: the content is shown as text in a `<pre>`, which is enough
  for the claim to be visible.
- No history: charter/0.1 has no verb for appending an entry yet, and neither does
  the command line.

## The tests

`test/editor.test.js` asserts the rules above statically, and — when this machine
has Chrome, Edge, Chromium, or a browser named by `CHARTER_BROWSER` — runs the
page in a headless one and asks it for all 54 artifacts in the conformance kit,
comparing every check status with the reference's, driving the read pane on four
fixtures, sealing a document and comparing the bytes with the command line's, and
reading the browser's own download back with the verifier. Without a browser it
skips that half and says so.
