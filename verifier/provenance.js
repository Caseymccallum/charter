/**
 * The provenance log: the edit history, one signed entry per line.
 *
 * The file is byte-oriented rather than line-oriented on purpose. A verifier
 * that reads lines through a text decoder has already lost the ability to
 * notice CRLF, a missing final newline, or a byte order mark, and those are
 * exactly the differences that change what the next entry's parent hash
 * covers. So the bytes are split here, and text is decoded per line afterwards.
 *
 * @module verifier/provenance
 */

import { splitOnByte, utf8Decode } from './bytes.js';
import { signingInput } from './canonical-write.js';
import { parseJsonText } from './canonical.js';
import { LIMITS } from './limits.js';
import { DIGEST_BYTES } from './manifest.js';
import { describeType, findUnknownField, readField } from './schema.js';
import { REASON } from './status.js';

/** The entries' vocabulary. Closed in charter/0.1. */
export const ACTIONS = Object.freeze(['create', 'edit']);

/** The fields a provenance entry may contain, and nothing else. */
export const ENTRY_FIELDS = Object.freeze(['action', 'author', 'content_sha256', 'parent', 'signature', 'summary', 'timestamp']);
export const ENTRY_AUTHOR_FIELDS = Object.freeze(['key_id', 'name']);

/**
 * Split the log into lines, without decoding any of them.
 *
 * An empty file yields no lines and no complaint: "at least one entry" is
 * L0.PROVENANCE.NONEMPTY's requirement, and a check is only worth having if it
 * is the one that fails.
 *
 * @param {Uint8Array} bytes
 * @param {typeof LIMITS} [limits]
 * @returns {{ ok: true, lines: Uint8Array[] } | { ok: false, reason_code: string, detail: string }}
 */
export function splitLines(bytes, limits = LIMITS) {
  if (bytes.length === 0) {
    return { ok: true, lines: [] };
  }
  if (bytes[bytes.length - 1] !== 0x0a) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: 'provenance.jsonl does not end with an LF, so its last entry has no terminator' };
  }
  const parts = splitOnByte(bytes, 0x0a);
  parts.pop();
  if (parts.length > limits.MAX_PROVENANCE_ENTRIES) {
    return { ok: false, reason_code: REASON.LIMIT_EXCEEDED, detail: `provenance.jsonl holds ${parts.length} entries, above the declared limit of ${limits.MAX_PROVENANCE_ENTRIES}` };
  }
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index].length === 0) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `line ${index + 1} of provenance.jsonl is empty` };
    }
    if (parts[index].length > limits.MAX_PROVENANCE_LINE_BYTES) {
      return { ok: false, reason_code: REASON.LIMIT_EXCEEDED, detail: `line ${index + 1} of provenance.jsonl is ${parts[index].length} bytes, above the declared limit of ${limits.MAX_PROVENANCE_LINE_BYTES}` };
    }
  }
  return { ok: true, lines: parts };
}

/**
 * Read one line as JSON. The line's terminator is not part of the value.
 *
 * @param {Uint8Array} line
 * @param {number} number 1-based line number, for messages
 * @returns {{ ok: true, value: Record<string, unknown> } | { ok: false, reason_code: string, detail: string }}
 */
export function parseLine(line, number) {
  const decoded = utf8Decode(line);
  if (!decoded.ok) {
    return { ok: false, reason_code: REASON.DECODE_ERROR, detail: `line ${number} of provenance.jsonl is not valid UTF-8` };
  }
  const parsed = parseJsonText(decoded.text);
  if (!parsed.ok) {
    return { ok: false, reason_code: parsed.reason_code, detail: `line ${number} of provenance.jsonl: ${parsed.detail}` };
  }
  const value = parsed.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `line ${number} of provenance.jsonl is ${describeType(value)}, not a JSON object` };
  }
  return { ok: true, value: /** @type {Record<string, unknown>} */ (value) };
}

/**
 * @param {string | null} key
 * @param {string} where
 * @returns {string | null}
 */
function prefixUnknown(key, where) {
  return key === null ? null : `${where}.${key}`;
}

/**
 * Read and check one entry.
 *
 * As with the manifest, encodings that a dedicated check consumes are not
 * checked here: `signature` is a string and `content_sha256` is a string,
 * because L1.PROVENANCE.SIGNATURES and L0.PROVENANCE.CONTENT_HASH_FORMAT are
 * the checks that read them.
 *
 * @param {Record<string, unknown>} object
 * @param {number} number 1-based line number
 * @returns {{ ok: true, entry: object, unknown_field: string | null }
 *   | { ok: false, path: string, reason_code: string, detail: string }}
 */
export function readEntry(object, number) {
  const where = `provenance line ${number}`;

  const timestamp = readField(object, 'timestamp', { kind: 'timestamp' }, where);
  if (!timestamp.ok) return { ok: false, path: `${where}.timestamp`, reason_code: timestamp.reason_code, detail: timestamp.detail };
  const action = readField(object, 'action', { kind: 'enum', values: ACTIONS }, where);
  if (!action.ok) return { ok: false, path: `${where}.action`, reason_code: action.reason_code, detail: action.detail };
  const summary = readField(object, 'summary', { kind: 'string', non_empty: true }, where);
  if (!summary.ok) return { ok: false, path: `${where}.summary`, reason_code: summary.reason_code, detail: summary.detail };
  const parent = readField(object, 'parent', { kind: 'hex_or_null', hex_length: DIGEST_BYTES }, where);
  if (!parent.ok) return { ok: false, path: `${where}.parent`, reason_code: parent.reason_code, detail: parent.detail };
  const contentSha256 = readField(object, 'content_sha256', { kind: 'string', non_empty: true }, where);
  if (!contentSha256.ok) return { ok: false, path: `${where}.content_sha256`, reason_code: contentSha256.reason_code, detail: contentSha256.detail };
  const signature = readField(object, 'signature', { kind: 'string', non_empty: true }, where);
  if (!signature.ok) return { ok: false, path: `${where}.signature`, reason_code: signature.reason_code, detail: signature.detail };

  const author = readField(object, 'author', { kind: 'object' }, where);
  if (!author.ok) return { ok: false, path: `${where}.author`, reason_code: author.reason_code, detail: author.detail };
  const authorObject = /** @type {Record<string, unknown>} */ (author.value);
  const name = readField(authorObject, 'name', { kind: 'string', non_empty: true }, `${where}.author`);
  if (!name.ok) return { ok: false, path: `${where}.author.name`, reason_code: name.reason_code, detail: name.detail };
  const keyId = readField(authorObject, 'key_id', { kind: 'string', non_empty: true }, `${where}.author`);
  if (!keyId.ok) return { ok: false, path: `${where}.author.key_id`, reason_code: keyId.reason_code, detail: keyId.detail };

  const unknown = findUnknownField(object, ENTRY_FIELDS) ?? prefixUnknown(findUnknownField(authorObject, ENTRY_AUTHOR_FIELDS), `${where}.author`);

  return {
    ok: true,
    unknown_field: unknown,
    entry: Object.freeze({
      timestamp: timestamp.value,
      action: action.value,
      summary: summary.value,
      author: Object.freeze({ name: name.value, key_id: keyId.value }),
      parent: parent.value,
      content_sha256: contentSha256.value,
      signature: signature.value,
      signing_input: signingInput(object, 'signature'),
    }),
  };
}
