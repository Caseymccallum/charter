/**
 * The orchestrator: bytes in, verdict out.
 *
 * Nothing here decides what is true on its own. Each step reads one thing,
 * reports exactly one result per check id, and leaves the values it read in
 * `state` for the steps that follow. A step whose input never arrived records
 * SKIP with reason PREREQUISITE_FAILED rather than guessing, so a verdict can
 * always be read as a list of answers plus a list of questions that were never
 * reached.
 *
 * This module is the only place that knows the check order, and it knows it by
 * asking the reporter for the registry order at the end. A check that is
 * forgotten does not vanish: Reporter.all() throws when a registered id has no
 * result, so a missing step is a crash and not a quieter verdict.
 *
 * @module verifier/verify
 */

import { bytesEqual, concat, fromHexLower, toHex, utf8Decode } from './bytes.js';
import { CAVEATS } from './caveats.js';
import { canonicalBytes, canonicalDocument, LF } from './canonical-write.js';
import { parseJsonBytes } from './canonical.js';
import { decodeBase64Url } from './base64url.js';
import { sha256, verifySignature } from './digest.js';
import { LIMITS } from './limits.js';
import { ALGORITHM, deriveKeyId, FORMAT, MANIFEST_AUTHOR_FIELDS, MANIFEST_CONTENT_FIELDS, MANIFEST_FIELDS, PUBLIC_KEY_BYTES, readManifest, SIGNATURE_BYTES } from './manifest.js';
import { ENTRY_AUTHOR_FIELDS, ENTRY_FIELDS, parseLine, readEntry, splitLines } from './provenance.js';
import { Reporter, resolve } from './result.js';
import { describeType, findUnknownField, readField } from './schema.js';
import { REASON, STATUS } from './status.js';
import { evaluateEntryFlags, MAX_VERSION_NEEDED, parseArchive, readEntryData } from './zip.js';

/** The three entries a charter/0.1 artifact holds. */
export const ENTRY_MANIFEST = 'manifest.json';
export const ENTRY_CONTENT = 'content.md';
export const ENTRY_PROVENANCE = 'provenance.jsonl';
export const REQUIRED_ENTRIES = Object.freeze([ENTRY_MANIFEST, ENTRY_CONTENT, ENTRY_PROVENANCE]);

/** The digest length every SHA-256 field carries. */
const DIGEST_HEX = 64;

/** The UTF-8 byte order mark, which content.md may not begin with. */
const BOM = Object.freeze([0xef, 0xbb, 0xbf]);

/**
 * Verify one artifact.
 *
 * @param {Uint8Array} bytes the whole `.charter` file
 * @param {{ limits?: typeof LIMITS }} [options]
 * @returns {Promise<{ verdict: string, exit_code: number, summary: object, artifact: object | null, checks: import('./status.js').CheckResult[], limitations: readonly import('./caveats.js').Caveat[] }>}
 */
export async function verify(bytes, options = {}) {
  const limits = options.limits ?? LIMITS;
  const reporter = new Reporter();
  /** @type {Record<string, any>} */
  const state = { bytes, files: new Map() };

  if (!readContainer(reporter, state, limits)) {
    reporter.skipUnset('', 'the container could not be read, so nothing inside it could have been examined');
    return finalize(reporter, state);
  }
  await examineEntries(reporter, state, limits);
  const formatGate = examineManifest(reporter, state, limits);
  if (formatGate !== null) {
    skipFormatDependents(reporter, formatGate.detail, formatGate.reason_code);
    return finalize(reporter, state);
  }
  await examineContent(reporter, state);
  examineLog(reporter, state, limits);
  await examineIdentity(reporter, state);
  await examineChain(reporter, state);
  return finalize(reporter, state);
}

/**
 * Walk the container and report the one check that says whether there is a
 * container at all.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {typeof LIMITS} limits
 * @returns {boolean}
 */
function readContainer(reporter, state, limits) {
  const archive = parseArchive(state.bytes, limits);
  if (!archive.ok) {
    if (archive.status === STATUS.UNSUPPORTED) reporter.unsupported('L0.ZIP.READABLE', archive.reason_code, archive.detail);
    else reporter.fail('L0.ZIP.READABLE', archive.reason_code, archive.detail);
    return false;
  }
  state.archive = archive;
  reporter.pass('L0.ZIP.READABLE', `the central directory lists ${archive.entries.length} entr(ies) and its end record sits at offset ${archive.end.at}`);
  return true;
}

/**
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @returns {object}
 */
function finalize(reporter, state) {
  const checks = reporter.all();
  const resolved = resolve(checks);
  return {
    verdict: resolved.verdict,
    exit_code: resolved.exit_code,
    summary: resolved.summary,
    artifact: describeArtifact(state),
    checks,
    limitations: CAVEATS,
  };
}

/**
 * The checks that read manifest.json: the format identifier first, because it
 * decides whether the rest of the format's rules apply at all.
 *
 * An artifact that declares a version this verifier does not implement is not
 * broken and is not verified: it is unproven, and no rule of any version is
 * applied to it.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {typeof LIMITS} limits
 * @returns {{ detail: string, reason_code: string } | null} the reason the rest
 * of the artifact must not be judged, or `null` when it must be
 */
