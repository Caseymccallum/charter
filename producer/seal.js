/**
 * `seal`: one document and one key become one artifact.
 *
 * This is the writing half of the format — a reference implementation of
 * everything `verifier/**` refuses when it is wrong. It shares this project's
 * specification with the verifier on purpose, and it shares code where two
 * implementations must not be allowed to disagree:
 *
 *   - the manifest and every provenance line are written with
 *     `canonicalDocument()`, so a sealed file cannot be non-canonical;
 *   - the bytes a signature covers come from `signingInput()`, the same function
 *     `verifier/manifest.js` and `verifier/provenance.js` call, so the two halves
 *     agree about a signing input by construction rather than by review;
 *   - the key id comes from `deriveKeyId()`, the function
 *     `L1.MANIFEST.KEY_ID` compares against, so a sealed file cannot carry a
 *     key id that does not derive from the key beside it;
 *   - the action, the timestamp form, and the digest encodings come from the
 *     reader's own vocabulary and validators, so the producer has no private set
 *     of names to drift from.
 *
 * # The producer does not grade its own homework
 *
 * `seal` does not call `verify()` on what it just wrote. It would be cheap, and
 * it would hide the one thing worth finding: two implementations of one
 * specification that disagree. The agreement is asserted where it is evidence —
 * in `test/producer.test.js`, which seals and then asks the verifier, through the
 * committed command line. A producer that checked itself would turn "the
 * verifier refuses a file the producer wrote" into an exception inside the
 * producer: the same bug with the evidence removed.
 *
 * # Every byte comes from an argument
 *
 * A record has to be the same record when it is written twice, or fixtures are
 * not reproducible and a conformance run is not stable. Section 3.6 already
 * removes the clock from the container for exactly this reason, and this module
 * removes it from the writing as well: nothing here reads a clock, a file, or a
 * random source. `created_at` is an argument, and when it is not given the file
 * states no time — `NO_TIME_STATED`, the same instant the container's fixed DOS
 * stamp means — instead of a time the producer made up. `--now` on the command
 * line is where a clock is read, by the one file allowed to read one.
 *
 * @module producer/seal
 */

import { canonicalDocument, signingInput } from '../verifier/canonical-write.js';
import { toHex, utf8Decode } from '../verifier/bytes.js';
import { sha256 } from '../verifier/digest.js';
import { LIMITS } from '../verifier/limits.js';
import { ALGORITHM, FORMAT } from '../verifier/manifest.js';
import { isIsoUtcSecond } from '../verifier/schema.js';
import { REASON } from '../verifier/status.js';
import { ENTRY_CONTENT, ENTRY_MANIFEST, ENTRY_PROVENANCE } from '../verifier/verify.js';
import { encodeBase64Url } from './base64url.js';
import { refuse } from './errors.js';
import { loadKey, signBytes } from './key.js';
import { deriveTitle, titleFromPath, TITLE_ORIGINS } from './title.js';
import { zipStore } from './zip-write.js';

/**
 * The instant a sealed file states when the person sealing stated no time:
 * 1980-01-01T00:00:00Z, which is the earliest instant a DOS date field can hold
 * and the value `L0.ZIP.METADATA` requires in every entry. A file that states no
 * time says so in both places rather than only in one.
 */
export const NO_TIME_STATED = '1980-01-01T00:00:00Z';

/**
 * The author name a sealed file carries when none was given. The manifest
 * requires a non-empty name, and the producer's job is to write down what it was
 * told rather than to guess at a person's name, so it writes down that it was
 * told nothing.
 */
export const NO_NAME_STATED = 'unknown';

/** The first entry's summary when none was given: what a seal does, in four words. */
export const DEFAULT_SUMMARY = 'Initial draft.';

/**
 * The one action a seal writes. `verifier/provenance.js` defines two, `create`
 * and `edit`; a seal begins a history, and writing later entries is a verb this
 * producer does not have yet.
 */
export const FIRST_ACTION = 'create';

const BOM = Object.freeze([0xef, 0xbb, 0xbf]);

/**
 * Seal a document.
 *
 * @param {object} request
 * @param {Uint8Array} request.content the bytes of the document
 * @param {string} request.key the private key, as PEM text
 * @param {string} [request.content_name] the path the content was read from, for the title of last resort
 * @param {string} [request.title] a stated title, which wins over a derived one
 * @param {string} [request.author] a stated author name
 * @param {string} [request.created_at] a stated time; without one the file states no time
 * @param {string} [request.summary] a stated summary for the first entry
 * @param {{ limits?: typeof LIMITS }} [options]
 * @returns {Promise<{ bytes: Uint8Array, manifest_bytes: Uint8Array, provenance_bytes: Uint8Array, claims: object }>}
 */
