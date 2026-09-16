/**
 * The fixed vocabulary of the Charter verifier.
 *
 * Every string a verdict can contain is declared in this file. Checks may not
 * invent a status, a reason code, a verdict or a check id at run time: the
 * reporter refuses an id that is not in the registry below, which is how the
 * kit guarantees that a verdict always has the same shape and the same set of
 * named checks.
 *
 * @module verifier/status
 */

/**
 * Every check returns exactly one of these four values.
 *
 * There is no fifth value and no "pass with warnings". A thing the verifier
 * cannot recognise is never a PASS.
 *
 * @readonly
 * @enum {string}
 */
export const STATUS = Object.freeze({
  /** The check ran and its requirement holds. */
  PASS: 'PASS',
  /** The check ran and its requirement does not hold. */
  FAIL: 'FAIL',
  /** The check could not run because an earlier requirement failed. Never a pass. */
  SKIP: 'SKIP',
  /** The artifact uses something this verifier does not implement. Never a pass. */
  UNSUPPORTED: 'UNSUPPORTED',
});

/**
 * The verdict over all checks.
 *
 * @readonly
 * @enum {string}
 */
export const VERDICT = Object.freeze({
  /** Every check passed. */
  VERIFIED: 'VERIFIED',
  /** No check failed, but at least one requirement was not established. */
  INCOMPLETE: 'INCOMPLETE',
  /** At least one requirement was violated. */
  BROKEN: 'BROKEN',
});

/**
 * Exit codes. `0` verified, `1` nothing proven, `2` broken.
 *
 * @readonly
 */
export const EXIT_CODE = Object.freeze({
  VERIFIED: 0,
  INCOMPLETE: 1,
  BROKEN: 2,
});

/** @readonly @enum {string} */
export const LEVEL = Object.freeze({
  L0: 'L0',
  L1: 'L1',
  L2: 'L2',
});

/**
 * Machine-readable reason attached to every check result.
 *
 * `detail` is prose and may be reworded; `reason_code` is part of the recorded
 * conformance answers and must not be.
 *
 * @readonly
 * @enum {string}
 */
export const REASON = Object.freeze({
  /** The requirement holds. */
  OK: 'OK',
  /** The input is not well formed for its declared type. */
  MALFORMED: 'MALFORMED',
  /** Two well-formed things disagree. */
  MISMATCH: 'MISMATCH',
  /** A required thing is absent. */
  MISSING: 'MISSING',
  /** An unexpected thing is present. */
  EXTRA: 'EXTRA',
  /** The same thing is declared more than once. */
  DUPLICATE: 'DUPLICATE',
  /** Well-formed, but not the single canonical byte sequence for its value. */
  NON_CANONICAL: 'NON_CANONICAL',
  /** A field encoding is not the canonical encoding of the value it carries. */
  NON_CANONICAL_ENCODING: 'NON_CANONICAL_ENCODING',
  /** A number is not an integer, or is not written in canonical integer form. */
  NON_INTEGER_NUMBER: 'NON_INTEGER_NUMBER',
  /** An integer is outside the range that its canonical text can round-trip. */
  NUMBER_OUT_OF_RANGE: 'NUMBER_OUT_OF_RANGE',
  /** Bytes could not be decoded (encoding, or compressed data). */
  DECODE_ERROR: 'DECODE_ERROR',
  /** The version of a container or of the format is not the one implemented. */
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  /** A feature of the container is not implemented by this verifier. */
  UNSUPPORTED_FEATURE: 'UNSUPPORTED_FEATURE',
  /** A field exists that this verifier has no rule for. */
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  /** The input exceeds a declared resource limit, so it is refused. */
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  /** This check needs the result of a check that did not pass. */
  PREREQUISITE_FAILED: 'PREREQUISITE_FAILED',
});

/**
 * The complete list of checks, in report order.
 *
 * `requirement` restates the specification sentence that the check decides.
 * The order of this list is the order of `checks[]` in every verdict, so two
 * runs over the same artifact produce identical output, and verdicts for two
 * artifacts can be compared line by line.
 *
 * @typedef {Object} CheckDefinition
 * @property {string} id
 * @property {string} level
 * @property {string} requirement
 */