function examineManifest(reporter, state, limits) {
  const held = state.files.get(ENTRY_MANIFEST);
  if (held === undefined) {
    reporter.skip('L0.MANIFEST.PARSE', 'manifest.json could not be read out of the archive, so its bytes were never parsed');
    skipManifestDependents(reporter, 'manifest.json could not be read, so nothing that depends on it could be examined');
    return null;
  }
  const bytes = held.read.data;
  state.manifestBytes = bytes;
  const parsed = parseJsonBytes(bytes, { limits });
  if (!parsed.ok) {
    const detail = parsed.reason_code === REASON.DECODE_ERROR ? 'manifest.json is not valid UTF-8' : parsed.detail;
    reporter.fail('L0.MANIFEST.PARSE', parsed.reason_code, detail);
    skipManifestDependents(reporter, 'manifest.json could not be parsed, so nothing that depends on it could be examined');
    return null;
  }
  if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
    reporter.fail('L0.MANIFEST.PARSE', REASON.MALFORMED, `manifest.json holds ${describeType(parsed.value)}, not a JSON object`);
    skipManifestDependents(reporter, 'manifest.json is not a JSON object, so nothing that depends on it could be examined');
    return null;
  }
  const value = /** @type {Record<string, unknown>} */ (parsed.value);
  state.manifestValue = value;
  reporter.pass('L0.MANIFEST.PARSE', `manifest.json is one JSON object with ${Object.keys(value).length} field(s), and it is the only parse of these bytes that this verifier accepts`);

  const format = readField(value, 'format', { kind: 'string', non_empty: true }, 'manifest');
  if (!format.ok) {
    reporter.fail('L0.FORMAT.IDENTIFIER', format.reason_code, format.detail);
    return { detail: "manifest.format is not a version string, so no version's rules could be applied", reason_code: REASON.PREREQUISITE_FAILED };
  }
  if (format.value !== FORMAT) {
    reporter.unsupported('L0.FORMAT.IDENTIFIER', REASON.UNSUPPORTED_VERSION, `manifest.format is "${format.value}", and this verifier implements only "${FORMAT}"`);
    return { detail: 'the artifact declares a format version this verifier does not implement, so its rules were not applied', reason_code: REASON.UNSUPPORTED_VERSION };
  }
  reporter.pass('L0.FORMAT.IDENTIFIER', `manifest.format is "${FORMAT}"`);

  reportManifestBytes(reporter, state, bytes, value);
  return null;
}

/**
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {Uint8Array} bytes
 * @param {Record<string, unknown>} value
 * @returns {void}
 */
function reportManifestBytes(reporter, state, bytes, value) {
  const canonical = canonicalBytes(value);
  if (bytesEqual(bytes, canonicalDocument(value))) {
    reporter.pass('L0.MANIFEST.CANONICAL', `manifest.json is ${bytes.length} bytes: the canonical form of its value and one LF`);
  } else {
    reporter.fail('L0.MANIFEST.CANONICAL', REASON.NON_CANONICAL, `the bytes of manifest.json are not the canonical form of the object they parse to, which is ${canonical.length + 1} bytes; keys sort by code point, integers carry no leading zero, and one LF ends the file`);
  }

  const read = readManifest(value);
  if (read.ok) {
    state.manifest = read.manifest;
    reporter.pass('L0.MANIFEST.FIELDS', `the manifest names "${read.manifest.title}" by ${read.manifest.author.name}, signed ${read.manifest.created_at}`);
  } else {
    reporter.fail('L0.MANIFEST.FIELDS', read.reason_code, read.detail);
  }

  const unknown = read.ok ? read.unknown_field : unknownManifestField(value);
  if (unknown === null) {
    reporter.pass('L0.MANIFEST.EXTRA_FIELDS', 'the manifest carries no field this verifier has no rule for');
  } else {
    reporter.fail('L0.MANIFEST.EXTRA_FIELDS', REASON.UNKNOWN_FIELD, `${unknown} is not a field charter/0.1 defines, and this verifier reports a field it cannot interpret rather than ignoring it`);
  }
}

/**
 * The first field of the manifest that charter/0.1 has no rule for: the
 * manifest's own fields first, then content's, then author's.
 *
 * @param {Record<string, unknown>} value
 * @returns {string | null}
 */
function unknownManifestField(value) {
  const own = findUnknownField(value, MANIFEST_FIELDS);
  if (own !== null) return own;
  const content = value.content;
  if (content !== null && typeof content === 'object' && !Array.isArray(content)) {
    const nested = findUnknownField(/** @type {Record<string, unknown>} */ (content), MANIFEST_CONTENT_FIELDS);
    if (nested !== null) return `manifest.content.${nested}`;
  }
  const author = value.author;
  if (author !== null && typeof author === 'object' && !Array.isArray(author)) {
    const nested = findUnknownField(/** @type {Record<string, unknown>} */ (author), MANIFEST_AUTHOR_FIELDS);
    if (nested !== null) return `manifest.author.${nested}`;
  }
  return null;
}

