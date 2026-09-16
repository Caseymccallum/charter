/**
 * The editor: a `.charter` file's claim, made visible.
 *
 * This is a demonstration, not a product. It does not compete with an editor
 * that syncs, stores, or hosts, and it has no feature that does not make the
 * format's claim easier to see: what a file says about itself, whether that
 * claim holds, and what a `VERIFIED` verdict does not mean. It reads with the
 * verifier and writes with the same writer the producer writes with, so what it
 * shows and what it makes are the format's own code rather than a second opinion
 * about it.
 *
 * # What it imports, and why that is the whole list
 *
 * Only `../verifier/**`, and only modules a browser can load: no `node:fs`, no
 * `node:crypto`, no bundler, no dependency. That is also why the two writers it
 * needs — the canonical ZIP writer and the base64url encoder — live in that
 * directory rather than beside the producer: a page may not import `producer/**`
 * (it holds `node:crypto` and the file system), and a second copy of the
 * container's rules would be a second place for them to be wrong.
 * `test/editor.test.js` asserts both halves of that: the import graph, and that
 * nothing here reaches the network, a store, or a clock except on a click.
 *
 * # The two things it does not do
 *
 * A seal in this page takes the title, the author and the summary from the form
 * rather than deriving them: `producer/title.js` derives a title from a
 * document's first heading, and it is Node-side code this page may not import.
 * Where a title comes from is the subject of SPEC.md 15.3 and the producer's job;
 * the form states one instead of guessing. And a key is read from a PEM the user
 * supplies and lives in this page's memory until the page is closed: no store,
 * no `localStorage`, no "remember this key", no key material anywhere but the
 * variable holding it while a document is sealed.
 *
 * @module editor/editor
 */

import { decodeBase64Url } from '../verifier/base64url.js';
import { encodeBase64Url } from '../verifier/base64url-write.js';
import { toHex, utf8Decode, utf8Encode } from '../verifier/bytes.js';
import { parseJsonText } from '../verifier/canonical.js';
import { canonicalDocument, signingInput } from '../verifier/canonical-write.js';
import { ALGORITHM_NAME, hasWebCrypto, sha256 } from '../verifier/digest.js';
import { LIMITS } from '../verifier/limits.js';
import { ALGORITHM, deriveKeyId, FORMAT, PUBLIC_KEY_BYTES, SIGNATURE_BYTES } from '../verifier/manifest.js';
import { parseLine, readEntry, splitLines } from '../verifier/provenance.js';
import { RefusalError, refuse } from '../verifier/refuse.js';
import { isIsoUtcSecond } from '../verifier/schema.js';
import { REASON, STATUS } from '../verifier/status.js';
import { ENTRY_CONTENT, ENTRY_MANIFEST, ENTRY_PROVENANCE, verify } from '../verifier/verify.js';
import { parseArchive, readEntryData } from '../verifier/zip.js';
import { zipStore } from '../verifier/zip-write.js';

/**
 * The instant a file that states no time carries, in both places it can state
 * one. SPEC.md 15.2 records it as the producer's rule, and it is the instant the
 * container's fixed DOS stamp means (3.6). This page uses the same value on
 * purpose: sealing the same document, with the same key and the same stated
 * metadata, produces the same bytes here as it does from the command line.
 *
 * @type {string}
 */
const NO_TIME_STATED = '1980-01-01T00:00:00Z';

/**
 * The default author name and summary, which are the producer's own words
 * (`producer/seal.js`). They are form defaults rather than imports, because this
 * page may not import `producer/**`; the form shows them as claims the user can
 * change, which is what they are.
 */
const DEFAULT_AUTHOR = 'unknown';
const DEFAULT_SUMMARY = 'Initial draft.';

/**
 * The checks that read provenance entries. Every one of them reads the log as a
 * whole, and the verifier stops at the first failure it reports, so an entry is
 * shown as judged only when all of them passed. The alternative would be to read
 * the prose of a failure detail for an entry number, and SPEC.md 10 says prose
 * may be reworded between releases while reason codes may not.
 *
 * @type {readonly string[]}
 */
