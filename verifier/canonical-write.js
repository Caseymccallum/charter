/**
 * Canonical JSON, writing direction: a value in, the one byte sequence out.
 *
 * This module and `verifier/canonical.js` are the two directions of one rule.
 * That one reads hostile bytes and produces a value, or a refusal with a reason
 * code; this one takes a value and produces the bytes, or a refusal with the
 * same reason code. They share the specification and the reason vocabulary, and
 * they share no code: nothing here imports the reader, and the reader does not
 * call the writer. Two independent directions is what makes the round-trip
 * property in `test/canonical.roundtrip.test.js` evidence rather than a
 * tautology — a single implementation round-tripped against itself would agree
 * with itself about a spec it had misread.
 *
 * # What this module refuses, and why it refuses rather than repairs
 *
 * The set of values this module accepts is exactly the set of values the reader
 * can produce. Anything outside it is an error a producer can act on, never a
 * document that has quietly lost a field:
 *
 *   - a number that is not an integer, including `-0` and `NaN`: NON_INTEGER_NUMBER,
 *     which is the reader's code for `1.0`, `1e0` and `-0` alike;
 *   - an integer outside ±(2^53 - 1): NUMBER_OUT_OF_RANGE, because `String` would
 *     hand back a different number than the one that was passed in;
 *   - a string (or a key) carrying an unpaired surrogate: MALFORMED, because
 *     UTF-8 has no encoding for one and `TextEncoder` would write U+FFFD, so the
 *     bytes would carry a character the value never held;
 *   - an array with a hole or with an own property that is not an index: MALFORMED,
 *     because `[1,,2]` is not JSON and an array's extra fields are not part of it;
 *   - anything that is not a JSON value at all — `undefined`, a function, a
 *     symbol, a bigint, a `Date`, a `Map`, a class instance, a typed array:
 *     MALFORMED. `JSON.stringify(new Date())` is `"1970-01-01T00:00:00.000Z"`
 *     and `Object.keys(new Date())` is `[]`, so an object walker writes `{}` for
 *     a date without a word. This module would rather refuse than sign `{}`;
 *   - a value nested deeper than 64: MALFORMED, which is the reader's code for
 *     the same condition. A writer without a ceiling does not produce a deep
 *     document, it produces a `RangeError` — and a cycle is caught by the same
 *     ceiling, one level past it, instead of recursing until the stack ends.
 *
 * Failed input throws a `CanonicalWriteError`, which is a `TypeError` so that
 * `assert.throws(..., TypeError)` keeps meaning what it meant, and which carries
 * `reason_code` from the same vocabulary a verdict prints, `detail` in prose,
 * and the `path` of the offending value (`.content.sha256`, `[3].timestamp`) so
 * a producer can say which field of which object it could not write.
 *
 * See SPEC.md section 4.
 *
 * @module verifier/canonical-write
 */

import { concat, utf8Encode } from './bytes.js';
import { LIMITS } from './limits.js';
import { REASON } from './status.js';

/** The one byte that ends a canonical document. */
export const LF = new Uint8Array([0x0a]);

/**
 * A value that cannot be written as canonical JSON.
 *
 * Extends `TypeError` deliberately: every value this module refuses is a value
 * some caller believed was writable, and that is a type error about the value
 * rather than a syntax error in a byte sequence.
 */
export class CanonicalWriteError extends TypeError {
  /**
   * @param {string} reason_code from the vocabulary in `status.js`
   * @param {string} detail what is wrong, in prose
   * @param {string} path where it is, as a dotted/bracketed path
   */
  constructor(reason_code, detail, path) {
    super(path === '' || path === undefined ? detail : `${detail} (at ${path})`);
    this.name = 'CanonicalWriteError';
    this.reason_code = reason_code;
    this.detail = detail;
    this.path = path ?? '';
  }
}

/**
 * @param {string} reason_code
 * @param {string} detail
 * @param {string} path
 * @returns {never}
 */
function refuse(reason_code, detail, path) {
  throw new CanonicalWriteError(reason_code, detail, path);
}

/**
 * Refuse a string whose code units cannot be encoded as UTF-8.
 *
 * A lone surrogate is not a character: it is half of one that went missing.
 * `TextEncoder` answers it with U+FFFD rather than an error, so writing one
 * produces bytes that decode to a different string than the one that was
 * written, and a signature over those bytes covers text nobody can reconstruct.
 * The reader refuses an unpaired surrogate *escape*; this refuses an unpaired
 * surrogate *value*, and both are MALFORMED.
 *
 * @param {string} text
 * @param {string} path
 * @returns {void}
 */
function assertEncodable(text, path) {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        refuse(REASON.MALFORMED, 'the string holds an unpaired high surrogate, which UTF-8 cannot encode', `${path}[${i}]`);
      }
      i += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      refuse(REASON.MALFORMED, 'the string holds an unpaired low surrogate, which UTF-8 cannot encode', `${path}[${i}]`);
    }
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Escapes that have a short form. Every other character is written literally, or as `\uXXXX` if it is a control character. */
const SHORT_ESCAPES = new Map([
  [0x08, '\\b'],
  [0x09, '\\t'],
  [0x0a, '\\n'],
  [0x0c, '\\f'],
  [0x0d, '\\r'],
  [0x22, '\\"'],
  [0x5c, '\\\\'],
]);