/**
 * The container's own checks: which ZIP features are used, what the entry set
 * is, and whether every entry's bytes are what its header says they are.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {typeof LIMITS} limits
 * @returns {Promise<void>}
 */
async function examineEntries(reporter, state, limits) {
  const archive = state.archive;
  const entries = archive.entries;

  if (archive.maxVersionNeeded > MAX_VERSION_NEEDED) {
    reporter.unsupported('L0.ZIP.VERSION', REASON.UNSUPPORTED_VERSION, `the archive needs ZIP feature level ${archive.maxVersionNeeded / 10}, and this verifier implements ${MAX_VERSION_NEEDED / 10}`);
  } else {
    reporter.pass('L0.ZIP.VERSION', `the highest ZIP feature level any entry needs is ${archive.maxVersionNeeded / 10}`);
  }

  reportFlags(reporter, entries);

  if (archive.layout.ok) reporter.pass('L0.ZIP.LAYOUT', archive.layout.detail);
  else reporter.fail('L0.ZIP.LAYOUT', archive.layout.reason_code, archive.layout.detail);

  if (archive.metadata.ok) reporter.pass('L0.ZIP.METADATA', archive.metadata.detail);
  else reporter.fail('L0.ZIP.METADATA', archive.metadata.reason_code, archive.metadata.detail);

  reportEntrySet(reporter, entries);

  const readings = [];
  const files = new Map();
  for (const entry of entries) {
    const read = await readEntryData(state.bytes, entry, limits);
    readings.push({ entry, read });
    if (read.ok && !files.has(entry.name)) files.set(entry.name, { entry, read });
  }
  state.files = files;
  state.readings = readings;

  reportDecoding(reporter, readings);
  reportSizes(reporter, readings);
  reportCrcs(reporter, readings);
}

/**
 * @param {Reporter} reporter
 * @param {object[]} entries
 * @returns {void}
 */
function reportFlags(reporter, entries) {
  for (const entry of entries) {
    const result = evaluateEntryFlags(entry);
    if (result.ok) continue;
    if (result.status === STATUS.UNSUPPORTED) reporter.unsupported('L0.ZIP.FLAGS', result.reason_code, result.detail);
    else reporter.fail('L0.ZIP.FLAGS', result.reason_code, result.detail);
    return;
  }
  reporter.pass('L0.ZIP.FLAGS', `all ${entries.length} entries set only the bits charter/0.1 allows`);
}

/**
 * @param {Reporter} reporter
 * @param {object[]} entries
 * @returns {void}
 */
function reportEntrySet(reporter, entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
  }
  const duplicated = [...counts.entries()].filter(([, count]) => count > 1).sort();
  if (duplicated.length > 0) {
    const [name, count] = duplicated[0];
    reporter.fail('L0.ZIP.ENTRY_SET', REASON.DUPLICATE, `the archive holds ${count} entries named "${name}", and a name identifies one entry`);
    return;
  }
  const missing = REQUIRED_ENTRIES.filter((name) => !counts.has(name));
  if (missing.length > 0) {
    reporter.fail('L0.ZIP.ENTRY_SET', REASON.MISSING, `the archive has no "${missing[0]}" entry, and charter/0.1 requires ${REQUIRED_ENTRIES.length} entries: ${REQUIRED_ENTRIES.join(', ')}`);
    return;
  }
  const extra = [...counts.keys()].filter((name) => !REQUIRED_ENTRIES.includes(name)).sort();
  if (extra.length > 0) {
    reporter.fail('L0.ZIP.ENTRY_SET', REASON.EXTRA, `the archive also holds "${extra[0]}", which is not one of the ${REQUIRED_ENTRIES.length} entries charter/0.1 defines`);
    return;
  }
  reporter.pass('L0.ZIP.ENTRY_SET', `exactly the ${REQUIRED_ENTRIES.length} required entries are present: ${REQUIRED_ENTRIES.join(', ')}`);
}

/**
 * @param {Reporter} reporter
 * @param {{ entry: object, read: object }[]} readings
 * @returns {void}
 */
function reportDecoding(reporter, readings) {
  for (const { read } of readings) {
    if (read.ok) continue;
    if (read.status === STATUS.UNSUPPORTED) reporter.unsupported('L0.ZIP.ENTRY_DATA', read.reason_code, read.detail);
    else reporter.fail('L0.ZIP.ENTRY_DATA', read.reason_code, read.detail);
    return;
  }
  reporter.pass('L0.ZIP.ENTRY_DATA', `all ${readings.length} entries decode from the stored or deflated bytes their headers declare`);
}

/**
 * @param {Reporter} reporter
 * @param {{ entry: object, read: object }[]} readings
 * @returns {void}
 */
function reportSizes(reporter, readings) {
  for (const { entry, read } of readings) {
    if (read.ok && !read.size_ok) {
      reporter.fail('L0.ZIP.SIZES', REASON.MISMATCH, `"${entry.name}" declares ${read.declared_size} uncompressed byte(s) and holds ${read.actual_size}`);
      return;
    }
  }
  const unreadable = readings.find(({ read }) => !read.ok);
  if (unreadable !== undefined) {
    reporter.skip('L0.ZIP.SIZES', `the declared size of "${unreadable.entry.name}" cannot be confirmed until its bytes can be read`);
    return;
  }
  reporter.pass('L0.ZIP.SIZES', `every entry declares the uncompressed size it has`);
}