const ENTRY_CHECKS = Object.freeze([
  'L0.PROVENANCE.PARSE',
  'L0.PROVENANCE.CANONICAL',
  'L0.PROVENANCE.FIELDS',
  'L0.PROVENANCE.EXTRA_FIELDS',
  'L0.PROVENANCE.NONEMPTY',
  'L0.PROVENANCE.CONTENT_HASH_FORMAT',
  'L1.PROVENANCE.FIRST_AUTHOR',
  'L1.PROVENANCE.KEYS',
  'L1.PROVENANCE.SIGNATURES',
  'L2.CHAIN.FIRST_PARENT_NULL',
  'L2.CHAIN.LINKS',
]);

/** @param {string} id @returns {HTMLElement} */
function byId(id) {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`editor/index.html has no element with id "${id}"`);
  return found;
}

/**
 * @param {string} tag
 * @param {string} [text]
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text !== '') node.textContent = text;
  if (className !== '') node.className = className;
  return node;
}

/** @param {HTMLElement} parent @param {HTMLElement[]} children */
function fill(parent, children) {
  parent.replaceChildren(...children);
}

/**
 * A short form of a digest or signature, for a table cell. The whole value is in
 * the cell's `title`, because shortening a value a reader may want to compare is
 * a display decision, not a claim.
 *
 * @param {string | null} hex
 * @returns {string}
 */
function shortDigest(hex) {
  if (hex === null) return '—';
  return hex.length <= 16 ? hex : `${hex.slice(0, 12)}…`;
}

/* --------------------------------- read ---------------------------------- */

/**
 * Everything the page knows about the file it is showing: the bytes, the name it
 * was read under, and the verdict. The verdict is the only thing this page
 * asserts about a file; every other pane is the file's own content, displayed.
 *
 * @type {{ name: string, bytes: Uint8Array, result: object } | null}
 */
let loaded = null;

/**
 * Show a file: verdict first, then what the file claims beside it.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {Promise<void>}
 */
async function loadBytes(bytes, name) {
  const result = await verify(bytes);
  loaded = { name, bytes, result };
  byId('empty').hidden = true;
  byId('shown').hidden = false;
  byId('document-name').textContent = `${name}  (${bytes.length} byte(s))`;
  renderVerdict(result);
  renderChecks(result);
  renderCaveats(result);
  renderJson(name, bytes, result);
  await renderContent(bytes);
  await renderEntries(bytes, result);
  seedWriteMode(bytes, name);
}

/**
 * The verdict, in the three sizes a reader needs: the word, the number of checks
 * behind it, and the reasons it is not `VERIFIED`.
 *
 * @param {object} result
 * @returns {void}
 */
function renderVerdict(result) {
  const summary = result.summary;
  const word = element('p', result.verdict, `verdict verdict-${result.verdict.toLowerCase()}`);
  const counts = element(
    'p',
    `${summary.total} checks: ${summary.pass} pass, ${summary.fail} fail, ${summary.unsupported} unsupported, ${summary.skip} skip  ·  exit code ${result.exit_code}`,
    'counts',
  );
  /** @type {HTMLElement[]} */
  const parts = [word, counts];

  if (result.verdict !== 'VERIFIED') {
    const reasons = result.checks
      .filter((check) => check.status === STATUS.FAIL || check.status === STATUS.UNSUPPORTED)
      .map((check) => `${check.id} (${check.reason_code})`);
    parts.push(
      element(
        'p',
        reasons.length > 0
          ? `what did not hold: ${reasons.join(', ')}`
          : 'nothing failed, and at least one requirement could not be established, so this file is unproven rather than broken',
        'reasons',
      ),
    );
  }
  fill(byId('verdict-pane'), parts);
}

/**
 * Every check, with the status and reason code the `--json` verdict carries.
 *
 * The detail and the requirement are one click away rather than in the list: the
 * list is what a reader scans, and a check's prose is what they read when a row
 * is the one they came for.
 *
 * @param {object} result
 * @returns {void}
 */
function renderChecks(result) {
  /** @type {HTMLElement[]} */
  const rows = [];
  for (const check of result.checks) {
    const row = element('li', '', `check check-${check.status.toLowerCase()}`);
    const head = element('p');
    head.append(
      element('span', check.status, 'status'),
      element('span', check.id, 'id'),
      element('span', check.reason_code, 'reason'),
      element('span', check.level, 'level'),
    );
    const more = element('details');
    more.append(
      element('summary', 'detail'),
      element('p', check.detail, 'detail'),
      element('p', `Requirement: ${check.requirement}`, 'requirement'),
    );
    row.append(head, more);
    rows.push(row);
  }
  fill(byId('checks'), rows);
  byId('checks-title').textContent = `Checks (${result.checks.length})`;
}

