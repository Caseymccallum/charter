/**
 * The canonical JSON parser, under hostile input.
 *
 * The parser is the most load-bearing component in the project: it decides what
 * counts as canonical, and canonicality is the format's central claim. It is
 * also the only place where bytes an adversary chose are turned into a value
 * this verifier then reasons about.
 *
 * The governing property, above every individual case below, is that **the
 * verifier never throws**. Every input — valid, invalid, or hostile — produces a
 * verdict with a status and a reason code from the declared vocabulary. An
 * uncaught exception is a bug in the verifier, not a bug in the input, so the
 * corpus at the bottom is fed through both the parser and the whole verifier
 * and any escape is a failure.
 *
 * The parser's shape, for the reader trying to place these cases: one
 * recursive-descent scan that validates while it reads, records the first
 * violation, and stops. There is no token stream and no second pass, so a case
 * that a two-pass parser would report as "well-formed then non-canonical" is
 * reported here by whichever rule sees it first.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOSTILE_TEXT } from './corpus.js';
import { parseJsonBytes, parseJsonText } from '../verifier/canonical.js';
import { canonicalBytes, compareByCodePoint, LF, serializeCanonical } from '../verifier/canonical-write.js';
import { bytesEqual, concat, utf8Encode } from '../verifier/bytes.js';
import { LIMITS } from '../verifier/limits.js';
import { CHECK_IDS, EXIT_CODE, REASON, STATUS, VERDICT } from '../verifier/status.js';
import { verify } from '../verifier/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'vectors');

const REASONS = new Set(Object.values(REASON));
const STATUSES = new Set(Object.values(STATUS));
const VERDICTS = new Set(Object.values(VERDICT));

/**
 * Parse, and insist the input was refused with the named reason.
 *
 * @param {string} text
 * @param {string} reason_code
 */
function refuses(text, reason_code) {
  const parsed = parseJsonText(text);
  assert.equal(parsed.ok, false, `expected ${JSON.stringify(text)} to be refused`);
  assert.equal(parsed.reason_code, reason_code, `wrong reason code for ${JSON.stringify(text)}`);
  assert.ok(REASONS.has(parsed.reason_code), 'a reason code must come from the declared vocabulary');
  assert.ok(typeof parsed.detail === 'string' && parsed.detail.length > 0, 'a refusal must say what is wrong');
  assert.equal(Object.prototype.hasOwnProperty.call(parsed, 'value'), false, 'a refusal carries no value');
}

/**
 * Parse, and insist the input was accepted with the value `value`.
 *
 * The parser builds objects with a null prototype on purpose (a key called
 * `__proto__` is then an ordinary key), so a comparison against an object
 * literal has to be made through a plain copy rather than by identity of
 * prototype. Only values that JSON can carry are compared this way, which is
 * every value this format has.
 *
 * @param {string} text
 * @param {unknown} value
 */
function accepts(text, value) {
  const parsed = parseJsonText(text);
  assert.equal(parsed.ok, true, `expected ${JSON.stringify(text)} to be accepted`);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.value)), value, `wrong value for ${JSON.stringify(text)}`);
}

/**
 * Parse without letting anything escape: `{ threw: string | null, result }`.
 *
 * @param {string} text
 * @returns {{ threw: string | null, result: ReturnType<typeof parseJsonText> | null }}
 */
function attempt(text) {
  try {
    return { threw: null, result: parseJsonText(text) };
  } catch (error) {
    return { threw: error instanceof Error ? `${error.name}: ${error.message}` : String(error), result: null };
  }
}

/**
 * Whether a document's bytes are exactly the canonical form of its value plus
 * one LF: the rule L0.MANIFEST.CANONICAL and L0.PROVENANCE.CANONICAL decide.
 *
 * @param {string} document
 * @param {unknown} value
 * @returns {boolean}
 */

