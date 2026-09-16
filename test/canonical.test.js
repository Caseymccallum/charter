/**
 * The canonical reader.
 *
 * These tests are written against the rules in SPEC.md, not against the
 * implementation: every case here is a byte sequence a reader could be handed,
 * and the answer is what the format says a reader must do with it.
 *
 * The writing direction has its own file, `test/canonical-write.test.js`, and
 * the two directions have a property test between them,
 * `test/canonical.roundtrip.test.js`. Nothing in this file imports the writer:
 * a reader tested through its own writer would agree with itself about a rule it
 * had misread.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJsonText } from '../verifier/canonical.js';
import { REASON } from '../verifier/status.js';

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

test('whitespace between tokens is tolerated, because only the bytes are canonical', () => {
  // Tolerance is deliberate: a document that is well-formed JSON in another
  // spelling has to be *readable* so that it can be refused as NON_CANONICAL by
  // the check that compares bytes. A parser that only accepted the canonical
  // spelling could not tell "this is the wrong bytes" from "this is not JSON",
  // and only one of those is a verdict a stranger can act on.
  assert.deepEqual(parseJsonText('  [1,2]  '), { ok: true, value: [1, 2] });
  // Objects come back with a null prototype on purpose (so that a key called
  // `__proto__` is an ordinary key), so the comparison goes through a plain copy
  // rather than by identity of prototype.
  assert.deepEqual(JSON.parse(JSON.stringify(parseJsonText('\n\t{"a":1}\r\n').value)), { a: 1 });
  assert.equal(parseJsonText('{ "a" : 1 , "b" : [ 1 , 2 ] }').ok, true);
  // Whitespace inside a string is content, and the reader keeps it.
  assert.equal(parseJsonText('{"a":" b\\tc\\n"}').value.a, ' b\tc\n');
});