/**
 * What the verdict does not mean. These are not checks and they never affect the
 * exit code; they are printed with every verdict, because a reader who sees
 * `VERIFIED` should also see the boundary of the claim. This panel is not
 * decoration: `history-rewritten` is `VERIFIED` precisely because of what the
 * second statement says, and a page that hid it would be telling half the truth.
 *
 * @param {object} result
 * @returns {void}
 */
function renderCaveats(result) {
  /** @type {HTMLElement[]} */
  const rows = [];
  for (const caveat of result.limitations) {
    const row = element('li', '', 'caveat');
    row.append(element('p', caveat.id, 'caveat-id'), element('p', caveat.statement));
    rows.push(row);
  }
  fill(byId('caveats'), rows);
}

/**
 * The verdict in the exact shape `charter verify --json` prints, so a reader can
 * compare the page against the command line. Collapsed, because it is evidence
 * rather than reading matter.
 *
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {object} result
 * @returns {void}
 */
function renderJson(name, bytes, result) {
  const value = { file: name, bytes: bytes.length, ...result };
  fill(byId('json'), [element('pre', JSON.stringify(value, null, 2), 'json')]);
  byId('json-title').textContent = `The verdict as JSON (${result.checks.length} checks)`;
}

/* ------------------------- what the file claims --------------------------- */

/**
 * Read the three entries out of the container with the reader's own code.
 *
 * Nothing here decides anything: the container walk, the entry names, the log's
 * line splitting and the field rules are the verifier's, so what this page shows
 * cannot disagree with what the verdict above it says. The first entry of a
 * repeated name wins, which is the rule `verifier/verify.js` applies while it
 * checks the same file (SPEC.md 3.4), so the page and the verdict read one file.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ ok: true, files: Map<string, Uint8Array> } | { ok: false, reason_code: string, detail: string }>}
 */
async function readContainer(bytes) {
  const archive = parseArchive(bytes, LIMITS);
  if (!archive.ok) return { ok: false, reason_code: archive.reason_code, detail: archive.detail };
  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (const entry of archive.entries) {
    const read = await readEntryData(bytes, entry, LIMITS);
    if (read.ok && !files.has(entry.name)) files.set(entry.name, read.data);
  }
  return { ok: true, files };
}

/**
 * `content.md`, as text.
 *
 * The bytes are the content (SPEC.md 6), so they are decoded as UTF-8 and shown
 * literally: no Markdown parsing, no normalization, no rewriting. When they are
 * not UTF-8 the page says so and shows hex, because a verifier refuses those
 * bytes and a reader should see what was refused.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<void>}
 */
async function renderContent(bytes) {
  const pane = byId('content');
  const note = byId('content-note');
  const read = await readContainer(bytes);
  if (!read.ok) {
    note.textContent = '';
    fill(pane, [element('p', `the container could not be read, so there is no content to show (${read.reason_code}: ${read.detail})`, 'muted')]);
    return;
  }
  const content = read.files.get(ENTRY_CONTENT);
  if (content === undefined) {
    note.textContent = '';
    fill(pane, [element('p', `the archive holds no readable "${ENTRY_CONTENT}"`, 'muted')]);
    return;
  }
  const decoded = utf8Decode(content);
  if (decoded.ok) {
    fill(pane, [element('pre', decoded.text === '' ? '(the content is empty)' : decoded.text, 'content')]);
    note.textContent = `content.md, ${content.length} byte(s), shown as text. The format does not parse Markdown, and neither does this page.`;
    return;
  }
  fill(pane, [element('pre', toHex(content.subarray(0, 512)), 'content')]);
  note.textContent = `content.md, ${content.length} byte(s), is not valid UTF-8, so it is shown as hex. A verifier refuses these bytes.`;
}

/**
 * @param {object} result
 * @param {string} id
 * @returns {string | null}
 */
function statusOf(result, id) {
  const found = result.checks.find((check) => check.id === id);
  return found === undefined ? null : found.status;
}