test('a duplicate key is refused by name, wherever the duplicate appears', () => {
  refuses('{"a":1,"a":2}', REASON.DUPLICATE);
  refuses('{"a":1,"b":{"c":2,"c":3}}', REASON.DUPLICATE);
  refuses('[{"a":1,"a":2}]', REASON.DUPLICATE);
  refuses('{"a":1,"a":1}', REASON.DUPLICATE);
  refuses('{"":1,"":2}', REASON.DUPLICATE);
  // The same text is legal JSON, and a reader that used JSON.parse would keep
  // the last value without a word. That silence is the reason for the scan.
  assert.deepEqual(JSON.parse('{"a":1,"a":2}'), { a: 2 });
  // Different keys are not a duplicate, including keys that differ only by case.
  assert.equal(parseJsonText('{"a":1,"A":2}').ok, true);
});

test('a float is refused in every position, and is never coerced to an integer', () => {
  /** @type {[string, string][]} */
  const literals = [
    ['1.0', REASON.NON_INTEGER_NUMBER],
    ['1e2', REASON.NON_INTEGER_NUMBER],
    ['1E2', REASON.NON_INTEGER_NUMBER],
    ['1E+2', REASON.NON_INTEGER_NUMBER],
    ['0.5', REASON.NON_INTEGER_NUMBER],
    ['-0.0', REASON.NON_INTEGER_NUMBER],
    ['-0', REASON.NON_INTEGER_NUMBER],
    ['0.0', REASON.NON_INTEGER_NUMBER],
    ['1.', REASON.NON_INTEGER_NUMBER],
    ['2.0e3', REASON.NON_INTEGER_NUMBER],
    ['01', REASON.NON_INTEGER_NUMBER],
    ['-', REASON.NON_INTEGER_NUMBER],
    ['9007199254740993', REASON.NUMBER_OUT_OF_RANGE],
    ['.1', REASON.MALFORMED],
    ['+1', REASON.MALFORMED],
  ];
  for (const [literal, reason] of literals) {
    refuses(literal, reason);
    refuses(`[${literal}]`, reason);
    refuses(`{"a":${literal}}`, reason);
    refuses(`{"a":{"b":[${literal}]}}`, reason);
  }
  // And the integers that are integers are still integers.
  for (const [text, value] of [['0', 0], ['1', 1], ['-12', -12], ['9007199254740991', 9007199254740991]]) {
    accepts(text, value);
  }
});

test('an unpaired surrogate escape is refused; a pair is one character', () => {
  refuses('"\\ud800"', REASON.MALFORMED);
  refuses('"\\udfff"', REASON.MALFORMED);
  refuses('"\\udbff"', REASON.MALFORMED);
  refuses('"\\udc00"', REASON.MALFORMED);
  refuses('"\\ud800\\ud800"', REASON.MALFORMED);
  refuses('"\\udc00\\ud800"', REASON.MALFORMED);
  refuses('"\\ud800x"', REASON.MALFORMED);
  refuses('{"\\ud800":1}', REASON.MALFORMED);
  accepts('"\\ud83d\\ude00"', '\u{1f600}');
  accepts('"\\ud800\\udc00"', '\u{10000}');
});

test('keys sort by code point, which is not what UTF-16 order gives', () => {
  const astral = '\u{1f600}';
  const bmp = '\uFFFF';
  // The two orders disagree, so this case can tell them apart at all.
  assert.deepEqual([astral, bmp].sort(), [astral, bmp]);
  assert.deepEqual([astral, bmp].sort(compareByCodePoint), [bmp, astral]);
  assert.equal(compareByCodePoint(astral, bmp), 1);

  const value = { [astral]: 1, [bmp]: 2 };
  const canonical = serializeCanonical(value);
  assert.equal(canonical, `{"${bmp}":2,"${astral}":1}`);
  assert.ok(canonical.startsWith(`{"${bmp}"`), 'the code point below U+10000 comes first');
  // A document in UTF-16 order is the same value in the wrong bytes; a document
  // in code point order is the canonical bytes.
  assert.equal(isCanonicalDocument(`{"${astral}":1,"${bmp}":2}\n`, value), false);
  assert.equal(isCanonicalDocument(`{"${bmp}":2,"${astral}":1}\n`, value), true);
  accepts(canonical, value);
});

