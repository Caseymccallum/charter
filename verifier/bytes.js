/**
 * Byte helpers.
 *
 * Pure and platform-free beyond TextEncoder/TextDecoder, which are part of the
 * web platform and of every supported JavaScript runtime. Nothing here keeps
 * state between calls.
 *
 * @module verifier/bytes
 */

const TEXT_ENCODER = new TextEncoder();
// `ignoreBOM: true` is not a contradiction of the doc below: it means "do not
// treat the mark specially", so a leading U+FEFF stays in the decoded text
// instead of being silently dropped. Dropping it would make the round trip
// below untrue, and would hide a mark that this verifier has a rule about.
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/**
 * @param {string} text
 * @returns {Uint8Array} the UTF-8 bytes of `text`
 */
export function utf8Encode(text) {
  return TEXT_ENCODER.encode(text);
}

/**
 * Decode strictly: invalid byte sequences fail rather than becoming U+FFFD.
 * The byte order mark is not stripped, so a caller can notice one.
 *
 * @param {Uint8Array} bytes
 * @returns {{ ok: true, text: string } | { ok: false, detail: string }}
 */
export function utf8Decode(bytes) {
  try {
    return { ok: true, text: TEXT_DECODER.decode(bytes) };
  } catch {
    return { ok: false, detail: 'the bytes are not valid UTF-8' };
  }
}

/**
 * @param {Uint8Array} a
 * @param {Uint8Array} b
 * @returns {boolean}
 */
export function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * @param {readonly Uint8Array[]} chunks
 * @returns {Uint8Array}
 */
export function concat(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Split on a single byte value. The separator is not part of any part.
 *
 * @param {Uint8Array} bytes
 * @param {number} separator
 * @returns {Uint8Array[]}
 */
export function splitOnByte(bytes, separator) {
  const parts = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === separator) {
      parts.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  parts.push(bytes.subarray(start, bytes.length));
  return parts;
}

/**
 * @param {Uint8Array} bytes
 * @returns {boolean} whether `bytes` contains the given byte value
 */
export function containsByte(bytes, value) {
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === value) return true;
  }
  return false;
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} lowercase hexadecimal, two characters per byte
 */
export function toHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

const HEX_CHARACTER = /^[0-9a-f]+$/;

/**
 * Decode lowercase hexadecimal, strictly. Uppercase is rejected rather than
 * folded: two spellings of one digest would be two byte sequences for one
 * logical value.
 *
 * @param {string} text
 * @param {number} expectedByteLength
 * @returns {{ ok: true, value: Uint8Array } | { ok: false, detail: string }}
 */
export function fromHexLower(text, expectedByteLength) {
  if (text.length !== expectedByteLength * 2) {
    return { ok: false, detail: `expected ${expectedByteLength * 2} lowercase hex characters, found ${text.length}` };
  }
  if (!HEX_CHARACTER.test(text)) {
    return { ok: false, detail: 'expected lowercase hex characters only (0-9, a-f)' };
  }
  const out = new Uint8Array(expectedByteLength);
  for (let i = 0; i < expectedByteLength; i += 1) {
    out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return { ok: true, value: out };
}