/**
 * The provenance history: one row per line, with the fields the format defines.
 *
 * The marker on a row is not a second verdict. It says whether the verifier's
 * entry checks all passed, because those checks read the log as a whole and stop
 * at the first failure they report; a page that marked a single row would have
 * to read that failure's prose for an entry number, and SPEC.md 10 says prose
 * may be reworded between releases while reason codes may not.
 *
 * @param {Uint8Array} bytes
 * @param {object} result
 * @returns {Promise<void>}
 */
async function renderEntries(bytes, result) {
  const body = byId('entries');
  const note = byId('entries-note');
  const read = await readContainer(bytes);
  if (!read.ok) {
    fill(body, []);
    note.textContent = `the history could not be read out of the container (${read.reason_code}: ${read.detail})`;
    return;
  }
  const log = read.files.get(ENTRY_PROVENANCE);
  if (log === undefined) {
    fill(body, []);
    note.textContent = `the archive holds no readable "${ENTRY_PROVENANCE}"`;
    return;
  }
  const split = splitLines(log, LIMITS);
  if (!split.ok) {
    fill(body, []);
    note.textContent = `provenance.jsonl could not be split into entries (${split.reason_code}: ${split.detail})`;
    return;
  }

  const notPassing = ENTRY_CHECKS.map((id) => ({ id, status: statusOf(result, id) })).filter((check) => check.status !== STATUS.PASS);

  /** @type {HTMLElement[]} */
  const rows = [];
  for (const [index, line] of split.lines.entries()) {
    const row = element('tr');
    const parsed = parseLine(line, index + 1);
    const entry = parsed.ok ? readEntry(parsed.value, index + 1) : { ok: false, reason_code: parsed.reason_code, detail: parsed.detail };

    row.append(element('td', String(index + 1), 'index'));
    if (!entry.ok) {
      const cell = element('td', `${entry.reason_code}: ${entry.detail}`, 'defect');
      cell.colSpan = 6;
      row.append(cell);
    } else {
      row.append(element('td', entry.entry.action, 'action'));
      const author = element('td', `${entry.entry.author.name}  (${shortDigest(entry.entry.author.key_id)})`);
      author.title = entry.entry.author.key_id;
      row.append(author);
      const stamp = element('td', entry.entry.timestamp);
      stamp.title = 'a claim its signer made and signed: nothing in the format witnesses a time';
      row.append(stamp);
      const digest = element('td', shortDigest(entry.entry.content_sha256), 'digest');
      digest.title = entry.entry.content_sha256;
      if (index !== split.lines.length - 1) digest.append(element('span', '  not in this file', 'aside'));
      row.append(digest);
      const parent = element('td', shortDigest(entry.entry.parent), 'digest');
      if (entry.entry.parent !== null) parent.title = entry.entry.parent;
      row.append(parent);
      const signature = element('td', shortDigest(entry.entry.signature), 'digest');
      signature.title = `${entry.entry.signature.length} characters of unpadded base64url`;
      row.append(signature);
    }

    const state = element('td', '', 'state');
    if (notPassing.length === 0) {
      state.append(element('span', 'judged', 'status'));
    } else {
      state.append(
        element('span', 'not judged', 'status status-fail'),
        element('span', ` ${notPassing.map((check) => `${check.id} ${check.status}`).join(', ')}`, 'aside'),
      );
    }
    row.append(state);
    rows.push(row);
  }
  fill(body, rows);
  const count = split.lines.length;
  note.textContent =
    `${count} entr${count === 1 ? 'y' : 'ies'}. Every check that reads entries reads the whole log and the verifier stops at the first failure it reports, so a row is marked judged only when all of them passed. ` +
    "TIMESTAMPS_ARE_CLAIMS: every timestamp here was written and signed by its signer. INTERMEDIATE_CONTENT_HASHES: only the last entry's digest is bound to content.md; the bytes the others name are not in this file.";
}

/* --------------------------------- write --------------------------------- */

/** The text of the key file that was picked, if one was. Never sent anywhere. */
let keyFileText = '';

/**
 * The PEM text the form is offering: what was pasted, or failing that the file
 * that was picked. Nothing is remembered between visits and nothing is stored
 * anywhere — the value exists in this function, in the key that is loaded from
 * it, and in this page's memory until the page is closed.
 *
 * @returns {string}
 */