test('whitespace is tolerated while parsing and impossible in a canonical document', () => {
  const value = { a: [1, 2] };
  const canonical = serializeCanonical(value);
  const variants = [
    ` ${canonical}\n`,
    `\t${canonical}\n`,
    `\n${canonical}\n`,
    `${canonical}`,
    `${canonical}\n\n`,
    `${canonical}\r\n`,
    `{ "a": [1, 2] }\n`,
    `{\n  "a": [1, 2]\n}\n`,
  ];
  for (const variant of variants) {
    accepts(variant, value);
    assert.equal(isCanonicalDocument(variant, value), false, `${JSON.stringify(variant)} is not the canonical bytes`);
  }
  assert.equal(isCanonicalDocument(`${canonical}\n`, value), true, 'the canonical form plus one LF is the document');
  // Whitespace inside a string is not whitespace: it is content, and it is kept.
  accepts('{"a":" b\\tc\\n"}', { a: ' b\tc\n' });
  assert.equal(serializeCanonical({ a: ' b\tc\n' }), '{"a":" b\\tc\\n"}');
  assert.equal(isCanonicalDocument('{"a":" b\\tc\\n"}\n', { a: ' b\tc\n' }), true);
  // A raw control character inside a string is refused rather than kept.
  refuses('{"a":"b\nc"}', REASON.MALFORMED);
  refuses('{"a":"b\tc"}', REASON.MALFORMED);
});

