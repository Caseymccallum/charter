/**
 * Field validation.
 *
 * Charter has exactly two places where a schema is read: the manifest and a
 * provenance entry. Both need the same four answers about every field — is it
 * there, is it the right kind, is it in the one canonical encoding of its
 * value, and is it a field this version has a rule for — so those four answers
 * live here once and the two readers describe themselves as data.
 *
 * Every validator returns the converted value rather than a boolean. A reader
 * then works only from converted values, which is what stops a check and a
 * reader from disagreeing about what a field held.
 *
 * @module verifier/schema
 */

import { decodeBase64Url } from './base64url.js';
import { fromHexLower } from './bytes.js';
import { REASON } from './status.js';

const HEX_LOWER = /^[0-9a-f]+$/;
const ISO_UTC_SECOND = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * @param {unknown} value
 * @returns {string} a phrase for a detail message
 */
export function describeType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  if (type === 'object') return 'an object';
  if (type === 'string') return 'a string';
  if (type === 'number') return 'a number';
  if (type === 'boolean') return 'a boolean';
  return `a ${type}`;
}

/**
 * @param {number} year
 * @returns {boolean}
 */
function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Validate an ISO 8601 UTC date-time at second precision.
 *
 * No Date is constructed: a verifier that consults the host clock's timezone
 * rules is a verifier that can answer differently on two machines, and this
 * format fixes UTC, so there is nothing to resolve.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isIsoUtcSecond(text) {
  const match = ISO_UTC_SECOND.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const monthLength = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
  if (day < 1 || day > monthLength) return false;
  return Number(match[4]) <= 23 && Number(match[5]) <= 59 && Number(match[6]) <= 59;
}

/**
 * @typedef {Object} FieldSpec
 * @property {string} kind one of: null, boolean, array, object, integer, string, enum, hex, hex_or_null, base64url, timestamp
 * @property {string[]} [values] the permitted strings of an enum field
 * @property {number} [hex_length] exact byte length of a hex field
 * @property {number} [byte_length] exact decoded byte length of a base64url field
 * @property {boolean} [non_empty] a string field that may not be ""
 */

/**
 * Read one field. `where` names the place in the words of the specification.
 *
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @param {FieldSpec} spec
 * @param {string} where
 * @returns {{ ok: true, value: unknown } | { ok: false, reason_code: string, detail: string }}
 */
export function readField(object, key, spec, where) {
  const label = `${where}.${key}`;
  if (!Object.prototype.hasOwnProperty.call(object, key)) {
    return { ok: false, reason_code: REASON.MISSING, detail: `${label} is absent` };
  }
  const value = object[key];
  if (spec.kind === 'hex_or_null' && value === null) {
    return { ok: true, value: null };
  }
  if (spec.kind === 'null' && value !== null) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is ${describeType(value)}, not null` };
  }
  if (spec.kind === 'boolean' && typeof value !== 'boolean') {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is ${describeType(value)}, not a boolean` };
  }
  if (spec.kind === 'array' && !Array.isArray(value)) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is ${describeType(value)}, not an array` };
  }
  if (spec.kind === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is ${describeType(value)}, not an object` };
  }
  if (spec.kind === 'null' || spec.kind === 'boolean' || spec.kind === 'array' || spec.kind === 'object') {
    return { ok: true, value };
  }
  if (spec.kind === 'integer') {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is ${describeType(value)}, not an integer` };
    }
    return { ok: true, value };
  }
  if (typeof value !== 'string') {
    return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is ${describeType(value)}, not a string` };
  }
  if (spec.kind === 'string') {
    if (spec.non_empty === true && value.length === 0) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is an empty string` };
    }
    return { ok: true, value };
  }
  if (spec.kind === 'enum') {
    if (!spec.values.includes(value)) {
      const allowed = spec.values.map((one) => `"${one}"`).join(', ');
      return { ok: false, reason_code: REASON.UNKNOWN_FIELD, detail: `${label} is "${value}", and this version defines only ${allowed}` };
    }
    return { ok: true, value };
  }
  if (spec.kind === 'hex' || spec.kind === 'hex_or_null') {
    const expected = `${spec.hex_length * 2} lowercase hex characters`;
    if (value.length !== spec.hex_length * 2) {
      return { ok: false, reason_code: REASON.NON_CANONICAL_ENCODING, detail: `${label} is ${value.length} characters long, not ${expected}` };
    }
    if (!HEX_LOWER.test(value)) {
      return { ok: false, reason_code: REASON.NON_CANONICAL_ENCODING, detail: `${label} is not ${expected}` };
    }
    const decoded = fromHexLower(value, spec.hex_length);
    if (!decoded.ok) {
      return { ok: false, reason_code: REASON.NON_CANONICAL_ENCODING, detail: `${label}: ${decoded.detail}` };
    }
    return { ok: true, value: decoded.value };
  }
  if (spec.kind === 'base64url') {
    const decoded = decodeBase64Url(value);
    if (!decoded.ok) {
      return { ok: false, reason_code: REASON.NON_CANONICAL_ENCODING, detail: `${label}: ${decoded.detail}` };
    }
    if (decoded.value.length !== spec.byte_length) {
      return { ok: false, reason_code: REASON.NON_CANONICAL_ENCODING, detail: `${label} decodes to ${decoded.value.length} byte(s), not ${spec.byte_length}` };
    }
    return { ok: true, value: decoded.value };
  }
  if (spec.kind === 'timestamp') {
    if (!isIsoUtcSecond(value)) {
      return { ok: false, reason_code: REASON.MALFORMED, detail: `${label} is "${value}", not an ISO 8601 UTC date-time at second precision (YYYY-MM-DDTHH:MM:SSZ)` };
    }
    return { ok: true, value };
  }
  throw new TypeError(`unknown field kind: ${spec.kind}`);
}

/**
 * Find a field that this version has no rule for.
 *
 * Traversal is in sorted key order, so the same document always names the same
 * first offender.
 *
 * @param {Record<string, unknown>} object
 * @param {readonly string[]} allowed
 * @returns {string | null}
 */
export function findUnknownField(object, allowed) {
  const known = new Set(allowed);
  const keys = Object.keys(object).sort();
  for (const key of keys) {
    if (!known.has(key)) return key;
  }
  return null;
}