function keyTextFromForm() {
  const pasted = /** @type {HTMLTextAreaElement} */ (byId('w-key-text')).value;
  return pasted.trim() === '' ? keyFileText : pasted;
}

/**
 * A PKCS#8 PEM to DER.
 *
 * Only one form is accepted, and the message says which: an unencrypted PKCS#8
 * `PRIVATE KEY` block. `node:crypto` reads more — SEC1, PKCS#1, encrypted PEM —
 * and this page reads what Web Crypto can import, which is the DER inside this
 * one block. A key in another form is refused with MALFORMED rather than
 * half-parsed.
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
function pemToDer(text) {
  if (!/-----BEGIN PRIVATE KEY-----/.test(text)) {
    refuse(
      REASON.MALFORMED,
      'the key is not an unencrypted PKCS#8 PEM: this page reads a "-----BEGIN PRIVATE KEY-----" block and nothing else. `openssl genpkey -algorithm ed25519` and `charter keygen` both write one',
      'key',
    );
  }
  const body = text.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let binary;
  try {
    binary = atob(body);
  } catch {
    refuse(REASON.MALFORMED, 'the key block is not base64, so there is no DER inside it to load', 'key');
  }
  const der = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) der[at] = binary.charCodeAt(at);
  return der;
}

/**
 * Load the private key in the page and derive the name the format gives it.
 *
 * The public key comes out of the JWK Web Crypto exports for the private key,
 * which is the same 32 bytes `producer/key.js` takes from the tail of a
 * SubjectPublicKeyInfo structure: a shorter route to one value, not a second
 * definition of it. The key id comes from `deriveKeyId()`, the function
 * `L1.MANIFEST.KEY_ID` compares against, so a file sealed here cannot carry a
 * key id that does not derive from the key beside it.
 *
 * @param {string} text
 * @returns {Promise<{ key: CryptoKey, publicKey: Uint8Array, keyId: string }>}
 */
async function loadKeyInPage(text) {
  if (text.trim() === '') refuse(REASON.MISSING, 'no key was given, and a signature needs a private key', 'key');
  if (!hasWebCrypto() || typeof crypto.subtle.sign !== 'function' || typeof crypto.subtle.importKey !== 'function') {
    refuse(
      REASON.UNSUPPORTED_FEATURE,
      'this page has no Web Crypto signing, so nothing can be sealed here. Web Crypto needs a secure context: http://127.0.0.1 and http://localhost are one, and an http address on the local network is not',
      'key',
    );
  }
  const der = pemToDer(text);
  /** @type {CryptoKey} */
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', der, { name: ALGORITHM_NAME }, true, ['sign']);
  } catch (error) {
    const detail = error instanceof Error && typeof error.message === 'string' ? `${error.name}: ${error.message}` : 'the runtime gave no further detail';
    refuse(
      error instanceof Error && error.name === 'NotSupportedError' ? REASON.UNSUPPORTED_FEATURE : REASON.MALFORMED,
      `the key could not be loaded as an ${ALGORITHM_NAME} private key (${detail}). charter/0.1 defines one algorithm, and a seal with another would write a file this verifier refuses`,
      'key',
    );
  }

  /** @type {JsonWebKey} */
  let jwk;
  try {
    jwk = await crypto.subtle.exportKey('jwk', key);
  } catch (error) {
    const detail = error instanceof Error && typeof error.message === 'string' ? error.message : 'the runtime gave no further detail';
    refuse(REASON.MALFORMED, `the public key could not be read out of the private key (${detail})`, 'key');
  }
  if (typeof jwk.x !== 'string') {
    refuse(REASON.MALFORMED, 'this runtime exported no public key beside the private one, so the manifest could not carry the key a reader checks against', 'key');
  }
  const decoded = decodeBase64Url(jwk.x);
  if (!decoded.ok || decoded.value.length !== PUBLIC_KEY_BYTES) {
    refuse(REASON.MALFORMED, `the public key beside this private key is not ${PUBLIC_KEY_BYTES} bytes`, 'key');
  }
  const keyId = await deriveKeyId(decoded.value);
  if (keyId === null) refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so a key id could not be derived', 'key');
  return { key, publicKey: decoded.value, keyId };
}