test('depth is refused at the declared ceiling, and deep input is a refusal, not a RangeError', () => {
  const nest = (depth, open = '[', close = ']') => open.repeat(depth) + '1' + close.repeat(depth);
  const braceNest = (depth) => `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
  assert.equal(LIMITS.MAX_JSON_DEPTH, 64, 'the spec declares 64, and this test is written against the number');
  assert.deepEqual(parseJsonText(nest(64)).ok, true);
  refuses(nest(65), REASON.MALFORMED);
  assert.deepEqual(parseJsonText(braceNest(64)).ok, true);
  refuses(braceNest(65), REASON.MALFORMED);
  // The interesting half: input that nests far past any stack. The ceiling is
  // checked before the next level is entered, so this returns a refusal.
  for (const text of [nest(20000), nest(200000), braceNest(20000), '['.repeat(200000), '{"a":'.repeat(200000)]) {
    const outcome = attempt(text);
    assert.equal(outcome.threw, null, `deep input threw instead of being refused: ${outcome.threw}`);
    assert.equal(outcome.result.ok, false);
    assert.equal(outcome.result.reason_code, REASON.MALFORMED);
  }
});

function isCanonicalDocument(document, value) {
  return bytesEqual(utf8Encode(document), concat([canonicalBytes(value), LF]));
}


test('a document above the byte ceiling is refused before it is decoded or parsed', () => {
  const huge = utf8Encode(`"${'a'.repeat(LIMITS.MAX_JSON_DOCUMENT_BYTES)}"`);
  const refused = parseJsonBytes(huge);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason_code, REASON.LIMIT_EXCEEDED);
  // The order matters: a document that is both oversize and invalid UTF-8 is
  // refused for its size, because its contents were never looked at.
  const oversizeGarbage = new Uint8Array(LIMITS.MAX_JSON_DOCUMENT_BYTES + 1);
  oversizeGarbage.fill(0xff);
  assert.equal(parseJsonBytes(oversizeGarbage).reason_code, REASON.LIMIT_EXCEEDED);
  // Just under the ceiling is decoded and parsed: the limit is a limit, not a
  // reason to refuse everything large.
  assert.equal(parseJsonBytes(utf8Encode('{"a":1}')).ok, true);
  assert.equal(parseJsonBytes(new Uint8Array([0xc3, 0x28])).reason_code, REASON.DECODE_ERROR);
  assert.equal(parseJsonBytes(utf8Encode('{"a":1}'), { maxBytes: 3 }).reason_code, REASON.LIMIT_EXCEEDED);
});

test('hostile text never throws out of the parser', () => {
  // The entries and what they are for live in test/corpus.js: the same corpus
  // is what the round-trip property is stated over.
  for (const text of HOSTILE_TEXT) {
    const outcome = attempt(text);
    assert.equal(outcome.threw, null, `${JSON.stringify(text.slice(0, 40))} threw: ${outcome.threw}`);
    assert.ok(outcome.result !== null);
    if (!outcome.result.ok) {
      assert.ok(REASONS.has(outcome.result.reason_code), `${JSON.stringify(text)}: ${outcome.result.reason_code}`);
      assert.ok(outcome.result.detail.length > 0, 'a refusal must say what is wrong');
    }
  }
});

/**
 * Deterministic bytes, so a failure here is reproducible: a seed and a
 * multiply, in the test, on purpose. Nothing under `verifier/**` may reach for
 * a random source at all.
 *
 * @param {number} length
 * @param {number} seed
 * @returns {Uint8Array}
 */
function pseudoRandomBytes(length, seed) {
  const out = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[index] = (state >>> 24) & 0xff;
  }
  return out;
}

test('hostile bytes never throw out of the verifier', async () => {
  const valid = new Uint8Array(readFileSync(join(KIT, 'out', 'valid.charter')));
  const eocd = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
  /** @type {[string, Uint8Array][]} */
  const corpus = [
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([0x50])],
    ['four bytes of a local header', new Uint8Array([0x50, 0x4b, 0x03, 0x04])],
    ['all zeros', new Uint8Array(100)],
    ['all ones', new Uint8Array(100).fill(0xff)],
    ['a bare end record', concat([eocd, new Uint8Array(18)])],
    [
      'an end record claiming entries that are not there',
      concat([eocd, new Uint8Array([0, 0, 0, 0, 0xff, 0x7f, 0xff, 0x7f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])]),
    ],
    ['a valid artifact with its first byte flipped', (() => {
      const copy = valid.slice();
      copy[0] ^= 0xff;
      return copy;
    })()],
    ['pseudo-random 22 bytes', pseudoRandomBytes(22, 1)],
    ['pseudo-random 1 KiB', pseudoRandomBytes(1024, 2)],
    ['pseudo-random 64 KiB', pseudoRandomBytes(64 * 1024, 3)],
    ['64 KiB of zeros', new Uint8Array(64 * 1024)],
  ];
  for (const [name, bytes] of corpus) {
    let result;
    try {
      result = await verify(bytes);
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      assert.fail(`${name} threw out of verify(): ${detail}`);
    }
    assert.ok(VERDICTS.has(result.verdict), `${name}: ${result.verdict}`);
    assert.ok(Object.values(EXIT_CODE).includes(result.exit_code), `${name}: exit code ${result.exit_code}`);
    assert.deepEqual(result.checks.map((check) => check.id), [...CHECK_IDS], `${name}: every check is reported`);
    for (const check of result.checks) {
      assert.ok(STATUSES.has(check.status), `${name}/${check.id}: ${check.status}`);
      assert.ok(REASONS.has(check.reason_code), `${name}/${check.id}: ${check.reason_code}`);
      assert.ok(check.detail.length > 0, `${name}/${check.id}: a check must say something`);
    }
    if (result.verdict !== VERDICT.VERIFIED) {
      assert.ok(result.summary.fail + result.summary.unsupported > 0, `${name}: a verdict that is not VERIFIED must find something`);
    }
  }
});

test('a declared limit that is exceeded is a refusal, not a slow success', async () => {
  const valid = new Uint8Array(readFileSync(join(KIT, 'out', 'valid.charter')));
  const result = await verify(valid, { limits: { ...LIMITS, MAX_ARCHIVE_BYTES: 1 } });
  assert.equal(result.verdict, VERDICT.BROKEN);
  assert.equal(result.exit_code, EXIT_CODE.BROKEN);
  const readable = result.checks.find((check) => check.id === 'L0.ZIP.READABLE');
  assert.equal(readable.status, STATUS.FAIL);
  assert.equal(readable.reason_code, REASON.LIMIT_EXCEEDED);
  assert.equal(result.summary.pass, 0, 'nothing inside a file that was never walked may be reported as passing');
});
