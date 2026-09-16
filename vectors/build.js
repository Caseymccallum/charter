#!/usr/bin/env node
/**
 * The conformance kit's artifact builder.
 *
 * This file shares no code with `verifier/**` on purpose. Hashing and signing
 * come from `node:crypto`; the canonical JSON writer and the ZIP writer below
 * are written from SPEC.md sections 3 and 4 rather than derived from the
 * reader. If two independently written implementations agree that a byte
 * sequence is the canonical form of a value and that a verdict is what it is,
 * that agreement is evidence about the format. Two copies of one bug would be
 * evidence about nothing.
 *
 * The one thing this builder asks the verifier for is the verdict it produces
 * for each artifact, which is how `vectors/expected.json` is recorded. That
 * file is a record, not an oracle: every case below states what its verdict
 * ought to be, and this script refuses to write the record if the verifier
 * disagrees with that statement.
 *
 * Node-only. Nothing under `verifier/**` may import this file.
 *
 * Usage:
 *   node vectors/build.js          write vectors/out/*.charter and vectors/expected.json
 *   node vectors/build.js --check  build in memory and refuse to write if the record is stale
 */

import { createHash, createPrivateKey, createPublicKey, sign as signWith } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, 'out');
const RECORD_PATH = join(HERE, 'expected.json');

const FORMAT = 'charter/0.1';
const LF = 0x0a;
const TITLE = 'Charter: a .charter draft';
const CREATED_AT = '2026-01-01T00:00:00Z';
const NAME = 'Casey';
const ENCODER = new TextEncoder();

/* ------------------------------------------------------------------ *
 * Canonical JSON (SPEC.md section 4), written from the specification.
 * ------------------------------------------------------------------ */