/** The current time, in the one form this format carries (SPEC.md 5). */
function nowUtcSecond() {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/** Whether the stated time came from the "now" button rather than from typing. */
let timeFromClock = false;

/**
 * The time the seal will state — the command line's `--now`, `--created-at` and
 * neither, surfaced as three states a reader can see before sealing.
 *
 * @returns {{ created_at: string, stated: boolean, clock: boolean }}
 */
function chosenTime() {
  const stated = /** @type {HTMLInputElement} */ (byId('w-time-stated')).checked;
  if (!stated) return { created_at: NO_TIME_STATED, stated: false, clock: false };
  const text = /** @type {HTMLInputElement} */ (byId('w-time-text')).value.trim();
  if (!isIsoUtcSecond(text)) {
    refuse(
      REASON.MALFORMED,
      `the stated time is ${JSON.stringify(text)}, and charter/0.1 fixes the form: an ISO 8601 UTC date-time at second precision (YYYY-MM-DDTHH:MM:SSZ)`,
      'created_at',
    );
  }
  return { created_at: text, stated: true, clock: timeFromClock };
}

/** What the file will claim about time, said before it is written. */
function refreshTimeReadout() {
  const time = chosenTime();
  const readout = byId('w-time-readout');
  if (!time.stated) {
    readout.textContent = `the file will state no time: created_at and the entry's timestamp are ${NO_TIME_STATED}, the instant the container's fixed DOS stamp means (SPEC.md 15.2). No clock is read.`;
    return;
  }
  if (time.clock) {
    readout.textContent = `the file will claim ${time.created_at} — read from this machine's clock when the "now" button was pressed. That is the one clock this page reads.`;
    return;
  }
  readout.textContent = `the file will claim ${time.created_at}, as you stated it. Nothing here checked that this machine's clock agrees.`;
}

/**
 * Sign a message with the loaded key, in the page.
 *
 * Ed25519 signatures are deterministic, so the bytes this produces are the bytes
 * `producer/key.js` produces for the same message and the same key: a file
 * sealed here and one sealed by the command line, with the same content, key and
 * stated metadata, are the same file.
 *
 * @param {{ key: CryptoKey }} loadedKey
 * @param {Uint8Array} message
 * @returns {Promise<Uint8Array>}
 */
async function signatureOf(loadedKey, message) {
  let signature;
  try {
    signature = new Uint8Array(await crypto.subtle.sign({ name: ALGORITHM_NAME }, loadedKey.key, message));
  } catch (error) {
    const detail = error instanceof Error && typeof error.message === 'string' ? `${error.name}: ${error.message}` : 'the runtime gave no further detail';
    refuse(REASON.UNSUPPORTED_FEATURE, `this page could not sign the bytes a reader checks against (${detail})`);
  }
  if (signature.length !== SIGNATURE_BYTES) {
    refuse(REASON.MALFORMED, `the page produced a ${signature.length}-byte signature, and an Ed25519 signature is ${SIGNATURE_BYTES} bytes`);
  }
  return signature;
}

/**
 * Seal what the form holds: one document, one key, one entry (SPEC.md 15.1).
 *
 * The shape written here is the shape `seal` writes, and every rule it applies
 * comes from the format: the field lists and the key id derivation from
 * `verifier/manifest.js`, the canonical bytes and the signing input from
 * `verifier/canonical-write.js`, the container from `verifier/zip-write.js`, and
 * the limits from `verifier/limits.js`. What is not here is the producer's title
 * derivation, because that module is Node-side code this page may not import, so
 * the form states a title instead of guessing one.
 *
 * @returns {Promise<Uint8Array>}
 */
async function sealBytes() {
  const content = utf8Encode(/** @type {HTMLTextAreaElement} */ (byId('w-content')).value);
  if (content.length >= 3 && content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf) {
    refuse(
      REASON.NON_CANONICAL,
      'the content begins with a UTF-8 byte order mark, and charter/0.1 does not allow one (SPEC.md 6): the bytes of the file are the content, so a mark would be content too',
      ENTRY_CONTENT,
    );
  }
  const title = /** @type {HTMLInputElement} */ (byId('w-title')).value.trim();
  if (title === '') {
    refuse(REASON.MALFORMED, 'manifest.title is a non-empty string, so a title is needed. The producer derives one from the document (SPEC.md 15.3); this page takes the one you state', 'title');
  }
  const author = /** @type {HTMLInputElement} */ (byId('w-author')).value.trim();
  if (author === '') refuse(REASON.MALFORMED, 'manifest.author.name is a non-empty string, and this seal states none', 'author');
  const summary = /** @type {HTMLTextAreaElement} */ (byId('w-summary')).value;
  if (summary.trim() === '') refuse(REASON.MALFORMED, 'a provenance entry requires a non-empty summary, and this seal states none', 'summary');
  const time = chosenTime();
  const loadedKey = await loadKeyInPage(keyTextFromForm());

  const digest = await sha256(content);
  if (digest === null) refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so no digest of the content could be computed');
  const contentSha256 = toHex(digest);

  // The one entry: the chain starts where it says it starts.
  const entry = {
    action: 'create',
    author: { key_id: loadedKey.keyId, name: author },
    content_sha256: contentSha256,
    parent: null,
    summary,
    timestamp: time.created_at,
  };
  const entryBytes = canonicalDocument({ ...entry, signature: encodeBase64Url(await signatureOf(loadedKey, signingInput(entry, 'signature'))) });
  if (entryBytes.length > LIMITS.MAX_PROVENANCE_LINE_BYTES) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `the provenance entry would be ${entryBytes.length} bytes, above the declared limit of ${LIMITS.MAX_PROVENANCE_LINE_BYTES} for one line`,
      ENTRY_PROVENANCE,
    );
  }

  const unsigned = {
    author: {
      algorithm: ALGORITHM,
      key_id: loadedKey.keyId,
      name: author,
      public_key: encodeBase64Url(loadedKey.publicKey),
    },
    content: { sha256: contentSha256 },
    created_at: time.created_at,
    format: FORMAT,
    title,
  };
  const manifestBytes = canonicalDocument({ ...unsigned, signature: encodeBase64Url(await signatureOf(loadedKey, signingInput(unsigned, 'signature'))) });
  if (manifestBytes.length > LIMITS.MAX_JSON_DOCUMENT_BYTES) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `manifest.json would be ${manifestBytes.length} bytes, above the declared limit of ${LIMITS.MAX_JSON_DOCUMENT_BYTES} for one JSON document`,
      ENTRY_MANIFEST,
    );
  }

  return zipStore(
    [
      { name: ENTRY_MANIFEST, data: manifestBytes },
      { name: ENTRY_CONTENT, data: content },
      { name: ENTRY_PROVENANCE, data: entryBytes },
    ],
    LIMITS,
  );
}

