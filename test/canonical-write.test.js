/**
 * The canonical serializer.
 *
 * These tests are written against the rules in SPEC.md, not against the
 * implementation: every case here is a value a producer could hold, and the
 * answer is what the format says a writer must do with it. The rules are the
 * reader's rules — `test/canonical.test.js` states the same rules for the other
 * direction — because a value the writer can write and the reader cannot read
 * would be a document this format can produce and not check.
 *
 * A refusal is a result here, not an accident: this module throws where the
 * reader returns a verdict, so that a producer cannot write a document that has
 * quietly lost a field. Each refusal carries the reason code a verdict would
 * print for the same defect, so the two directions agree about what went wrong
 * and not only about the fact that something did.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CanonicalWriteError,
  LF,
  canonicalBytes,
  canonicalDocument,
  compareByCodePoint,
  quoteString,
  serializeCanonical,
  signingInput,
} from '../verifier/canonical-write.js';
import { toHex, utf8Encode } from '../verifier/bytes.js';
import { LIMITS } from '../verifier/limits.js';
import { REASON } from '../verifier/status.js';

const REASONS = new Set(Object.values(REASON));

/**
 * Insist that a value is refused, with the named reason, and that the refusal
 * says where.
 *
 * @param {unknown} value
 * @param {string} reason_code
 * @param {string} [path]
 */
function refuses(value, reason_code, path) {
  let error = null;
  try {
    serializeCanonical(value);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof CanonicalWriteError, 'a refusal must be a CanonicalWriteError');
  assert.equal(error.reason_code, reason_code, `wrong reason code: ${error.message}`);
  assert.ok(REASONS.has(error.reason_code), 'a reason code must come from the declared vocabulary');
  assert.ok(error.detail.length > 0, 'a refusal must say what is wrong in prose');
  if (path !== undefined) assert.equal(error.path, path, `wrong path: ${error.path}`);
}

test('keys are ordered by code point, not by UTF-16 code unit', () => {
  assert.equal(serializeCanonical({ b: 1, a: [1, 2] }), '{"a":[1,2],"b":1}');
  assert.equal(serializeCanonical({ '\u{10000}': 1, '\uE000': 2 }), '{"\uE000":2,"\u{10000}":1}');
  assert.equal(compareByCodePoint('\u{10000}', '\uE000'), 1);
  assert.equal(compareByCodePoint('a', 'ab'), -1);
  assert.equal(compareByCodePoint('a', 'a'), 0);
});

test('there is no whitespace anywhere', () => {
  assert.equal(serializeCanonical({ a: [1, 2], b: { c: 'd' } }), '{"a":[1,2],"b":{"c":"d"}}');
});

test('a string is escaped only where JSON requires it', () => {
  assert.equal(quoteString('a/b\u00e9\u0007"\\\n'), '"a/b\u00e9\\u0007\\"\\\\\\n"');
  assert.equal(quoteString(''), '""');
  // Non-ASCII is passed through, not escaped: `\u00e9` for `é` is the same value
  // in a different byte sequence, and the format has one byte sequence per value.
  assert.equal(serializeCanonical({ title: 'café — naïve' }), '{"title":"café — naïve"}');
});

test('the empty containers are written, not skipped', () => {
  // The cases canonical rules get wrong: an empty object is `{}` and an empty
  // array is `[]`, and neither is the same as an absent field.
  assert.equal(serializeCanonical({}), '{}');
  assert.equal(serializeCanonical([]), '[]');
  assert.equal(serializeCanonical({ a: {}, b: [], c: '' }), '{"a":{},"b":[],"c":""}');
});

test('a number is an integer or it is refused', () => {
  refuses({ a: 1.5 }, REASON.NON_INTEGER_NUMBER, '.a');
  refuses(NaN, REASON.NON_INTEGER_NUMBER, '');
  refuses(Infinity, REASON.NON_INTEGER_NUMBER, '');
  // `1e21` is an integer *value* that is too large to write, so it is out of
  // range rather than non-integer. The reader tells the two apart by the text it
  // was handed (`1e0` is refused as a spelling, `9007199254740993` as a range);
  // a value carries no spelling, so the two codes split by value here.
  refuses(1e21, REASON.NUMBER_OUT_OF_RANGE, '');
  assert.equal(Number.isInteger(1e21), true, 'and this is why: it is an integer, it is just not one this format can hold');
  assert.equal(serializeCanonical(0), '0');
  assert.equal(serializeCanonical(-12), '-12');
});

test('negative zero is refused, because it and zero are two byte sequences for one value', () => {
  // `String(-0)` is `"0"`: writing it would hand back a document that says zero
  // when the value said negative zero, and the reader refuses `-0` by name.
  refuses(-0, REASON.NON_INTEGER_NUMBER, '');
  refuses({ a: -0 }, REASON.NON_INTEGER_NUMBER, '.a');
  assert.equal(serializeCanonical(0), '0');
});

test('the safe-integer boundary is written at the edge and refused one past it', () => {
  assert.equal(serializeCanonical(Number.MAX_SAFE_INTEGER), '9007199254740991');
  assert.equal(serializeCanonical(Number.MIN_SAFE_INTEGER), '-9007199254740991');
  // Past the edge `String` produces a different number than the one passed in, so
  // there is no document to write: it is a refusal, never a rounded value.
  refuses(Number.MAX_SAFE_INTEGER + 1, REASON.NUMBER_OUT_OF_RANGE, '');
  refuses(Number.MIN_SAFE_INTEGER - 1, REASON.NUMBER_OUT_OF_RANGE, '');
  assert.equal(String(Number.MAX_SAFE_INTEGER + 1), '9007199254740992', 'and this is the number it would have written');
  refuses({ content: { bytes: 2 ** 53 } }, REASON.NUMBER_OUT_OF_RANGE, '.content.bytes');
});