const SHORT = new Map([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

/**
 * Quote a string the one way the format allows: an escape only where JSON
 * requires one, plus `"` and `\`, and every other character literally.
 *
 * @param {string} text
 * @returns {string}
 */
function quote(text) {
  let out = '"';
  for (const character of text) {
    const code = character.codePointAt(0);
    const short = SHORT.get(code);
    if (short !== undefined) out += short;
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`;
    else out += character;
  }
  return `${out}"`;
}

/**
 * Compare two strings by Unicode code point, which is what the specification
 * says and is not what `Array.prototype.sort` does for astral characters.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compareByCodePoint(a, b) {
  const left = [...a];
  const right = [...b];
  const shorter = Math.min(left.length, right.length);
  for (let index = 0; index < shorter; index += 1) {
    const x = left[index].codePointAt(0);
    const y = right[index].codePointAt(0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length - right.length;
}

/**
 * Serialize a value to its canonical text.
 *
 * @param {unknown} value
 * @param {(a: string, b: string) => number} [order]
 * @returns {string}
 */
function canonical(value, order = compareByCodePoint) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError(`canonical JSON holds integers only: ${value}`);
    return String(value);
  }
  if (typeof value === 'string') return quote(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, order)).join(',')}]`;
  const keys = Object.keys(value).sort(order);
  return `{${keys.map((key) => `${quote(key)}:${canonical(value[key], order)}`).join(',')}}`;
}

/**
 * The bytes a signature covers: the canonical form of the value with its
 * signature field removed, then one LF.
 *
 * @param {Record<string, unknown>} object
 * @param {string} field
 * @returns {Uint8Array}
 */
function signingInput(object, field) {
  const copy = {};
  for (const key of Object.keys(object)) {
    if (key !== field) copy[key] = object[key];
  }
  return withLf(utf8(canonical(copy)));
}

/**
 * The bytes of a canonical document: canonical text and one LF.
 *
 * @param {unknown} value
 * @param {(a: string, b: string) => number} [order]
 * @returns {Uint8Array}
 */
function canonicalBytes(value, order) {
  return withLf(utf8(canonical(value, order)));
}

/* ------------------------------- bytes ------------------------------- */

/** @param {string} text @returns {Uint8Array} */
function utf8(text) {
  return ENCODER.encode(text);
}

/** @param {Uint8Array} bytes @param {number} byte @returns {Uint8Array} */
function withLf(bytes) {
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes, 0);
  out[bytes.length] = LF;
  return out;
}

/** @param {Uint8Array[]} parts @returns {Uint8Array} */
function concatBytes(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** @param {Uint8Array} bytes @returns {string} */
function hex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** @param {Uint8Array} bytes @returns {Uint8Array} */
function sha256(bytes) {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** @param {Uint8Array} bytes @returns {string} unpadded base64url */
function base64url(bytes) {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at];
    const second = bytes[at + 1];
    const third = bytes[at + 2];
    out += B64URL[first >> 2];
    out += B64URL[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) break;
    out += B64URL[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) break;
    out += B64URL[third & 0x3f];
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes @returns {number} */
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/* ------------------------------ ZIP writer ------------------------------ */

/** The one flag charter/0.1 expects to see: the entry name is UTF-8. */
const FLAG_UTF8_NAME = 0x0800;
/** 1980-01-01 is the earliest instant a DOS date field can hold. */
const DOS_DATE = 0x0021;
const DOS_TIME = 0;

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** @param {number} value @returns {Uint8Array} */
function u16(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

/** @param {number} value @returns {Uint8Array} */
function u32(value) {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

/**
 * Write a ZIP archive of the shape charter/0.1 requires: no ZIP64, no comment,
 * no data descriptors, and entries laid out in the order they are listed, with
 * the central directory immediately after them.
 *
 * @param {{ name: string, data: Uint8Array, method?: number, flags?: number, declared_size?: number, declared_crc32?: number }[]} entries
 * @param {{ method?: number, flags?: number, version_needed?: number, dos_time?: number, dos_date?: number }} [options]
 * @returns {Uint8Array}
 */
function zipArchive(entries, options = {}) {
  /** @type {Uint8Array[]} */
  const body = [];
  /** @type {Uint8Array[]} */
  const central = [];
  let offset = 0;

  const dosTime = options.dos_time ?? DOS_TIME;
  const dosDate = options.dos_date ?? DOS_DATE;

  for (const entry of entries) {
    const nameBytes = utf8(entry.name);
    const method = entry.method ?? options.method ?? 0;
    const flags = entry.flags ?? options.flags ?? FLAG_UTF8_NAME;
    const versionNeeded = options.version_needed ?? 20;
    const stored = method === 8 ? new Uint8Array(deflateRawSync(entry.data)) : entry.data;
    const declaredSize = entry.declared_size ?? entry.data.length;
    const declaredCrc = entry.declared_crc32 ?? crc32(entry.data);

    const header = concatBytes([
      u32(SIG_LOCAL),
      u16(versionNeeded),
      u16(flags),
      u16(method),
      u16(dosTime),
      u16(dosDate),
      u32(declaredCrc),
      u32(stored.length),
      u32(declaredSize),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    body.push(header, stored);

    central.push(
      concatBytes([
        u32(SIG_CENTRAL),
        u16(versionNeeded),
        u16(versionNeeded),
        u16(flags),
        u16(method),
        u16(dosTime),
        u16(dosDate),
        u32(declaredCrc),
        u32(stored.length),
        u32(declaredSize),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += header.length + stored.length;
  }

  const directory = concatBytes(central);
  const end = concatBytes([
    u32(SIG_EOCD),
    u16(0),
    u16(0),
    u16(central.length),
    u16(central.length),
    u32(directory.length),
    u32(offset),
    u16(0),
  ]);
  return concatBytes([...body, directory, end]);
}

/* -------------------------------- keys -------------------------------- */

/** Fixed so that every build of these artifacts produces the same bytes. */
const KEY_NOTE = 'charter/0.1 conformance kit key. Published on purpose: it makes the vectors reproducible and it must never be used for a document anybody cares about.';

const PKCS8_PREFIX = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

const PRIVATE_KEY = createPrivateKey({
  key: Buffer.from(concatBytes([PKCS8_PREFIX, sha256(utf8(KEY_NOTE))])),
  format: 'der',
  type: 'pkcs8',
});

/** The raw 32 bytes of the Ed25519 public key. */
const PUBLIC_KEY = new Uint8Array(createPublicKey(PRIVATE_KEY).export({ format: 'der', type: 'spki' }).subarray(-32));

/** SPEC.md section 8: `ed25519:` and the hex SHA-256 of the 32 public key bytes. */
const KEY_ID = `ed25519:${hex(sha256(PUBLIC_KEY))}`;

/** @param {Uint8Array} message @returns {Uint8Array} 64 bytes */
function sign(message) {
  return new Uint8Array(signWith(null, message, PRIVATE_KEY));
}

/* --------------------------- the two documents --------------------------- */

/** The revisions of the document, oldest first. The last one is content.md. */
const CONTENT_REVISIONS = Object.freeze([
  '# Charter\n\nA document that carries its own history.\n\nStatus: draft.\n',
  '# Charter\n\nA document that carries its own history.\n\nStatus: draft, under review.\n\n## Purpose\n\nOne file holds a document and the account of how it got there.\n',
]);

/**
 * The default history: a create and an edit. The first summary carries a
 * quotation mark, so the vectors pin down escaping rather than sidestepping it.
 */
const DEFAULT_LOG = Object.freeze([
  Object.freeze({
    action: 'create',
    timestamp: '2026-01-01T00:00:00Z',
    summary: 'Initial draft. The "Purpose" section is still to come.',
    revision: 0,
  }),
  Object.freeze({
    action: 'edit',
    timestamp: '2026-01-02T09:30:00Z',
    summary: 'Add the Purpose section and revise the status line.',
    revision: 1,
  }),
]);

/**
 * One entry's value, without its signature.
 *
 * @param {object} plan
 * @param {string | null} parent
 * @param {readonly string[]} body
 * @returns {Record<string, unknown>}
 */
function entryValue(plan, parent, body) {
  return {
    action: plan.action,
    author: {
      key_id: plan.key_id ?? KEY_ID,
      name: plan.author_name ?? NAME,
    },
    content_sha256: hex(sha256(utf8(body[plan.revision]))),
    parent,
    summary: plan.summary,
    timestamp: plan.timestamp,
    ...(plan.extra ?? {}),
  };
}

/**
 * Build the log. Each entry is signed over its own value, and the next entry's
 * parent is the SHA-256 of this entry's line as it stands in the file: the
 * canonical text and the LF that closes it (SPEC.md section 9).
 *
 * @param {readonly object[]} plans
 * @param {readonly string[]} [body]
 * @returns {{ lines: Uint8Array[], bytes: Uint8Array, signatures: string[], parents: (string | null)[] }}
 */
function buildLog(plans, body = CONTENT_REVISIONS) {
  /** @type {Uint8Array[]} */
  const lines = [];
  const signatures = [];
  const parents = [];
  let parent = null;

  for (const plan of plans) {
    const value = plan.value ?? entryValue(plan, plan.parent_override ?? parent, body);
    const signature = plan.signature ?? base64url(sign(signingInput(value, 'signature')));
    const line = canonicalBytes({ ...value, signature });
    lines.push(line);
    signatures.push(signature);
    parents.push(value.parent ?? null);
    parent = hex(sha256(line));
  }
  return { lines, bytes: concatBytes(lines), signatures, parents };
}

/**
 * Build manifest.json.
 *
 * @param {object} spec
 * @param {string} contentSha256 the digest the log's last entry declares
 * @returns {{ signed: Record<string, unknown>, bytes: Uint8Array }}
 */
function buildManifest(spec, contentSha256) {
  const unsigned = {
    author: {
      algorithm: 'ed25519',
      key_id: spec.key_id ?? KEY_ID,
      name: spec.author_name ?? NAME,
      public_key: spec.public_key ?? base64url(PUBLIC_KEY),
      ...(spec.author_extra ?? {}),
    },
    content: { sha256: spec.manifest_content_sha256 ?? contentSha256, ...(spec.content_extra ?? {}) },
    created_at: spec.created_at ?? CREATED_AT,
    format: spec.format ?? FORMAT,
    title: spec.title ?? TITLE,
    ...(spec.manifest_extra ?? {}),
  };
  const signatureBytes = sign(signingInput(unsigned, 'signature'));
  let signature = base64url(signatureBytes);
  if (spec.manifest_signature === 'flipped') {
    const flipped = Uint8Array.from(signatureBytes);
    flipped[0] ^= 0x01;
    signature = base64url(flipped);
  } else if (typeof spec.manifest_signature === 'string') {
    signature = spec.manifest_signature;
  }
  const signed = { ...unsigned, signature };
  const order = spec.manifest_key_order === 'reverse' ? (a, b) => compareByCodePoint(b, a) : undefined;
  const text = canonical(signed, order);
  const bytes = spec.manifest_terminator === 'none' ? utf8(text) : withLf(utf8(text));
  return { signed, bytes };
}

/**
 * Build one artifact from a case specification.
 *
 * Every knob exists because one case needs it, and each is named after the
 * check it is meant to move. Nothing here is a general-purpose writer: it
 * writes the three entries the format defines and, when a case asks for one,
 * exactly one thing the format does not define.
 *
 * @param {object} spec
 * @returns {{ bytes: Uint8Array, manifest: Record<string, unknown>, log: Uint8Array }}
 */
function buildArtifact(spec) {
  if (spec.raw !== undefined) return { bytes: spec.raw, manifest: {}, log: new Uint8Array(0) };

  const body = spec.body ?? CONTENT_REVISIONS;
  const lastRevision = body[body.length - 1];
  const contentBytes = spec.content_bytes ?? utf8(lastRevision);
  const defaultLog = buildLog(spec.log ?? DEFAULT_LOG, body).bytes;
  const logBytes =
    spec.log_bytes !== undefined
      ? utf8(spec.log_bytes)
      : spec.log_without_final_lf === true
        ? defaultLog.slice(0, defaultLog.length - 1)
        : defaultLog;
  const manifest = buildManifest(spec, spec.manifest_content_sha256 ?? hex(sha256(utf8(lastRevision))));

  /** @type {object[]} */
  let entries = [
    { name: 'manifest.json', data: manifest.bytes },
    { name: 'content.md', data: contentBytes },
    { name: 'provenance.jsonl', data: logBytes },
  ];
  for (const entry of entries) {
    const override = (spec.entry_overrides ?? {})[entry.name];
    if (override !== undefined) Object.assign(entry, override);
  }
  const omit = new Set(spec.omit ?? []);
  entries = entries.filter((entry) => !omit.has(entry.name));
  if (spec.duplicate !== undefined) entries.push({ name: spec.duplicate, data: spec.duplicate_data ?? new Uint8Array(0) });
  for (const extra of spec.extra_entries ?? []) entries.push({ name: extra.name, data: extra.data, method: extra.method });
  if (spec.entry_order === 'reversed') entries = [...entries].reverse();

  return { bytes: zipArchive(entries, spec.zip ?? {}), manifest: manifest.signed, log: logBytes };
}
/* -------------------------------- cases -------------------------------- */

/** The clean log, built once so that the tamper cases can quote its bytes. */
const CLEAN_LOG = buildLog(DEFAULT_LOG);

/**
 * One entry's summary is changed and every signature and parent is left as it
 * was, which is what a byte-level edit with no re-signing looks like. The
 * signature is quoted from the clean log rather than computed here: an entry
 * that is edited and then re-signed with the same key would carry a valid
 * signature, and the case is about the signature that no longer matches.
 */
const EDITED_LOG = Object.freeze([
  Object.freeze({ ...DEFAULT_LOG[0], summary: 'Initial draft, quietly revised.', signature: CLEAN_LOG.signatures[0] }),
  Object.freeze({ ...DEFAULT_LOG[1], parent_override: CLEAN_LOG.parents[1] }),
]);

/**
 * Every summary is changed and every entry is re-signed, with the parents
 * rebuilt. Nothing else moves: the content and the manifest are untouched.
 * This is the key holder rewriting the history, and no check can see it.
 */
const REWRITTEN_LOG = Object.freeze([
  Object.freeze({ action: 'create', timestamp: '2026-01-01T00:00:00Z', summary: 'Initial draft.', revision: 0 }),
  Object.freeze({ action: 'edit', timestamp: '2026-01-02T09:30:00Z', summary: 'Add the Purpose section.', revision: 1 }),
]);

const FOREIGN_KEY_ID = `ed25519:${'0'.repeat(64)}`;

/**
 * The conformance cases.
 *
 * `expect` is what the verdict has to be for the kit to pass, and it is
 * written before the verifier is asked: `fail` and `unsupported` are the exact
 * sets of checks that must carry those statuses, with the reason code each
 * must carry. `skips` is the number of checks that may not be reached.
 *
 * @type {{ name: string, note: string, spec: object, expect: object }[]}
 */
const CASES = [
  {
    name: 'valid',
    note: 'The artifact the format is designed to accept: two signed entries, stored entry data, UTF-8 entry names.',
    spec: {},
    expect: { verdict: 'VERIFIED', exit_code: 0, fail: {}, unsupported: {}, skips: 0 },
  },
  {
    name: 'valid-deflate',
    note: 'The same artifact with every entry raw-deflated: method 8 is the other method charter/0.1 defines, and it must not change the verdict.',
    spec: { zip: { method: 8 } },
    expect: { verdict: 'VERIFIED', exit_code: 0, fail: {}, unsupported: {}, skips: 0 },
  },
  {
    name: 'not-a-zip',
    note: 'A text file named .charter. There is no container, so nothing inside it is examined: one FAIL and 29 SKIP, never a pass.',
    spec: { raw: utf8('This is a text file. It is not an archive, and it does not become one because it is named .charter.\n') },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.READABLE': 'MALFORMED' }, unsupported: {}, skips: 29 },
  },
  {
    name: 'missing-entry',
    note: 'provenance.jsonl is absent. The entry set is broken, and every check that would have read the log is unproven rather than passed.',
    spec: { omit: ['provenance.jsonl'] },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.ENTRY_SET': 'MISSING' }, unsupported: {}, skips: 12 },
  },
  {
    name: 'unreadable-manifest',
    note: 'manifest.json is present but its bytes cannot be read, so nothing that depends on it can be established. This is the case that catches a check with no result at all.',
    spec: { entry_overrides: { 'manifest.json': { method: 9 } } },
    expect: {
      verdict: 'INCOMPLETE',
      exit_code: 1,
      fail: {},
      unsupported: { 'L0.ZIP.ENTRY_DATA': 'UNSUPPORTED_FEATURE' },
      skips: 14,
    },
  },
  {
    name: 'duplicate-entry',
    note: 'Two entries named content.md. The first one parses, so every other check passes, and the artifact is still broken: a name identifies one entry.',
    spec: { duplicate: 'content.md', duplicate_data: utf8('') },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.ENTRY_SET': 'DUPLICATE' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'extra-entry',
    note: 'A fourth entry, notes.txt. The format defines three, so the fourth is refused rather than ignored.',
    spec: { extra_entries: [{ name: 'notes.txt', data: utf8('Not part of the format.\n') }] },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.ENTRY_SET': 'EXTRA' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'encrypted-flag',
    note: 'Every entry sets general purpose bit 0. Every byte of the artifact is otherwise exactly the valid case, and the verdict is still not VERIFIED: a feature this verifier does not implement is never a pass.',
    spec: { zip: { flags: 0x0801 } },
    expect: {
      verdict: 'INCOMPLETE',
      exit_code: 1,
      fail: {},
      unsupported: { 'L0.ZIP.FLAGS': 'UNSUPPORTED_FEATURE' },
      skips: 0,
    },
  },
  {
    name: 'unsupported-method',
    note: 'Every entry declares compression method 9. charter/0.1 defines 0 and 8, so the entries cannot be read and most of the verdict is a list of questions that were never reached.',
    spec: { zip: { method: 9 } },
    expect: {
      verdict: 'INCOMPLETE',
      exit_code: 1,
      fail: {},
      unsupported: { 'L0.ZIP.ENTRY_DATA': 'UNSUPPORTED_FEATURE' },
      skips: 23,
    },
  },
  {
    name: 'unsupported-format',
    note: 'The manifest declares charter/0.2, which this verifier does not implement. The artifact is not called broken: it is called unproven, and the rules of a version nobody read are not applied to it.',
    spec: { format: 'charter/0.2' },
    expect: {
      verdict: 'INCOMPLETE',
      exit_code: 1,
      fail: {},
      unsupported: { 'L0.FORMAT.IDENTIFIER': 'UNSUPPORTED_VERSION' },
      skips: 19,
    },
  },
  {
    name: 'noncanonical-manifest',
    note: 'manifest.json holds the right value, signed correctly, in a different key order. One byte-level rule is broken and nothing else is: the same value in another spelling is not this format.',
    spec: { manifest_key_order: 'reverse' },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.MANIFEST.CANONICAL': 'NON_CANONICAL' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'manifest-extra-field',
    note: 'The manifest carries a validly signed field this version has no rule for. The signature is fine, and the artifact is still refused.',
    spec: { manifest_extra: { claim: 'A field this version has no rule for.' } },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.MANIFEST.EXTRA_FIELDS': 'UNKNOWN_FIELD' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'entry-extra-field',
    note: 'The second entry carries a validly signed field this version has no rule for, with the chain rebuilt so that nothing else is wrong.',
    spec: {
      log: [{ ...DEFAULT_LOG[0] }, { ...DEFAULT_LOG[1], extra: { note: 'A field this version has no rule for.' } }],
    },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.PROVENANCE.EXTRA_FIELDS': 'UNKNOWN_FIELD' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'bad-manifest-signature',
    note: "One bit of the manifest signature is flipped. The bytes are a well-formed signature, and they are not this author's signature over these bytes.",
    spec: { manifest_signature: 'flipped' },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L1.MANIFEST.SIGNATURE': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'content-tampered',
    note: 'The bytes of content.md are changed and the archive is written correctly around them. The signature and the chain are untouched and both still pass: the content digest is the check that catches this edit.',
    spec: { content_bytes: concatBytes([utf8(CONTENT_REVISIONS[1]), utf8('One sentence nobody signed.\n')]) },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.CONTENT.HASH': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'content-bom',
    note: 'content.md begins with a UTF-8 byte order mark. The mark is well-formed UTF-8, and the bytes of the file are the content, so a mark would be content too.',
    spec: { content_bytes: concatBytes([new Uint8Array([0xef, 0xbb, 0xbf]), utf8(CONTENT_REVISIONS[1])]) },
    expect: {
      verdict: 'BROKEN',
      exit_code: 2,
      fail: { 'L0.CONTENT.UTF8': 'NON_CANONICAL', 'L0.CONTENT.HASH': 'MISMATCH' },
      unsupported: {},
      skips: 0,
    },
  },
  {
    name: 'entry-edited',
    note: 'A summary is changed and no signature is recomputed. The stale signature fails, and so does the parent hash that still points at the line that used to be there.',
    spec: { log: EDITED_LOG },
    expect: {
      verdict: 'BROKEN',
      exit_code: 2,
      fail: { 'L1.PROVENANCE.SIGNATURES': 'MISMATCH', 'L2.CHAIN.LINKS': 'MISMATCH' },
      unsupported: {},
      skips: 0,
    },
  },
  {
    name: 'history-rewritten',
    note: 'The key holder changes both summaries and re-signs every entry, rebuilding the parents. VERIFIED is the correct answer here, not a bug: this is the KEY_HOLDER_CAN_REWRITE_HISTORY limitation, kept as a case so that the gap is visible instead of theoretical.',
    spec: { log: REWRITTEN_LOG },
    expect: { verdict: 'VERIFIED', exit_code: 0, fail: {}, unsupported: {}, skips: 0 },
  },
  {
    name: 'foreign-key-entry',
    note: "The second entry names a key id that is not what the artifact's public key derives, and it is signed with the real key. The signature is valid and the entry is not this author's.",
    spec: { log: [{ ...DEFAULT_LOG[0] }, { ...DEFAULT_LOG[1], key_id: FOREIGN_KEY_ID }] },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L1.PROVENANCE.KEYS': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'truncated-log',
    note: 'The last entry is gone, so the chain is shorter than the document it describes: no entry declares the digest of the content the manifest declares, while every signature still checks out.',
    spec: { log: [DEFAULT_LOG[0]] },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L2.CHAIN.HEAD_MATCHES_CONTENT': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'empty-log',
    note: 'provenance.jsonl is present and empty. Nothing is malformed and nothing is signed, and an artifact that records nothing about where it came from is refused.',
    spec: { log_bytes: '' },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.PROVENANCE.NONEMPTY': 'MISSING' }, unsupported: {}, skips: 3 },
  },
  {
    name: 'unterminated-log',
    note: 'The last line has no LF. The entries before it are canonical and signed, and a file whose last line has no terminator is not a log of LF-terminated lines.',
    spec: { log_without_final_lf: true },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.PROVENANCE.PARSE': 'MALFORMED' }, unsupported: {}, skips: 11 },
  },
  {
    name: 'wrong-declared-size',
    note: 'content.md declares an uncompressed size it does not have. The bytes decode and the CRC matches, and the container still lies about the entry.',
    spec: { entry_overrides: { 'content.md': { declared_size: 9999 } } },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.SIZES': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'wrong-declared-crc',
    note: 'content.md declares CRC-32 0 and holds other bytes, which is the one container claim that parsing alone cannot check.',
    spec: { entry_overrides: { 'content.md': { declared_crc32: 0 } } },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.CRC32': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'stamped-by-a-clock',
    note: 'Every entry carries a real date and time in its DOS stamp, written the same way in both copies, with the entries themselves untouched. A file whose bytes are the record cannot also carry a reading of a clock: with one, the same document written twice would be two files.',
    spec: { zip: { dos_date: 0x5a3c, dos_time: 0x4a5c } },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.ZIP.METADATA': 'MISMATCH' }, unsupported: {}, skips: 0 },
  },
  {
    name: 'manifest-field-unreadable',
    note: 'created_at is a date with no time. The manifest parses, is canonical, and is signed over this value, so the rule that reads the fields is the one that refuses it, and every check that needs a manifest value is left unproven rather than passed.',
    spec: { created_at: '2026-01-01' },
    expect: { verdict: 'BROKEN', exit_code: 2, fail: { 'L0.MANIFEST.FIELDS': 'MALFORMED' }, unsupported: {}, skips: 7 },
  },
];

/* ------------------------------- the driver ------------------------------ */

/**
 * Compare the verdict the verifier produced with the verdict the case states.
 *
 * @param {{ name: string, expect: object }} item
 * @param {{ verdict: string, exit_code: number, checks: import('../verifier/status.js').CheckResult[] }} result
 * @returns {string[]} the ways in which the verdict is not what the case says
 */
function diff(item, result) {
  const want = item.expect;
  /** @type {string[]} */
  const problems = [];
  if (result.verdict !== want.verdict) {
    problems.push(`${item.name}: verdict is ${result.verdict}, and the case says it must be ${want.verdict}`);
  }
  if (result.exit_code !== want.exit_code) {
    problems.push(`${item.name}: exit code is ${result.exit_code}, and the case says it must be ${want.exit_code}`);
  }

  const seen = { fail: {}, unsupported: {}, skips: 0 };
  for (const check of result.checks) {
    if (check.status === 'FAIL') seen.fail[check.id] = check.reason_code;
    else if (check.status === 'UNSUPPORTED') seen.unsupported[check.id] = check.reason_code;
    else if (check.status === 'SKIP') seen.skips += 1;
  }

  for (const [kind, expected] of [['fail', want.fail], ['unsupported', want.unsupported]]) {
    for (const [id, code] of Object.entries(expected)) {
      if (seen[kind][id] === undefined) problems.push(`${item.name}: ${id} must be ${kind === 'fail' ? 'FAIL' : 'UNSUPPORTED'} and is not`);
      else if (seen[kind][id] !== code) problems.push(`${item.name}: ${id} carries reason ${seen[kind][id]}, and the case says it must be ${code}`);
    }
    for (const id of Object.keys(seen[kind])) {
      if (expected[id] === undefined) {
        problems.push(`${item.name}: ${id} is ${kind === 'fail' ? 'FAIL' : 'UNSUPPORTED'} (${seen[kind][id]}), and the case does not expect it to be`);
      }
    }
  }
  if (seen.skips !== want.skips) {
    const ids = result.checks.filter((check) => check.status === 'SKIP').map((check) => check.id);
    problems.push(`${item.name}: ${seen.skips} check(s) were never reached, and the case says ${want.skips}: ${ids.join(', ')}`);
  }
  return problems;
}

/**
 * Build every case, ask the verifier for a verdict, and refuse to write
 * anything if a verdict is not the one the case states.
 *
 * @returns {Promise<{ problems: string[], record: object, artifacts: Map<string, Uint8Array> }>}
 */
async function buildAll() {
  const verifierUrl = pathToFileURL(join(HERE, '..', 'verifier', 'verify.js')).href;
  const { verify } = await import(verifierUrl);

  /** @type {string[]} */
  const problems = [];
  /** @type {object[]} */
  const recorded = [];
  const artifacts = new Map();

  for (const item of CASES) {
    const built = buildArtifact(item.spec);
    const result = await verify(built.bytes);
    problems.push(...diff(item, result));
    artifacts.set(item.name, built.bytes);
    recorded.push({
      name: item.name,
      file: `out/${item.name}.charter`,
      bytes: built.bytes.length,
      sha256: hex(sha256(built.bytes)),
      note: item.note,
      expected: {
        verdict: item.expect.verdict,
        exit_code: item.expect.exit_code,
        fail: item.expect.fail,
        unsupported: item.expect.unsupported,
        skips: item.expect.skips,
      },
    });
  }

  const record = {
    kit: 'charter conformance vectors',
    format: FORMAT,
    built_by: 'vectors/build.js',
    note: 'The expected verdicts in this file were written before the verifier was asked, and vectors/build.js refuses to write this file when the verifier disagrees with one of them. `fail` and `unsupported` map a check id to the reason code it must carry; `skips` counts the checks that must not be reached.',
    cases: recorded,
  };
  return { problems, record, artifacts };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const { problems, record, artifacts } = await buildAll();
  const text = `${JSON.stringify(record, null, 2)}\n`;

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`\n${problems.length} of ${record.cases.length} case(s) produced a verdict that is not the one the case states. Nothing written.`);
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    let onDisk = null;
    try {
      onDisk = readFileSync(RECORD_PATH, 'utf8');
    } catch {
      console.error(`  ${RECORD_PATH} does not exist, so there is no record to check`);
      process.exitCode = 1;
      return;
    }
    if (onDisk !== text) {
      console.error('  the record on disk is not what this builder produces; run `node vectors/build.js` and commit the result');
      process.exitCode = 1;
      return;
    }
    console.log(`${record.cases.length} case(s): every verdict is the one the case states, and the record on disk matches.`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, bytes] of artifacts) writeFileSync(join(OUT_DIR, `${name}.charter`), bytes);
  writeFileSync(RECORD_PATH, text);
  console.log(`wrote ${artifacts.size} artifact(s) to vectors/out/ and ${record.cases.length} case(s) to vectors/expected.json`);
}

await main();