/**
 * Hand the bytes to the browser as a file.
 *
 * A blob URL belonging to this page: no request leaves it, and the object URL is
 * released as soon as the download has been started.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {void}
 */
function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * The name to offer the file under: the name it was read under, with the
 * format's extension. This is the name of a download, not a claim: the
 * manifest's `title` is the claim, and the form states it.
 *
 * @returns {string}
 */
function outputName() {
  const stem = loaded === null ? 'document' : loaded.name.replace(/\.[^./\\]+$/, '');
  return `${stem.trim() === '' ? 'document' : stem}.charter`;
}

/** Seal on a click, and say what happened. */
async function runSeal() {
  const message = byId('w-message');
  message.className = 'message';
  message.textContent = 'sealing…';
  try {
    const bytes = await sealBytes();
    const name = outputName();
    download(bytes, name);
    await loadBytes(bytes, name);
    message.className = 'message message-done';
    message.textContent = `sealed ${bytes.length} byte(s) and offered them as "${name}". The verdict above is for those bytes, read back out of what was written rather than out of the downloaded copy. Verify that copy with \`charter verify ${name}\`.`;
  } catch (error) {
    if (!(error instanceof RefusalError)) throw error;
    message.className = 'message message-fail';
    message.textContent = `${error.reason_code}  ${error.detail}`;
  }
}

/**
 * Seed the write form from the document that was just read, so that sealing an
 * edited copy of a file does not start from an empty page. The content field is
 * the bytes decoded as text; a document that is not UTF-8 seeds nothing, and the
 * form says why when it is sealed.
 *
 * @param {Uint8Array} bytes
 * @param {string} name
 * @returns {void}
 */