export async function seal(request, options = {}) {
  const limits = options.limits ?? LIMITS;

  checkContent(request.content);
  const title = decideTitle(request, request.content);
  const time = decideTime(request.created_at);
  const name = decideName(request.author);
  const summary = decideSummary(request.summary);
  const loaded = await loadKey(request.key);

  const digest = await sha256(request.content);
  if (digest === null) {
    refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so no digest of the content could be computed');
  }
  const contentSha256 = toHex(digest);

  // The one entry: the chain starts where it says it starts.
  const entry = {
    action: FIRST_ACTION,
    author: { key_id: loaded.key_id, name },
    content_sha256: contentSha256,
    parent: null,
    summary,
    timestamp: time.created_at,
  };
  const entryLine = canonicalDocument({ ...entry, signature: encodeBase64Url(signBytes(loaded, signingInput(entry, 'signature'))) });
  if (entryLine.length > limits.MAX_PROVENANCE_LINE_BYTES) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `the provenance entry would be ${entryLine.length} bytes, above the declared limit of ${limits.MAX_PROVENANCE_LINE_BYTES} for one line`,
      ENTRY_PROVENANCE,
    );
  }

  const unsigned = {
    author: {
      algorithm: ALGORITHM,
      key_id: loaded.key_id,
      name,
      public_key: encodeBase64Url(loaded.public_key),
    },
    content: { sha256: contentSha256 },
    created_at: time.created_at,
    format: FORMAT,
    title: title.title,
  };
  const manifestBytes = canonicalDocument({ ...unsigned, signature: encodeBase64Url(signBytes(loaded, signingInput(unsigned, 'signature'))) });
  if (manifestBytes.length > limits.MAX_JSON_DOCUMENT_BYTES) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `manifest.json would be ${manifestBytes.length} bytes, above the declared limit of ${limits.MAX_JSON_DOCUMENT_BYTES} for one JSON document`,
      ENTRY_MANIFEST,
    );
  }

  const bytes = zipStore(
    [
      { name: ENTRY_MANIFEST, data: manifestBytes },
      { name: ENTRY_CONTENT, data: request.content },
      { name: ENTRY_PROVENANCE, data: entryLine },
    ],
    limits,
  );

  return Object.freeze({
    bytes,
    manifest_bytes: manifestBytes,
    provenance_bytes: entryLine,
    claims: Object.freeze({
      format: FORMAT,
      title: title.title,
      title_origin: title.origin,
      created_at: time.created_at,
      time_stated: time.stated,
      author_name: name,
      key_id: loaded.key_id,
      public_key: encodeBase64Url(loaded.public_key),
      content_sha256: contentSha256,
      action: FIRST_ACTION,
      summary,
      entries: 1,
    }),
  });
}

/**
 * Refuse content this format cannot carry, before any of it is written.
 *
 * The two conditions are the ones `L0.CONTENT.UTF8` decides, with that check's
 * own reason codes: bytes that are not UTF-8, and a byte order mark. The rule is
 * the same in both directions — the bytes of the file are the content — so a
 * producer that wrote either would be writing a file its own verifier refuses.
 *
 * @param {Uint8Array} content
 * @returns {void}
 */
function checkContent(content) {
  if (!(content instanceof Uint8Array)) {
    refuse(REASON.MALFORMED, `content.md is bytes, and this call was handed ${typeof content}`);
  }
  const decoded = utf8Decode(content);
  if (!decoded.ok) {
    refuse(
      REASON.DECODE_ERROR,
      `content.md would be ${content.length} bytes that are not valid UTF-8, and the bytes of the file are the content: charter/0.1 will not write bytes a reader must refuse`,
      ENTRY_CONTENT,
    );
  }
  const hasBom = content.length >= BOM.length && BOM.every((value, index) => content[index] === value);
  if (hasBom) {
    refuse(
      REASON.NON_CANONICAL,
      'content.md begins with a UTF-8 byte order mark, and charter/0.1 does not allow one: the bytes of the file are the content, so a mark would be content too',
      ENTRY_CONTENT,
    );
  }
}

/**
 * The title the manifest will carry, and where it came from.
 *
 * A stated title wins over a derived one, because the person sealing knows what
 * they are sealing and a derivation only knows what it found. When nothing is
 * stated the title is derived from the captured bytes and reported as derived,
 * and when the capture carries none the file's own name is used and reported as
 * that. The manifest's `title` is a claim either way; what differs is whether a
 * reader can check the claim against the bytes it names.
 *
 * @param {object} request
 * @param {Uint8Array} content
 * @returns {{ title: string, origin: string }}
 */
function decideTitle(request, content) {
  if (request.title !== undefined) {
    if (typeof request.title !== 'string' || request.title.trim() === '') {
      refuse(REASON.MALFORMED, 'the title stated for this seal is empty, and manifest.title is a non-empty string', 'title');
    }
    return { title: request.title.trim(), origin: TITLE_ORIGINS.STATED };
  }
  const derived = deriveTitle(content);
  if (derived !== null) return { title: derived.title, origin: derived.origin };
  return { title: titleFromPath(request.content_name ?? ''), origin: TITLE_ORIGINS.FILE_NAME };
}

/**
 * The time the sealed file will state, or the value that means no time.
 *
 * @param {string | undefined} createdAt
 * @returns {{ created_at: string, stated: boolean }}
 */
function decideTime(createdAt) {
  if (createdAt === undefined) return { created_at: NO_TIME_STATED, stated: false };
  if (typeof createdAt !== 'string' || !isIsoUtcSecond(createdAt)) {
    refuse(
      REASON.MALFORMED,
      `the stated time is ${JSON.stringify(createdAt)}, and charter/0.1 fixes the form: an ISO 8601 UTC date-time at second precision (YYYY-MM-DDTHH:MM:SSZ)`,
      'created_at',
    );
  }
  return { created_at: createdAt, stated: true };
}

/**
 * @param {string | undefined} name
 * @returns {string}
 */
function decideName(name) {
  if (name === undefined) return NO_NAME_STATED;
  if (typeof name !== 'string' || name.trim() === '') {
    refuse(REASON.MALFORMED, 'the author name stated for this seal is empty, and the manifest requires a non-empty name', 'author');
  }
  return name.trim();
}

/**
 * @param {string | undefined} summary
 * @returns {string}
 */
function decideSummary(summary) {
  if (summary === undefined) return DEFAULT_SUMMARY;
  if (typeof summary !== 'string' || summary.trim() === '') {
    refuse(REASON.MALFORMED, 'the summary stated for this seal is empty, and a provenance entry requires a non-empty summary', 'summary');
  }
  return summary;
}

