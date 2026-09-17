/**
 * `edit`: a later revision of a document, appended to the history it belongs to.
 *
 * `seal` begins a chain and this writes the next entry in one, which is the
 * other half of what the format is for: a document that carries its own edit
 * history is only a promise until something can write a history longer than one
 * entry. The entry this writes is the one `verifier/provenance.js` calls `edit`,
 * and every byte of it comes from a rule the reader already owns:
 *
 *   - `parent` is the digest of the line before it *as that line stands in the
 *     file* — the same expression the link check in `verifier/verify.js` uses —
 *     so the chain the producer writes is the chain the verifier walks rather
 *     than a second reading of section 9;
 *   - the earlier lines of the log are copied byte for byte. An edit adds a line
 *     and does not reflow one: a re-serialized line would still verify, and it
 *     would no longer be the bytes the entry before it was written with;
 *   - the key id comes from `deriveKeyId()`, the canonical bytes from
 *     `canonicalDocument()`, and the signed bytes from `signingInput()`, as in
 *     `seal`;
 *   - the manifest is written from the values the artifact already carries, with
 *     `content.sha256` moved to the new revision. An edit does not re-declare the
 *     title, the author name, the stated time, or the key unless the person
 *     editing states them.
 *
 * # An edit does not require a verdict
 *
 * `seal` refuses what it cannot write, and this refuses what it cannot *append
 * to*: an artifact it cannot read, a log with no line to commit to, a format this
 * build does not implement, and a key that is not the key the artifact carries.
 * It does not ask whether the file it was handed is true. The entry it writes
 * commits to the bytes that are there, so an honest account of a file somebody
 * else wrote does not become dishonest because that file was already broken —
 * and a producer that ran the verifier over its input would be a second verifier,
 * which is the one thing this project must not grow. `verify` is the command that
 * answers whether the input was true.
 *
 * # Every byte comes from an argument
 *
 * As in `seal`: nothing here reads a clock, a file, or a random source. A stated
 * time is used, and when none is stated the entry carries `NO_TIME_STATED` — the
 * same instant `seal` writes and the same one the container's fixed DOS stamp
 * means. That instant can precede the entry before it, and that is deliberate:
 * section 11 says nothing in an artifact witnesses time, `entry-with-earlier-
 * timestamp` is a case that must come back VERIFIED, and a writer given a rule
 * the reader does not have would refuse what the format accepts.
 *
 * @module producer/edit
 */

import { encodeBase64Url } from '../verifier/base64url-write.js';
import { concat, toHex } from '../verifier/bytes.js';
import { canonicalDocument, LF, signingInput } from '../verifier/canonical-write.js';
import { sha256 } from '../verifier/digest.js';
import { LIMITS } from '../verifier/limits.js';
import { ALGORITHM, FORMAT } from '../verifier/manifest.js';
import { splitLines } from '../verifier/provenance.js';
import { REASON } from '../verifier/status.js';
import { ENTRY_CONTENT, ENTRY_MANIFEST, ENTRY_PROVENANCE } from '../verifier/verify.js';
import { zipStore } from '../verifier/zip-write.js';
import { refuse } from './errors.js';
import { loadKey, signBytes } from './key.js';
import { readCharterParts } from './read.js';
import { checkContent, decideName, decideSummary, decideTime, statedTitle } from './seal.js';

/**
 * The action a later entry carries. The name comes from the reader's own
 * vocabulary, `ACTIONS`, and the test beside this module says so.
 */
export const LATER_ACTION = 'edit';

/**
 * What a later entry's summary says when nobody stated one.
 *
 * A seal's default describes what a seal is — "Initial draft." — because that is
 * the fact. An edit's default records the absence instead: nobody said what
 * changed, and a summary this producer invented would be a sentence in a signed
 * record that no signer wrote.
 */
export const NO_SUMMARY_STATED = 'No summary stated.';

