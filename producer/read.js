/**
 * Reading what a `.charter` file claims, without judging it.
 *
 * `cite` and `inspect` have to say what a file says. They do not decide whether
 * what it says is true — that is `verify`'s job, and a second opinion about the
 * bytes is the one thing this project must not grow. So this module composes the
 * *reader* modules the verifier itself composes, in the order the verifier
 * composes them: the container, then the manifest, then the log. Where it cannot
 * read something, it says which thing, with the reason code that reader
 * produced, and stops, because a claim the producer could not read is not one it
 * repeats.
 *
 * Nothing here checks a signature, a canonical byte sequence, a digest, or the
 * chain. A file whose manifest signature is wrong carries the same claims as one
 * whose signature is right, and this module reports both the same way, because
 * the claims are the same: what differs is whether they are true. Keeping that
 * difference out of this module is what makes `inspect` safe to read.
 *
 * @module producer/read
 */

import { parseJsonBytes } from '../verifier/canonical.js';
import { LIMITS } from '../verifier/limits.js';
import { readManifest } from '../verifier/manifest.js';
import { splitLines } from '../verifier/provenance.js';
import { REASON } from '../verifier/status.js';
import { ENTRY_CONTENT, ENTRY_MANIFEST, ENTRY_PROVENANCE } from '../verifier/verify.js';
import { parseArchive, readEntryData } from '../verifier/zip.js';

/**
 * Read an artifact down to the bytes it is made of.
 *
 * This is the same walk `readCharter` makes, in the same order and through the
 * same reader modules, for a caller that has to *write* what it read rather than
 * describe it: `edit` copies the earlier lines of the log byte for byte and
 * commits to the line before it, so it needs the bytes and not only the claims.
 * It is not a second opinion about the file — nothing here judges a signature, a
 * digest, or the chain either — and there is no second copy of the reading order.
 *
 * An artifact with a shape charter/0.1 gives no rule to is still readable here,
 * and the shape is reported: `unknown_field` names the field the format has no
 * rule for, or is null.
 *
 * @param {Uint8Array} bytes
 * @param {typeof LIMITS} [limits]
 * @returns {Promise<{ ok: true, manifest: object, unknown_field: string | null, manifest_bytes: Uint8Array, content: Uint8Array | null, provenance_bytes: Uint8Array | null, entry_names: string[] }
 *   | { ok: false, reason_code: string, detail: string }>}
 */
export async function readCharterParts(bytes, limits = LIMITS) {
  const archive = parseArchive(bytes, limits);
  if (!archive.ok) return { ok: false, reason_code: archive.reason_code, detail: archive.detail };

  /** @type {Map<string, Uint8Array>} */
  const files = new Map();
  for (const entry of archive.entries) {
    const read = await readEntryData(bytes, entry, limits);
    if (read.ok && !files.has(entry.name)) files.set(entry.name, read.data);
  }

  const manifestBytes = files.get(ENTRY_MANIFEST);
  if (manifestBytes === undefined) {
    return {
      ok: false,
      reason_code: REASON.MISSING,
      detail: `the archive holds no readable "${ENTRY_MANIFEST}", so this file says nothing about itself`,
    };
  }
  const parsed = parseJsonBytes(manifestBytes, { limits });
  if (!parsed.ok) {
    return { ok: false, reason_code: parsed.reason_code, detail: `manifest.json could not be read: ${parsed.detail}` };
  }
  const manifest = readManifest(parsed.value);
  if (!manifest.ok) {
    return { ok: false, reason_code: manifest.reason_code, detail: `${manifest.path}: ${manifest.detail}` };
  }

  return {
    ok: true,
    manifest: manifest.manifest,
    unknown_field: manifest.unknown_field,
    manifest_bytes: manifestBytes,
    content: files.get(ENTRY_CONTENT) ?? null,
    provenance_bytes: files.get(ENTRY_PROVENANCE) ?? null,
    entry_names: archive.entries.map((entry) => entry.name),
  };
}


/**
 * Read the claims out of an artifact.
 *
 * The entry map keeps the first entry of a repeated name, exactly as
 * `verifier/verify.js` does while it checks the same file. Which entry a reader
 * would see is a property of the format, not of the program reading it, so the
 * two must answer it the same way — `L0.ZIP.ENTRY_SET` is the check that
 * refuses a repeated name, and it is the verifier's to report.
 *
 * @param {Uint8Array} bytes
 * @param {typeof LIMITS} [limits]
 * @returns {Promise<{ ok: true, claims: object, content: Uint8Array | null }
 *   | { ok: false, reason_code: string, detail: string }>}
 */
export async function readCharter(bytes, limits = LIMITS) {
  const parts = await readCharterParts(bytes, limits);
  if (!parts.ok) return parts;

  let entries = null;
  if (parts.provenance_bytes !== null) {
    const split = splitLines(parts.provenance_bytes, limits);
    entries = split.ok ? split.lines.length : null;
  }

  return {
    ok: true,
    content: parts.content,
    claims: Object.freeze({
      format: parts.manifest.format,
      title: parts.manifest.title,
      created_at: parts.manifest.created_at,
      author_name: parts.manifest.author.name,
      author_key_id: parts.manifest.author.key_id,
      content_sha256: parts.manifest.content.sha256,
      entries,
    }),
  };
}