/** @type {readonly CheckDefinition[]} */
export const CHECK_REGISTRY = Object.freeze([
  { id: 'L0.ZIP.READABLE', level: LEVEL.L0, requirement: 'The artifact is a ZIP archive whose central directory this verifier can walk.' },
  { id: 'L0.ZIP.VERSION', level: LEVEL.L0, requirement: 'The archive needs no ZIP feature level above the one implemented here (no ZIP64).' },
  { id: 'L0.ZIP.FLAGS', level: LEVEL.L0, requirement: 'No entry sets a general purpose bit other than the UTF-8 name flag and the two deflate level hints.' },
  { id: 'L0.ZIP.LAYOUT', level: LEVEL.L0, requirement: 'Every byte of the file is accounted for by a header, an entry, or the central directory: nothing precedes, follows, or overlaps.' },
  { id: 'L0.ZIP.METADATA', level: LEVEL.L0, requirement: 'The container declares nothing about a host system, a disk, a clock, or file attributes, and each local header repeats the claims in the central directory.' },
  { id: 'L0.ZIP.ENTRY_SET', level: LEVEL.L0, requirement: 'Exactly the three required entries are present, under exactly those names, with no duplicates.' },
  { id: 'L0.ZIP.ENTRY_DATA', level: LEVEL.L0, requirement: 'Every entry is stored or raw-deflated, and its bytes decode.' },
  { id: 'L0.ZIP.SIZES', level: LEVEL.L0, requirement: 'Every entry declares the uncompressed size it actually has.' },
  { id: 'L0.ZIP.CRC32', level: LEVEL.L0, requirement: 'Every entry declares the CRC-32 of the bytes it actually holds.' },
  { id: 'L0.FORMAT.IDENTIFIER', level: LEVEL.L0, requirement: 'manifest.format is exactly "charter/0.1".' },
  { id: 'L0.MANIFEST.PARSE', level: LEVEL.L0, requirement: 'manifest.json is one well-formed JSON object: no duplicate keys, no floats, no unpaired surrogates.' },
  { id: 'L0.MANIFEST.CANONICAL', level: LEVEL.L0, requirement: 'The bytes of manifest.json are exactly the canonical form of its value followed by one LF.' },
  { id: 'L0.MANIFEST.FIELDS', level: LEVEL.L0, requirement: 'The required manifest fields are present, correctly typed, and canonically encoded.' },
  { id: 'L0.MANIFEST.EXTRA_FIELDS', level: LEVEL.L0, requirement: 'manifest.json carries no field this verifier has no rule for.' },
  { id: 'L0.CONTENT.UTF8', level: LEVEL.L0, requirement: 'content.md is valid UTF-8 and does not begin with a byte order mark.' },
  { id: 'L0.CONTENT.HASH', level: LEVEL.L0, requirement: 'SHA-256 of the bytes of content.md equals manifest.content.sha256.' },
  { id: 'L0.PROVENANCE.PARSE', level: LEVEL.L0, requirement: 'provenance.jsonl is one JSON object per line, each line terminated by exactly one LF.' },
  { id: 'L0.PROVENANCE.CANONICAL', level: LEVEL.L0, requirement: 'Each provenance line is exactly the canonical form of its value followed by one LF.' },
  { id: 'L0.PROVENANCE.FIELDS', level: LEVEL.L0, requirement: 'The required fields of every provenance entry are present, correctly typed, and canonically encoded.' },
  { id: 'L0.PROVENANCE.EXTRA_FIELDS', level: LEVEL.L0, requirement: 'No provenance entry carries a field this verifier has no rule for.' },
  { id: 'L0.PROVENANCE.NONEMPTY', level: LEVEL.L0, requirement: 'provenance.jsonl contains at least one entry.' },
  { id: 'L0.PROVENANCE.CONTENT_HASH_FORMAT', level: LEVEL.L0, requirement: 'Every entry content_sha256 is a well-formed lowercase SHA-256 digest.' },
  { id: 'L1.MANIFEST.KEY_ID', level: LEVEL.L1, requirement: 'manifest.author.key_id is the derivation of manifest.author.public_key.' },
  { id: 'L1.MANIFEST.SIGNATURE', level: LEVEL.L1, requirement: 'manifest.signature verifies over the canonical manifest without its signature field.' },
  { id: 'L1.PROVENANCE.FIRST_AUTHOR', level: LEVEL.L1, requirement: 'The first provenance entry names the same author key as the manifest.' },
  { id: 'L1.PROVENANCE.KEYS', level: LEVEL.L1, requirement: 'Every provenance entry names the one key this artifact carries.' },
  { id: 'L1.PROVENANCE.SIGNATURES', level: LEVEL.L1, requirement: 'Every provenance entry signature verifies over its canonical form.' },
  { id: 'L2.CHAIN.FIRST_PARENT_NULL', level: LEVEL.L2, requirement: 'The first entry parent is null.' },
  { id: 'L2.CHAIN.LINKS', level: LEVEL.L2, requirement: 'Each entry parent equals the SHA-256 of the previous entry bytes as they appear in the file.' },
  { id: 'L2.CHAIN.HEAD_MATCHES_CONTENT', level: LEVEL.L2, requirement: 'The last entry content_sha256 equals manifest.content.sha256.' },
]);

/** @type {readonly string[]} */
export const CHECK_IDS = Object.freeze(CHECK_REGISTRY.map((check) => check.id));

/**
 * The result of one check.
 *
 * @typedef {Object} CheckResult
 * @property {string} id
 * @property {string} level
 * @property {string} status
 * @property {string} reason_code
 * @property {string} detail
 * @property {string} requirement
 */