/**
 * The three entries a charter/0.1 file holds. Section 3 defines the set, and the
 * check that owns it (`L0.ZIP.ENTRY_SET`) reports `EXTRA` and `DUPLICATE` for the
 * two ways an archive can disagree with it; the producer refuses the same two
 * shapes with the same two codes, for a reason of its own: it copies the entries
 * it read, so a fourth entry or a second copy of one name would have to be
 * dropped or chosen between.
 */
const CHARTER_ENTRIES = Object.freeze([ENTRY_MANIFEST, ENTRY_CONTENT, ENTRY_PROVENANCE]);

/**
 * Append one signed revision to an artifact.
 *
 * @param {object} request
 * @param {Uint8Array} request.artifact the `.charter` file being extended
 * @param {Uint8Array} request.content the bytes of the new revision of the document
 * @param {string} request.key the private key, as PEM text
 * @param {string} [request.title] a stated title; without one the artifact keeps the title it carries
 * @param {string} [request.author] a stated name for the new entry; without one the artifact's own name is used
 * @param {string} [request.created_at] a stated time for the new entry; without one the entry states no time
 * @param {string} [request.summary] a stated summary for the new entry
 * @param {{ limits?: typeof LIMITS }} [options]
 * @returns {Promise<{ bytes: Uint8Array, manifest_bytes: Uint8Array, provenance_bytes: Uint8Array, claims: object }>}
 */