function seedWriteMode(bytes, name) {
  void (async () => {
    const container = await readContainer(bytes);
    if (!container.ok) return;
    const content = container.files.get(ENTRY_CONTENT);
    if (content !== undefined) {
      const decoded = utf8Decode(content);
      /** @type {HTMLTextAreaElement} */ (byId('w-content')).value = decoded.ok ? decoded.text : '';
    }
    const manifest = container.files.get(ENTRY_MANIFEST);
    if (manifest !== undefined) {
      const decoded = utf8Decode(manifest);
      if (decoded.ok) {
        const parsed = parseJsonText(decoded.text);
        if (parsed.ok && typeof parsed.value === 'object' && parsed.value !== null) {
          const title = /** @type {Record<string, unknown>} */ (parsed.value).title;
          if (typeof title === 'string') /** @type {HTMLInputElement} */ (byId('w-title')).value = title;
        }
      }
    }
    byId('w-seeded').textContent = `seeded from ${name}`;
  })();
}

/** @type {number} */
let keyReadoutToken = 0;

/** Say which key the form is holding, by the name the format derives from it. */
async function refreshKeyReadout() {
  const readout = byId('w-key-readout');
  const text = keyTextFromForm();
  if (text.trim() === '') {
    readout.textContent = 'no key yet: choose a PKCS#8 PEM file or paste one. It is read in this page, kept in memory, and stored nowhere.';
    return;
  }
  const token = (keyReadoutToken += 1);
  try {
    const loadedKey = await loadKeyInPage(text);
    if (token !== keyReadoutToken) return;
    readout.textContent = `key id ${loadedKey.keyId}  ·  ${PUBLIC_KEY_BYTES} bytes of public key, read out of the private key in this page`;
  } catch (error) {
    if (!(error instanceof RefusalError)) throw error;
    if (token !== keyReadoutToken) return;
    readout.textContent = `${error.reason_code}  ${error.detail}`;
  }
}

/* -------------------------------- the page -------------------------------- */

/**
 * Show a file the reader chose or dropped. `File.arrayBuffer()` reads bytes the
 * browser has already handed this page: no request is made for them.
 *
 * @param {File} file
 * @returns {Promise<void>}
 */
async function showFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadBytes(bytes, file.name);
}

/** Wire the read pane: a file input, a drop target, and nothing else. */
function wireRead() {
  const input = /** @type {HTMLInputElement} */ (byId('file'));
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file !== undefined) void showFile(file);
  });
  const zone = byId('dropzone');
  zone.addEventListener('dragover', (event) => {
    event.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    const file = event.dataTransfer?.files?.[0];
    if (file !== undefined) void showFile(file);
  });
}

/** Wire the write pane. */
function wireWrite() {
  byId('w-time-now').addEventListener('click', () => {
    timeFromClock = true;
    /** @type {HTMLInputElement} */ (byId('w-time-stated')).checked = true;
    /** @type {HTMLInputElement} */ (byId('w-time-text')).value = nowUtcSecond();
    refreshTimeReadout();
  });
  byId('w-time-text').addEventListener('input', () => {
    timeFromClock = false;
    /** @type {HTMLInputElement} */ (byId('w-time-stated')).checked = true;
    refreshTimeReadout();
  });
  for (const id of ['w-time-none', 'w-time-stated']) byId(id).addEventListener('change', refreshTimeReadout);

  const keyFile = /** @type {HTMLInputElement} */ (byId('w-key-file'));
  keyFile.addEventListener('change', () => {
    void (async () => {
      const file = keyFile.files?.[0];
      keyFileText = file === undefined ? '' : await file.text();
      await refreshKeyReadout();
    })();
  });
  byId('w-key-text').addEventListener('input', () => void refreshKeyReadout());
  byId('seal').addEventListener('click', () => void runSeal());
}

/**
 * Start the editor. The page calls this once, from its own module script.
 *
 * @returns {void}
 */
export function start() {
  /** @type {HTMLInputElement} */ (byId('w-author')).value = DEFAULT_AUTHOR;
  /** @type {HTMLTextAreaElement} */ (byId('w-summary')).value = DEFAULT_SUMMARY;
  wireRead();
  wireWrite();
  refreshTimeReadout();
  void refreshKeyReadout();
}