/**
 * @param {Reporter} reporter
 * @param {{ entry: object, read: object }[]} readings
 * @returns {void}
 */
function reportCrcs(reporter, readings) {
  for (const { entry, read } of readings) {
    if (read.ok && !read.crc_ok) {
      reporter.fail('L0.ZIP.CRC32', REASON.MISMATCH, `"${entry.name}" declares CRC-32 ${read.declared_crc32} and its bytes give ${read.actual_crc32}`);
      return;
    }
  }
  const unreadable = readings.find(({ read }) => !read.ok);
  if (unreadable !== undefined) {
    reporter.skip('L0.ZIP.CRC32', `the declared CRC-32 of "${unreadable.entry.name}" cannot be confirmed until its bytes can be read`);
    return;
  }
  reporter.pass('L0.ZIP.CRC32', `every entry declares the CRC-32 of the bytes it holds`);
}

/**
 * The prefix that marks a check id as "part of the manifest's own rules".
 * @type {readonly string[]}
 */
const MANIFEST_DEPENDENT_PREFIXES = Object.freeze([
  'L0.FORMAT.',
  'L0.MANIFEST.CANONICAL',
  'L0.MANIFEST.FIELDS',
  'L0.MANIFEST.EXTRA_FIELDS',
  'L0.CONTENT.HASH',
  'L1.',
  'L2.CHAIN.HEAD_MATCHES_CONTENT',
]);

/**
 * Leave unrun every check whose input is the manifest, because the manifest's
 * bytes never became a value.
 *
 * @param {Reporter} reporter
 * @param {string} detail
 * @returns {void}
 */
function skipManifestDependents(reporter, detail) {
  for (const prefix of MANIFEST_DEPENDENT_PREFIXES) {
    reporter.skipUnset(prefix, detail);
  }
}

/**
 * Leave unrun every check that depends on knowing the format version.
 *
 * @param {Reporter} reporter
 * @param {string} detail
 * @param {string} reason_code
 * @returns {void}
 */
function skipFormatDependents(reporter, detail, reason_code) {
  reporter.skipUnset('', detail, reason_code);
}

/**
 * What the artifact claims about itself, for a reader who wants a name and a
 * title next to the verdict. None of this is verified data; the checks are.
 *
 * @param {Record<string, any>} state
 * @returns {object | null}
 */
function describeArtifact(state) {
  if (state.manifest === undefined) return null;
  const manifest = state.manifest;
  return {
    format: manifest.format,
    title: manifest.title,
    created_at: manifest.created_at,
    author_name: manifest.author.name,
    author_key_id: manifest.author.key_id,
    entries: Array.isArray(state.lines) ? state.lines.length : 0,
    head_content_sha256: manifest.content.sha256,
  };
}

/**
 * The checks that read content.md.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @returns {Promise<void>}
 */