export async function edit(request, options = {}) {
  const limits = options.limits ?? LIMITS;

  // What the artifact is, before anything is written. The reading order here is
  // `producer/read.js`'s, and it is `verifier/verify.js`'s: container, manifest,
  // log. Nothing here judges what it read.
  const parts = await readCharterParts(request.artifact, limits);
  if (!parts.ok) {
    refuse(parts.reason_code, `the artifact could not be read, so there is nothing to append to: ${parts.detail}`, ENTRY_MANIFEST);
  }
  if (parts.manifest.format !== FORMAT) {
    refuse(
      REASON.UNSUPPORTED_FEATURE,
      `the artifact declares format ${JSON.stringify(parts.manifest.format)}, and this producer writes ${FORMAT}; extending a version it does not implement would be writing a file it cannot check`,
    );
  }
  if (parts.unknown_field !== null) {
    refuse(
      REASON.UNKNOWN_FIELD,
      `manifest.json holds ${parts.unknown_field}, and charter/0.1 gives no rule to that shape; writing this file back would silently drop a field it carries`,
      ENTRY_MANIFEST,
    );
  }
  const unexpected = parts.entry_names.find((name) => !CHARTER_ENTRIES.includes(name));
  if (unexpected !== undefined) {
    refuse(
      REASON.EXTRA,
      `the archive holds "${unexpected}", and a charter/0.1 file holds exactly ${CHARTER_ENTRIES.join(', ')}; an edit copies the entries it read, so this one would have to be dropped`,
      ENTRY_MANIFEST,
    );
  }
  const repeated = parts.entry_names.find((name, index) => parts.entry_names.indexOf(name) !== index);
  if (repeated !== undefined) {
    refuse(
      REASON.DUPLICATE,
      `the archive holds "${repeated}" more than once, and a charter/0.1 file holds each of its three entries once; an edit copies the entries it read, so it would have to choose one of them`,
      ENTRY_MANIFEST,
    );
  }
  if (parts.content === null) {
    refuse(REASON.MISSING, `the artifact holds no readable ${ENTRY_CONTENT}, so there is no revision to add to`, ENTRY_CONTENT);
  }
  if (parts.provenance_bytes === null) {
    refuse(REASON.MISSING, `the artifact holds no readable ${ENTRY_PROVENANCE}, so there is no history to append to`, ENTRY_PROVENANCE);
  }
  const split = splitLines(parts.provenance_bytes, limits);
  if (!split.ok) {
    refuse(
      split.reason_code,
      `the artifact's history could not be read, and a later entry commits to the line before it: ${split.detail}`,
      ENTRY_PROVENANCE,
    );
  }
  if (split.lines.length === 0) {
    refuse(
      REASON.MISSING,
      'the artifact\'s history holds no entry, so there is no line to commit to: an empty log is a file that records nothing',
      ENTRY_PROVENANCE,
    );
  }

  checkContent(request.content);
  const time = decideTime(request.created_at);
  const loaded = await loadKey(request.key, request.passphrase);

  // One key per artifact: section 8 says an entry naming a key nobody can check
  // is an entry that proves nothing, and `L1.PROVENANCE.KEYS` is the check that
  // refuses it. A producer that holds the key knows its name, so it can refuse
  // to write the entry rather than write one a reader can only reject.
  const carried = parts.manifest.author.key_id;
  if (loaded.key_id !== carried) {
    refuse(
      REASON.MISMATCH,
      `the key named here is ${loaded.key_id}, and the artifact carries ${carried}: every entry of a charter/0.1 file names the one key the file carries, so an entry signed with any other key is an entry a reader cannot check`,
      ENTRY_PROVENANCE,
    );
  }

  const name = decideName(request.author, parts.manifest.author.name);
  const summary = decideSummary(request.summary, NO_SUMMARY_STATED);
  const stated = statedTitle(request.title);
  const title = stated ?? parts.manifest.title;

  const digest = await sha256(request.content);
  if (digest === null) {
    refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so no digest of the content could be computed');
  }
  const contentSha256 = toHex(digest);

  // The chain link, computed the way the link check computes it: the line as it
  // stands in the file, and the one LF that closes it.
  const previous = split.lines[split.lines.length - 1];
  const parent = await sha256(concat([previous, LF]));
  if (parent === null) {
    refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so the line this entry commits to could not be hashed');
  }

  const entry = {
    action: LATER_ACTION,
    author: { key_id: loaded.key_id, name },
    content_sha256: contentSha256,
    parent: toHex(parent),
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

  // The manifest, with the head moved to the revision this entry signs over. The
  // key fields are the ones the artifact carries rather than the ones this call
  // holds, because an edit does not re-declare who the signer is — and the check
  // above is what makes those two the same key.
  const unsigned = {
    author: {
      algorithm: ALGORITHM,
      key_id: carried,
      name: parts.manifest.author.name,
      public_key: parts.manifest.author.public_key,
    },
    content: { sha256: contentSha256 },
    created_at: parts.manifest.created_at,
    format: FORMAT,
    title,
  };
  const manifestBytes = canonicalDocument({ ...unsigned, signature: encodeBase64Url(signBytes(loaded, signingInput(unsigned, 'signature'))) });
  if (manifestBytes.length > limits.MAX_JSON_DOCUMENT_BYTES) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `manifest.json would be ${manifestBytes.length} bytes, above the declared limit of ${limits.MAX_JSON_DOCUMENT_BYTES} for one JSON document`,
      ENTRY_MANIFEST,
    );
  }

  // The earlier lines are not re-serialized, re-signed, or dropped: they are the
  // bytes the file already held, and the new line follows the last of them.
  const provenanceBytes = concat([parts.provenance_bytes, entryLine]);

  const bytes = zipStore(
    [
      { name: ENTRY_MANIFEST, data: manifestBytes },
      { name: ENTRY_CONTENT, data: request.content },
      { name: ENTRY_PROVENANCE, data: provenanceBytes },
    ],
    limits,
  );

  return Object.freeze({
    bytes,
    manifest_bytes: manifestBytes,
    provenance_bytes: provenanceBytes,
    claims: Object.freeze({
      format: FORMAT,
      title,
      title_stated: stated !== undefined,
      created_at: parts.manifest.created_at,
      author_name: name,
      author_name_stated: request.author !== undefined,
      key_id: loaded.key_id,
      content_sha256: contentSha256,
      previous_content_sha256: parts.manifest.content.sha256,
      action: LATER_ACTION,
      summary,
      summary_stated: request.summary !== undefined,
      timestamp: time.created_at,
      time_stated: time.stated,
      parent: toHex(parent),
      entries: split.lines.length + 1,
      entries_before: split.lines.length,
    }),
  });
}

