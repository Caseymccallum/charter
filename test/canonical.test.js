/**
 * The canonical reader.
 *
 * These tests are written against the rules in SPEC.md, not against the
 * implementation: every case here is a byte sequence a reader could be handed,
 * and the answer is what the format says a reader must do with it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LF,
  canonicalBytes,
  compareByCodePoint,
  parseJsonText,
  quoteString,
  serializeCanonical,
  signingInput,
} from '../verifier/canonical.js';
import { REASON } from '../verifier/status.js';
import { toHex, utf8Encode } from '../verifier/bytes.js';

const REASONS = new Set(Object.values(REASON));

/**
 * @param {string} text
 * @param {string} reason_code
 */
function refuses(text, reason_code) {
  const parsed = parseJsonText(text);
  assert.equal(parsed.ok, false, `expected ${JSON.stringify(text)} to be refused`);
  assert.equal(parsed.reason_code, reason_code, `wrong reason code for ${JSON.stringify(text)}`);
  assert.ok(REASONS.has(parsed.reason_code), 'a reason code must come from the declared vocabulary');
  assert.equal(typeof parsed.detail, 'string');
  assert.ok(parsed.detail.length > 0, 'a refusal must say what is wrong in prose');
}

test('a number is an integer or it is refused', () => {
  refuses('1.5', REASON.NON_INTEGER_NUMBER);
  refuses('1e2', REASON.NON_INTEGER_NUMBER);
  refuses('-0', REASON.NON_INTEGER_NUMBER);
  refuses('01', REASON.NON_INTEGER_NUMBER);
  assert.deepEqual(parseJsonText('-12'), { ok: true, value: -12 });
  assert.deepEqual(parseJsonText('0'), { ok: true, value: 0 });
});

test('an integer outside the round-trippable range is refused', () => {
  refuses('9007199254740993', REASON.NUMBER_OUT_OF_RANGE);
  assert.deepEqual(parseJsonText('9007199254740991'), { ok: true, value: 9007199254740991 });
});

test('one object may not declare the same key twice', () => {
  refuses('{"a":1,"a":2}', REASON.DUPLICATE);
});

test('malformed JSON is refused, never repaired', () => {
  refuses('{} {}', REASON.MALFORMED);
  refuses('[1,2,]', REASON.MALFORMED);
  refuses('+1', REASON.MALFORMED);
  refuses('"a\nb"', REASON.MALFORMED);
  refuses('"\\ud800"', REASON.MALFORMED);
  refuses('', REASON.MALFORMED);
});

test('a surrogate pair is one character and is accepted', () => {
  assert.deepEqual(parseJsonText('"\\ud83d\\ude00"'), { ok: true, value: '\u{1f600}' });
});

test('depth is limited', () => {
  const refused = parseJsonText('[[[1]]]', 2);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason_code, REASON.MALFORMED);
  assert.deepEqual(parseJsonText('[[1]]', 2), { ok: true, value: [[1]] });
});

test('whitespace around the document is tolerated; whitespace inside it is not canonical', () => {
  assert.deepEqual(parseJsonText('  [1,2]  '), { ok: true, value: [1, 2] });
  assert.equal(parseJsonText('{ "a" : 1 }').ok, false);
});

test('keys are ordered by code point, not by UTF-16 code unit', () => {
  assert.equal(serializeCanonical({ b: 1, a: [1, 2] }), '{"a":[1,2],"b":1}');
  assert.equal(serializeCanonical({ '\u{10000}': 1, '\uE000': 2 }), '{"\uE000":2,"\u{10000}":1}');
  assert.equal(compareByCodePoint('\u{10000}', '\uE000'), 1);
  assert.equal(compareByCodePoint('a', 'ab'), -1);
  assert.equal(compareByCodePoint('a', 'a'), 0);
});

test('a string is escaped only where JSON requires it', () => {
  assert.equal(quoteString('a/b\u00e9\u0007"\\\n'), '"a/b\u00e9\\u0007\\"\\\\\\n"');
  assert.equal(quoteString(''), '""');
});

test('canonical text holds no value outside the format', () => {
  assert.throws(() => serializeCanonical(1.5), TypeError);
  assert.throws(() => serializeCanonical(undefined), TypeError);
  assert.throws(() => serializeCanonical(() => 1), TypeError);
  assert.throws(() => serializeCanonical(Symbol('x')), TypeError);
});

test('canonical bytes are the UTF-8 bytes of the canonical text, with no newline', () => {
  assert.equal(toHex(canonicalBytes({ b: 1, a: [1, 2] })), toHex(utf8Encode('{"a":[1,2],"b":1}')));
});

test('the signing input is the canonical form without the signature field, plus one LF', () => {
  assert.equal(toHex(signingInput({ b: 1, signature: 'x' }, 'signature')), '7b2262223a317d0a');
  assert.deepEqual(LF, new Uint8Array([0x0a]));
  assert.equal(toHex(LF), '0a');
});

test('the trailing LF is part of the signing input', () => {
  const without = toHex(canonicalBytes({ b: 1 }));
  const signed = toHex(signingInput({ b: 1 }, 'signature'));
  assert.equal(signed, `${without}0a`);
});