async function examineContent(reporter, state) {
  const held = state.files.get(ENTRY_CONTENT);
  if (held === undefined) {
    reporter.skipUnset('L0.CONTENT.', 'content.md could not be read, so its bytes could not be examined');
    return;
  }
  const bytes = held.read.data;
  state.contentBytes = bytes;

  const decoded = utf8Decode(bytes);
  const hasBom = bytes.length >= BOM.length && BOM.every((value, index) => bytes[index] === value);
  if (!decoded.ok) {
    reporter.fail('L0.CONTENT.UTF8', REASON.DECODE_ERROR, `content.md is ${bytes.length} bytes that are not valid UTF-8`);
  } else if (hasBom) {
    reporter.fail('L0.CONTENT.UTF8', REASON.NON_CANONICAL, 'content.md begins with a UTF-8 byte order mark (EF BB BF), and charter/0.1 does not allow one: the bytes of the file are the content, so a mark would be content too');
  } else {
    reporter.pass('L0.CONTENT.UTF8', `content.md is ${bytes.length} bytes of valid UTF-8 and carries no byte order mark`);
  }

  if (reporter.statusOf('L0.CONTENT.HASH') !== null) return;
  const manifest = state.manifest;
  if (manifest === undefined) {
    // manifest.json parsed and declared this format, and one of its fields was
    // not readable, so there is no declared digest for the bytes below. That is
    // not a reason to crash, and it is not a pass: the check is left unrun.
    reporter.skip('L0.CONTENT.HASH', "manifest.content.sha256 could not be read, so the digest of content.md has nothing to be compared with");
    return;
  }
  const declaredHex = manifest.content.sha256;
  const declared = fromHexLower(declaredHex, DIGEST_HEX / 2);
  if (!declared.ok) {
    reporter.fail('L0.CONTENT.HASH', REASON.NON_CANONICAL_ENCODING, `manifest.content.sha256 is not a SHA-256 digest: ${declared.detail}`);
    return;
  }
  const digest = await sha256(bytes);
  if (digest === null) {
    reporter.unsupported('L0.CONTENT.HASH', REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so the declared digest of content.md could not be confirmed');
  } else if (bytesEqual(digest, declared.value)) {
    reporter.pass('L0.CONTENT.HASH', `SHA-256 of content.md is ${toHex(digest)}`);
  } else {
    reporter.fail('L0.CONTENT.HASH', REASON.MISMATCH, `SHA-256 of content.md is ${toHex(digest)}, and manifest.content.sha256 declares ${declaredHex}`);
  }
}

/**
 * The checks that read provenance.jsonl.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {typeof LIMITS} limits
 * @returns {void}
 */
function examineLog(reporter, state, limits) {
  const held = state.files.get(ENTRY_PROVENANCE);
  if (held === undefined) {
    reporter.skipUnset('L0.PROVENANCE.', 'provenance.jsonl could not be read, so its lines could not be examined');
    reporter.skipUnset('L1.PROVENANCE.', 'provenance.jsonl could not be read, so no entry could be compared');
    reporter.skipUnset('L2.CHAIN.', 'provenance.jsonl could not be read, so there is no chain to walk');
    return;
  }
  const bytes = held.read.data;
  state.provenanceBytes = bytes;

  const split = splitLines(bytes, limits);
  if (!split.ok) {
    reporter.fail('L0.PROVENANCE.PARSE', split.reason_code, split.detail);
    skipLogDependents(reporter, 'provenance.jsonl is not one JSON object per LF-terminated line, so its entries could not be read');
    return;
  }

  const lines = split.lines;
  const values = [];
  state.lines = lines;
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseLine(lines[index], index + 1);
    if (!parsed.ok) {
      reporter.fail('L0.PROVENANCE.PARSE', parsed.reason_code, parsed.detail);
      skipLogDependents(reporter, `provenance line ${index + 1} could not be read, so the entries after it could not be examined`);
      return;
    }
    values.push(parsed.value);
  }
  state.lineValues = values;
  reporter.pass('L0.PROVENANCE.PARSE', `provenance.jsonl is ${lines.length} JSON object(s), one per LF-terminated line`);

  reportLogEntries(reporter, state, lines, values);
}

/**
 * Leave unrun every check whose input is the log's entries.
 *
 * @param {Reporter} reporter
 * @param {string} detail
 * @returns {void}
 */
function skipLogDependents(reporter, detail) {
  for (const id of ['L0.PROVENANCE.CANONICAL', 'L0.PROVENANCE.FIELDS', 'L0.PROVENANCE.EXTRA_FIELDS', 'L0.PROVENANCE.NONEMPTY', 'L0.PROVENANCE.CONTENT_HASH_FORMAT']) {
    reporter.skipUnset(id, detail);
  }
  reporter.skipUnset('L1.PROVENANCE.', detail);
  reporter.skipUnset('L2.CHAIN.', detail);
}

/**
 * The five checks that judge the entries themselves: that there is at least
 * one, that each line is the canonical form of the object it parses to, that
 * each object's fields are the ones the format defines, and that each declares
 * a well-formed digest of the content it produced.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {Uint8Array[]} lines
 * @param {Record<string, unknown>[]} values
 * @returns {void}
 */
function reportLogEntries(reporter, state, lines, values) {
  if (values.length === 0) {
    reporter.fail('L0.PROVENANCE.NONEMPTY', REASON.MISSING, 'provenance.jsonl holds no entries, and an artifact with no provenance records nothing about where it came from');
  } else {
    reporter.pass('L0.PROVENANCE.NONEMPTY', `provenance.jsonl holds ${values.length} entr${values.length === 1 ? 'y' : 'ies'}`);
  }

  const nonCanonical = findNonCanonicalLine(lines, values);
  if (nonCanonical === null) {
    reporter.pass('L0.PROVENANCE.CANONICAL', `every one of the ${lines.length} line(s) is the canonical form of the object it parses to, each closed by one LF`);
  } else {
    reporter.fail('L0.PROVENANCE.CANONICAL', REASON.NON_CANONICAL, nonCanonical);
  }

  const entries = [];
  let fieldsDefect = null;
  for (let index = 0; index < values.length && fieldsDefect === null; index += 1) {
    const read = readEntry(values[index], index + 1);
    if (read.ok) entries.push(read.entry);
    else fieldsDefect = read;
  }
  if (fieldsDefect === null) {
    state.entries = entries;
    reporter.pass('L0.PROVENANCE.FIELDS', `each of the ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} carries the fields charter/0.1 defines, with the types it defines them as`);
  } else {
    state.entries = null;
    // The field's own reason code, not a constant: a field that is not in the
    // object is MISSING, and only a value that is there and wrong is a
    // malformation (SPEC.md section 5's rule, and section 10's vocabulary).
    reporter.fail('L0.PROVENANCE.FIELDS', fieldsDefect.reason_code, `${fieldsDefect.detail} (${fieldsDefect.reason_code})`);
    reporter.skipUnset('L1.PROVENANCE.', 'an entry\'s fields could not be read, so its author and signature could not be compared');
    reporter.skipUnset('L2.CHAIN.', 'an entry\'s fields could not be read, so the chain they carry cannot be walked');
  }

  const unknown = findUnknownEntryField(values);
  if (unknown === null) {
    reporter.pass('L0.PROVENANCE.EXTRA_FIELDS', 'no entry carries a field this verifier has no rule for');
  } else {
    reporter.fail('L0.PROVENANCE.EXTRA_FIELDS', REASON.UNKNOWN_FIELD, `${unknown} is not a field charter/0.1 defines for an entry, and this verifier reports a field it cannot interpret rather than ignoring it`);
  }

  const badDigest = findUnreadableContentHash(values);
  if (badDigest === null) {
    reporter.pass('L0.PROVENANCE.CONTENT_HASH_FORMAT', `every entry declares a SHA-256 digest of the content it produced, as ${DIGEST_HEX} lowercase hex characters`);
  } else {
    // As above: the absence of a field is MISSING, and a digest that is there
    // and is not the one spelling is NON_CANONICAL_ENCODING. Both codes come
    // from the field's own reader, so the sentence and the code agree.
    reporter.fail('L0.PROVENANCE.CONTENT_HASH_FORMAT', badDigest.reason_code, `${badDigest.detail} (${badDigest.reason_code})`);
  }
}

