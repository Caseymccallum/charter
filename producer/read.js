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

  const logBytes = files.get(ENTRY_PROVENANCE);
  let entries = null;
  if (logBytes !== undefined) {
    const split = splitLines(logBytes, limits);
    entries = split.ok ? split.lines.length : null;
  }

  return {
    ok: true,
    content: files.get(ENTRY_CONTENT) ?? null,
    claims: Object.freeze({
      format: manifest.manifest.format,
      title: manifest.manifest.title,
      created_at: manifest.manifest.created_at,
      author_name: manifest.manifest.author.name,
      author_key_id: manifest.manifest.author.key_id,
      content_sha256: manifest.manifest.content.sha256,
      entries,
    }),
  };
}