test('an unpaired surrogate is refused instead of being written as U+FFFD', () => {
  refuses('\ud800', REASON.MALFORMED, '[0]');
  refuses({ a: 'x\udc00' }, REASON.MALFORMED, '.a[1]');
  refuses({ '\ud800': 1 }, REASON.MALFORMED, '.\ud800[0]');
  // A correctly paired surrogate is an ordinary character and is written as
  // itself; `TextEncoder` then writes four bytes for it, which is the point.
  assert.equal(serializeCanonical({ a: '😀' }), '{"a":"😀"}');
  assert.equal(toHex(canonicalBytes({ a: '😀' })), toHex(utf8Encode('{"a":"😀"}')));
  assert.equal(new TextDecoder().decode(canonicalBytes({ a: '😀' })), '{"a":"😀"}');
});

test('an array is its indices and nothing else', () => {
  // A hole becomes an empty string under `join`, and `[1,,2]` is not JSON.
  refuses([1, , 2], REASON.MALFORMED, '');
  refuses(new Array(3), REASON.MALFORMED, '');
  const withExtra = [1];
  withExtra.x = 2;
  refuses(withExtra, REASON.MALFORMED, '');
  assert.equal(serializeCanonical([1, [2], {}]), '[1,[2],{}]');
});

test('values with no JSON representation are refused', () => {
  assert.throws(() => serializeCanonical(undefined), TypeError);
  assert.throws(() => serializeCanonical(() => 1), TypeError);
  assert.throws(() => serializeCanonical(Symbol('x')), TypeError);
  assert.throws(() => serializeCanonical(1n), TypeError);
  refuses(undefined, REASON.MALFORMED, '');
  refuses({ a: () => 1 }, REASON.MALFORMED, '.a');
  refuses({ a: Symbol('x') }, REASON.MALFORMED, '.a');
  refuses({ a: 1n }, REASON.MALFORMED, '.a');
});

test('an object that is not a plain object is refused rather than written as the fields it enumerates', () => {
  // `Object.keys(new Date())` is `[]`, so an object walker writes `{}` for a date
  // without a word, and `JSON.stringify` writes a timestamp instead. Neither is a
  // document this format defines, so both are refused.
  refuses(new Date(), REASON.MALFORMED, '');
  refuses({ a: new Map() }, REASON.MALFORMED, '.a');
  refuses({ a: new Set([1]) }, REASON.MALFORMED, '.a');
  refuses({ a: new Uint8Array([1]) }, REASON.MALFORMED, '.a');
  refuses({ a: new (class Point { constructor() { this.x = 1; } })() }, REASON.MALFORMED, '.a');
  assert.equal(serializeCanonical(Object.create(null)), '{}', 'a prototype-less object is what the reader builds, so it is writable');
  const foreign = Object.create(null);
  foreign.a = 1;
  assert.equal(serializeCanonical(foreign), '{"a":1}');
});

test('nesting is capped at the declared limit, and a cycle is caught by the same ceiling', () => {
  const nest = (depth) => {
    let value = 1;
    for (let i = 0; i < depth; i += 1) value = [value];
    return value;
  };
  assert.equal(LIMITS.MAX_JSON_DEPTH, 64, 'the spec declares 64, and this test is written against the number');
  assert.equal(serializeCanonical(nest(64)), `${'['.repeat(64)}1${']'.repeat(64)}`);
  refuses(nest(65), REASON.MALFORMED, `${'[0]'.repeat(65)}`);
  // A value that contains itself nests forever, which is the same condition: the
  // ceiling turns it into a refusal instead of a stack overflow.
  const cyclic = {};
  cyclic.self = cyclic;
  refuses(cyclic, REASON.MALFORMED, `${'.self'.repeat(65)}`);
});

test('canonical bytes are the UTF-8 bytes of the canonical text, with no newline', () => {
  assert.equal(toHex(canonicalBytes({ b: 1, a: [1, 2] })), toHex(utf8Encode('{"a":[1,2],"b":1}')));
});

test('a document is the canonical bytes and exactly one LF', () => {
  const value = { a: 1 };
  assert.equal(toHex(canonicalDocument(value)), `${toHex(canonicalBytes(value))}0a`);
  assert.equal(canonicalDocument(value).length, canonicalBytes(value).length + 1);
  assert.deepEqual(LF, new Uint8Array([0x0a]));
  assert.equal(toHex(LF), '0a');
});

test('the signing input is the canonical form without the signature field, plus one LF', () => {
  assert.equal(toHex(signingInput({ b: 1, signature: 'x' }, 'signature')), '7b2262223a317d0a');
  const without = toHex(canonicalBytes({ b: 1 }));
  const signed = toHex(signingInput({ b: 1 }, 'signature'));
  assert.equal(signed, `${without}0a`, 'the trailing LF is part of the signing input');
  // A signature field that is not there is not invented, and the field named is
  // the only one removed.
  assert.equal(toHex(signingInput({ a: 1 }, 'signature')), toHex(canonicalDocument({ a: 1 })));
  assert.equal(toHex(signingInput({ a: 1, signature: 'x', b: 2 }, 'signature')), toHex(canonicalDocument({ a: 1, b: 2 })));
});

test('a signing input is a plain object, and the refusal says so', () => {
  for (const value of [null, undefined, 42, 'a', [], new Date()]) {
    assert.throws(() => signingInput(value, 'signature'), CanonicalWriteError, `${String(value)} is not a plain object`);
  }
});