/**
 * @param {Uint8Array[]} lines
 * @param {Record<string, unknown>[]} values
 * @returns {string | null}
 */
function findNonCanonicalLine(lines, values) {
  for (let index = 0; index < lines.length; index += 1) {
    // The lines carry no terminator: splitLines takes the LF with the separator,
    // and the LF is compared separately by the checks that hash whole lines.
    const expected = canonicalBytes(values[index]);
    if (!bytesEqual(lines[index], expected)) {
      return `line ${index + 1} is ${lines[index].length} bytes, and the canonical bytes of the object it parses to are ${expected.length}`;
    }
  }
  return null;
}

/**
 * @param {Record<string, unknown>[]} values
 * @returns {string | null}
 */
function findUnknownEntryField(values) {
  for (let index = 0; index < values.length; index += 1) {
    const own = findUnknownField(values[index], ENTRY_FIELDS);
    if (own !== null) return `entry ${index + 1}'s ${own}`;
    const author = values[index].author;
    if (author !== null && typeof author === 'object' && !Array.isArray(author)) {
      const nested = findUnknownField(/** @type {Record<string, unknown>} */ (author), ENTRY_AUTHOR_FIELDS);
      if (nested !== null) return `entry ${index + 1}'s author.${nested}`;
    }
  }
  return null;
}

/**
 * The first entry whose `content_sha256` is not readable, if any.
 *
 * The field's own reader decides both the code and the sentence: a field that is
 * absent is MISSING, and a string that is not 64 lowercase hex characters is
 * NON_CANONICAL_ENCODING. This check does not get to choose a code of its own —
 * SPEC.md section 10 gives each code one meaning, and a check that reported a
 * spelling problem for a field nobody wrote would be reading a string it does
 * not have.
 *
 * @param {Record<string, unknown>[]} values
 * @returns {{ reason_code: string, detail: string } | null}
 */
function findUnreadableContentHash(values) {
  for (let index = 0; index < values.length; index += 1) {
    const field = readField(values[index], 'content_sha256', { kind: 'hex', hex_length: DIGEST_HEX / 2 }, `entry ${index + 1}`);
    if (!field.ok) return field;
  }
  return null;
}

/**
 * Decode a fixed-length base64url field, or say precisely why it is not one.
 *
 * @param {string} text
 * @param {string} where
 * @param {number} expectedBytes
 * @returns {{ ok: true, value: Uint8Array } | { ok: false, reason_code: string, detail: string }}
 */
function decodeFixed(text, where, expectedBytes) {
  const decoded = decodeBase64Url(text);
  if (!decoded.ok) {
    return { ok: false, reason_code: REASON.NON_CANONICAL_ENCODING, detail: `${where} is not unpadded base64url: ${decoded.detail}` };
  }
  if (decoded.value.length !== expectedBytes) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `${where} decodes to ${decoded.value.length} byte(s), and ${ALGORITHM} uses ${expectedBytes}` };
  }
  return { ok: true, value: decoded.value };
}

/**
 * Who made this, and whether the signatures are theirs.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @returns {Promise<void>}
 */
