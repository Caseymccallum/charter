/**
 * Byte helpers, including the two decoders that must never be forgiving:
 * UTF-8 and lowercase hexadecimal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bytesEqual,
  concat,
  containsByte,
  fromHexLower,
  splitOnByte,
  toHex,
  utf8Decode,
  utf8Encode,
} from '../verifier/bytes.js';

test('UTF-8 round-trips, and the byte order mark survives the trip', () => {
  for (const text of ['', 'plain', 'caf\u00e9', '\u{1f600}', '\uFEFFmarked']) {
    const decoded = utf8Decode(utf8Encode(text));
    assert.equal(decoded.ok, true);
    assert.equal(decoded.text, text);
  }
});

test('invalid UTF-8 is refused rather than replaced with U+FFFD', () => {
  const invalid = [
    [0x80],
    [0xc0, 0xaf],
    [0xe2, 0x82],
    [0xed, 0xa0, 0x80],
    [0xff],
    [0xf4, 0x90, 0x80, 0x80],
  ];
  for (const bytes of invalid) {
    const decoded = utf8Decode(new Uint8Array(bytes));
    assert.equal(decoded.ok, false, `expected ${bytes.join(',')} to be refused`);
    assert.ok(decoded.detail.length > 0);
  }
});

test('bytesEqual compares contents, not identity', () => {
  assert.equal(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])), true);
  assert.equal(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
  assert.equal(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([2, 1])), false);
  assert.equal(bytesEqual(new Uint8Array(0), new Uint8Array(0)), true);
});

test('concat joins chunks in order', () => {
  assert.deepEqual(concat([new Uint8Array([1]), new Uint8Array([2, 3]), new Uint8Array(0)]), new Uint8Array([1, 2, 3]));
  assert.equal(concat([]).length, 0);
});

test('splitOnByte keeps a trailing empty part, so a missing LF is visible', () => {
  const parts = splitOnByte(utf8Encode('ab\nc\n'), 0x0a);
  assert.equal(parts.length, 3);
  assert.equal(toHex(parts[0]), '6162');
  assert.equal(toHex(parts[1]), '63');
  assert.equal(parts[2].length, 0);
  assert.equal(splitOnByte(new Uint8Array(0), 0x0a).length, 1);
});

test('containsByte finds a byte value', () => {
  assert.equal(containsByte(utf8Encode('a\nb'), 0x0a), true);
  assert.equal(containsByte(utf8Encode('ab'), 0x0a), false);
  assert.equal(containsByte(new Uint8Array(0), 0x00), false);
});

test('toHex writes two lowercase characters per byte', () => {
  assert.equal(toHex(new Uint8Array([0x00, 0x0f, 0xff])), '000fff');
  assert.equal(toHex(new Uint8Array(0)), '');
});

test('hex is decoded only when it is lowercase and the declared length', () => {
  assert.deepEqual(fromHexLower('00ff', 2), { ok: true, value: new Uint8Array([0x00, 0xff]) });
  assert.equal(fromHexLower('00FF', 2).ok, false, 'uppercase is a second spelling of one value');
  assert.equal(fromHexLower('0f', 2).ok, false);
  assert.equal(fromHexLower('', 0).ok, false, 'an empty digest is not a digest');
  assert.equal(fromHexLower('zz', 1).ok, false);
});