/**
 * Quote a string the one way this format allows.
 *
 * Escapes only where JSON requires one, plus the two characters that must be
 * escaped anywhere: `"` and `\`. Everything else above U+001F is literal, so `/`
 * is `/` and `é` is `é`. Other encodings of the same string (`\u00e9` for `é`,
 * `\/` for `/`) are well-formed JSON and are rejected as non-canonical.
 *
 * @param {string} text
 * @param {string} [path] where the string is, for a refusal
 * @returns {string}
 */
export function quoteString(text, path = '') {
  assertEncodable(text, path);
  let out = '"';
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const short = SHORT_ESCAPES.get(code);
    if (short !== undefined) {
      out += short;
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += text[i];
    }
  }
  return `${out}"`;
}

/**
 * Compare two strings by Unicode code point.
 *
 * Code point order, not UTF-16 code unit order: they disagree for the range
 * above U+FFFF against U+E000..U+FFFF, and the specification says code point.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareByCodePoint(a, b) {
  if (a === b) return 0;
  let i = 0;
  for (;;) {
    const left = a.codePointAt(i);
    const right = b.codePointAt(i);
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left !== right) return left < right ? -1 : 1;
    i += left > 0xffff ? 2 : 1;
  }
}

/**
 * Write a number, or refuse it by the rule it breaks.
 *
 * @param {number} value
 * @param {string} path
 * @returns {string}
 */
function writeNumber(value, path) {
  if (!Number.isInteger(value)) {
    refuse(REASON.NON_INTEGER_NUMBER, `canonical JSON holds integers only, and ${String(value)} is not one`, path);
  }
  if (Object.is(value, -0)) {
    refuse(REASON.NON_INTEGER_NUMBER, 'negative zero is not representable: it and zero would be two byte sequences for one value', path);
  }
  if (!Number.isSafeInteger(value)) {
    refuse(REASON.NUMBER_OUT_OF_RANGE, `${String(value)} is outside the range an integer can round-trip through this format`, path);
  }
  return String(value);
}

/**
 * Write a value at a known depth.
 *
 * @param {unknown} value
 * @param {number} depth how many containers enclose this value
 * @param {string} path
 * @param {number} maxDepth
 * @returns {string}
 */
function write(value, depth, path, maxDepth) {
  if (depth > maxDepth) {
    refuse(REASON.MALFORMED, `the value nests deeper than the declared limit of ${maxDepth}`, path);
  }

  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return writeNumber(value, path);
  if (typeof value === 'string') return quoteString(value, path);

  if (Array.isArray(value)) {
    // Every index, and nothing but indices. A hole and an extra own property are
    // one condition: the array is not the sequence of values it appears to be,
    // and `join` would write a document that is not JSON.
    const carried = Object.keys(value).length;
    if (carried !== value.length) {
      refuse(
        REASON.MALFORMED,
        `the array carries ${carried} value(s) for ${value.length} index(es), and a hole or an extra field is not something JSON can write`,
        path,
      );
    }
    const parts = value.map((item, index) => write(item, depth + 1, `${path}[${index}]`, maxDepth));
    return `[${parts.join(',')}]`;
  }

  if (typeof value === 'object') {
    if (!isPlainObject(value)) {
      refuse(
        REASON.MALFORMED,
        `only plain objects and arrays are representable, and this is a ${value.constructor === undefined ? 'prototype-less foreign object' : value.constructor.name}, which would be written as the fields it happens to enumerate`,
        path,
      );
    }
    const keys = Object.keys(value).sort(compareByCodePoint);
    const members = keys.map((key) => {
      assertEncodable(key, `${path}.${key}`);
      return `${quoteString(key)}:${write(value[key], depth + 1, `${path}.${key}`, maxDepth)}`;
    });
    return `{${members.join(',')}}`;
  }

  return refuse(REASON.MALFORMED, `canonical JSON holds no ${typeof value} values`, path);
}

/**
 * Serialize a value to its canonical text.
 *
 * @param {unknown} value
 * @param {number} [maxDepth]
 * @returns {string}
 */
export function serializeCanonical(value, maxDepth = LIMITS.MAX_JSON_DEPTH) {
  return write(value, 0, '', maxDepth);
}

/**
 * The canonical bytes of a value: its canonical text, UTF-8 encoded, with no
 * newline.
 *
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function canonicalBytes(value) {
  return utf8Encode(serializeCanonical(value));
}

/**
 * The canonical bytes of a document: the canonical form of the value and
 * exactly one LF.
 *
 * This is the rule in SPEC.md section 4 written once. Every caller that spelled
 * `concat([canonicalBytes(value), LF])` by hand was restating the rule, and a
 * rule restated at each call site is a rule that will eventually disagree with
 * itself at one of them.
 *
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function canonicalDocument(value) {
  return concat([canonicalBytes(value), LF]);
}

/**
 * The bytes a signature is computed over: the canonical form of the object
 * with its signature field removed, then one LF.
 *
 * The trailing LF is what stops a signature from being moved between two
 * places in a document whose canonical texts are a suffix of one another.
 *
 * @param {Record<string, unknown>} object
 * @param {string} signatureField
 * @returns {Uint8Array}
 */
export function signingInput(object, signatureField) {
  if (!isPlainObject(object)) {
    refuse(REASON.MALFORMED, 'a signing input is the canonical form of a plain object, and this is not one', '');
  }
  const copy = Object.create(null);
  for (const key of Object.keys(object)) {
    if (key !== signatureField) copy[key] = object[key];
  }
  return concat([canonicalBytes(copy), LF]);
}