async function examineIdentity(reporter, state) {
  const manifest = state.manifest;
  if (manifest === undefined) {
    reporter.skipUnset('L1.', 'the manifest\'s fields could not be read, so there is no key to compare anything with');
    return;
  }
  const key = decodeFixed(manifest.author.public_key, 'manifest.author.public_key', PUBLIC_KEY_BYTES);
  if (!key.ok) {
    reporter.fail('L1.MANIFEST.KEY_ID', key.reason_code, key.detail);
    reporter.fail('L1.MANIFEST.SIGNATURE', key.reason_code, 'no signature can be checked against a public key that could not be read as one');
    reporter.skipUnset('L1.PROVENANCE.', 'the manifest carries no readable public key, so no entry signature could be checked against it');
    return;
  }
  state.publicKey = key.value;

  const derived = await deriveKeyId(key.value);
  if (derived === null) {
    reporter.unsupported('L1.MANIFEST.KEY_ID', REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so the key id could not be derived from the public key it names');
  } else if (derived === manifest.author.key_id) {
    reporter.pass('L1.MANIFEST.KEY_ID', `manifest.author.key_id is the derivation of manifest.author.public_key: ${derived}`);
  } else {
    reporter.fail('L1.MANIFEST.KEY_ID', REASON.MISMATCH, `manifest.author.key_id is "${manifest.author.key_id}", and the derivation of manifest.author.public_key is "${derived}"`);
  }

  await reportManifestSignature(reporter, manifest, key.value);
  reportEntryAuthors(reporter, state);
  await reportEntrySignatures(reporter, state, key.value);
}

/**
 * @param {Reporter} reporter
 * @param {object} manifest
 * @param {Uint8Array} publicKey
 * @returns {Promise<void>}
 */
async function reportManifestSignature(reporter, manifest, publicKey) {
  const signature = decodeFixed(manifest.signature, 'manifest.signature', SIGNATURE_BYTES);
  if (!signature.ok) {
    reporter.fail('L1.MANIFEST.SIGNATURE', signature.reason_code, signature.detail);
    return;
  }
  const verdict = await verifySignature(publicKey, signature.value, manifest.signing_input);
  if (!verdict.ok) {
    if (verdict.reason_code === REASON.UNSUPPORTED_FEATURE) {
      reporter.unsupported('L1.MANIFEST.SIGNATURE', verdict.reason_code, verdict.detail);
    } else {
      reporter.fail('L1.MANIFEST.SIGNATURE', verdict.reason_code, `manifest.signature could not be checked: ${verdict.detail}`);
    }
  } else if (verdict.valid) {
    reporter.pass('L1.MANIFEST.SIGNATURE', `manifest.signature is a valid ${ALGORITHM} signature over the canonical manifest without its signature field, followed by one LF (${manifest.signing_input.length} bytes)`);
  } else {
    reporter.fail('L1.MANIFEST.SIGNATURE', REASON.MISMATCH, 'manifest.signature is not a valid signature over the canonical manifest without its signature field, followed by one LF');
  }
}

/**
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @returns {void}
 */
function reportEntryAuthors(reporter, state) {
  const entries = state.entries;
  if (!Array.isArray(entries)) return;
  const manifest = state.manifest;
  if (manifest === undefined) {
    reporter.skipUnset('L1.PROVENANCE.', "the manifest's fields could not be read, so the entries have no key to be compared with");
    return;
  }
  const keyId = manifest.author.key_id;

  const first = entries[0];
  if (first === undefined) {
    reporter.skip('L1.PROVENANCE.FIRST_AUTHOR', 'provenance.jsonl holds no first entry, so there is no author to compare with the manifest');
  } else if (first.author.key_id === keyId) {
    reporter.pass('L1.PROVENANCE.FIRST_AUTHOR', `the first entry names ${keyId}, the key the manifest carries`);
  } else {
    reporter.fail('L1.PROVENANCE.FIRST_AUTHOR', REASON.MISMATCH, `the first entry names "${first.author.key_id}", and the manifest carries "${keyId}"`);
  }

  const foreign = findForeignAuthor(entries, keyId);
  if (foreign === null) {
    reporter.pass('L1.PROVENANCE.KEYS', `all ${entries.length} entr${entries.length === 1 ? 'y names' : 'ies name'} the one key this artifact carries, ${keyId}`);
  } else {
    reporter.fail('L1.PROVENANCE.KEYS', REASON.MISMATCH, `entry ${foreign} names a key other than "${keyId}", the only key this artifact carries, so that entry names an author nobody can check`);
  }
}

/**
 * @param {object[]} entries
 * @param {string} keyId
 * @returns {number | null} the 1-based line number of the first entry naming another key
 */
function findForeignAuthor(entries, keyId) {
  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index].author.key_id !== keyId) return index + 1;
  }
  return null;
}

/**
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {Uint8Array} publicKey
 * @returns {Promise<void>}
 */
async function reportEntrySignatures(reporter, state, publicKey) {
  const entries = state.entries;
  if (!Array.isArray(entries)) return;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const signature = decodeFixed(entry.signature, `entry ${index + 1}'s signature`, SIGNATURE_BYTES);
    if (!signature.ok) {
      reporter.fail('L1.PROVENANCE.SIGNATURES', signature.reason_code, signature.detail);
      return;
    }
    const verdict = await verifySignature(publicKey, signature.value, entry.signing_input);
    if (!verdict.ok) {
      if (verdict.reason_code === REASON.UNSUPPORTED_FEATURE) {
        reporter.unsupported('L1.PROVENANCE.SIGNATURES', verdict.reason_code, verdict.detail);
      } else {
        reporter.fail('L1.PROVENANCE.SIGNATURES', verdict.reason_code, `entry ${index + 1}'s signature could not be checked: ${verdict.detail}`);
      }
      return;
    }
    if (!verdict.valid) {
      reporter.fail('L1.PROVENANCE.SIGNATURES', REASON.MISMATCH, `entry ${index + 1}'s signature is not a valid ${ALGORITHM} signature over that entry without its signature field, followed by one LF`);
      return;
    }
  }
  reporter.pass('L1.PROVENANCE.SIGNATURES', `each of the ${entries.length} entr${entries.length === 1 ? 'y is' : 'ies is'} signed by the key this artifact carries`);
}

/**
 * The chain: each entry's parent is the SHA-256 of the line before it as that
 * line stands in the file (its canonical JSON and the one LF that closes it),
 * and the last entry describes the content the manifest describes.
 *
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @returns {Promise<void>}
 */
async function examineChain(reporter, state) {
  const entries = state.entries;
  if (!Array.isArray(entries)) {
    reporter.skipUnset('L2.CHAIN.', 'there is no readable chain of entries to walk');
    return;
  }

  const first = entries[0];
  if (first === undefined) {
    reporter.skip('L2.CHAIN.FIRST_PARENT_NULL', 'provenance.jsonl holds no first entry, so there is no first parent to check');
  } else if (first.parent === null) {
    reporter.pass('L2.CHAIN.FIRST_PARENT_NULL', 'the first entry declares no parent, so the chain starts here');
  } else {
    reporter.fail('L2.CHAIN.FIRST_PARENT_NULL', REASON.MISMATCH, `the first entry declares parent ${toHex(first.parent)}, and a chain that starts here must start from nothing`);
  }

  await reportLinks(reporter, state, entries);
  reportHead(reporter, state, entries);
}

/**
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {object[]} entries
 * @returns {Promise<void>}
 */
async function reportLinks(reporter, state, entries) {
  if (entries.length < 2) {
    reporter.pass('L2.CHAIN.LINKS', `the chain holds ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}, so there is no link between entries to check`);
    return;
  }
  for (let index = 1; index < entries.length; index += 1) {
    const previous = state.lines[index - 1];
    // readEntry has already decoded `parent` to its 32 bytes, or null.
    const declared = entries[index].parent;
    if (declared === null) {
      reporter.fail('L2.CHAIN.LINKS', REASON.MISMATCH, `entry ${index + 1} declares no parent, and only the first entry of a chain may`);
      return;
    }
    const expected = await sha256(concat([previous, LF]));
    if (expected === null) {
      reporter.unsupported('L2.CHAIN.LINKS', REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so the hashes that link entries to each other could not be computed');
      return;
    }
    if (!bytesEqual(declared, expected)) {
      reporter.fail('L2.CHAIN.LINKS', REASON.MISMATCH, `entry ${index + 1} declares parent ${toHex(declared)}, and the SHA-256 of line ${index} as it stands in the file (${previous.length} bytes plus one LF) is ${toHex(expected)}, so nothing in this file ties those two entries together`);
      return;
    }
  }
  reporter.pass('L2.CHAIN.LINKS', `each of the ${entries.length - 1} link(s) from one entry to the line before it matches`);
}

/**
 * @param {Reporter} reporter
 * @param {Record<string, any>} state
 * @param {object[]} entries
 * @returns {void}
 */
function reportHead(reporter, state, entries) {
  if (reporter.statusOf('L2.CHAIN.HEAD_MATCHES_CONTENT') !== null) return;
  if (state.manifest === undefined) {
    reporter.skip('L2.CHAIN.HEAD_MATCHES_CONTENT', 'the manifest\'s fields could not be read, so there is nothing to compare the head with');
    return;
  }
  const last = entries[entries.length - 1];
  if (last === undefined) {
    reporter.skip('L2.CHAIN.HEAD_MATCHES_CONTENT', 'provenance.jsonl holds no entry, so there is no head to compare with the manifest');
    return;
  }
  const head = fromHexLower(last.content_sha256, DIGEST_HEX / 2);
  if (!head.ok) {
    reporter.fail('L2.CHAIN.HEAD_MATCHES_CONTENT', REASON.NON_CANONICAL_ENCODING, `the last entry's content_sha256 is not a SHA-256 digest: ${head.detail}`);
    return;
  }
  const declared = state.manifest.content.sha256;
  const content = fromHexLower(declared, DIGEST_HEX / 2);
  if (!content.ok) {
    reporter.fail('L2.CHAIN.HEAD_MATCHES_CONTENT', REASON.NON_CANONICAL_ENCODING, `manifest.content.sha256 is not a SHA-256 digest: ${content.detail}`);
    return;
  }
  if (bytesEqual(head.value, content.value)) {
    reporter.pass('L2.CHAIN.HEAD_MATCHES_CONTENT', `the last entry's content_sha256, ${declared}, is the digest the manifest declares for content.md`);
  } else {
    reporter.fail('L2.CHAIN.HEAD_MATCHES_CONTENT', REASON.MISMATCH, `the last entry declares content_sha256 ${last.content_sha256}, and the manifest declares content.sha256 ${declared}, so the history and the content are not describing the same bytes`);
  }
}
