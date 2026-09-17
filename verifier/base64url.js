/**
 * Canonical base64url, decode side.
 *
 * Charter writes keys and signatures as unpadded base64url. Decoding is strict
 * on purpose: unpadded base64url is not a bijection onto byte strings unless
 * the unused trailing bits are required to be zero. Without that rule the same
 * signature has 4 accepted spellings, and "one byte sequence per logical
 * value" would be false for the very field that carries the signature.
 *
 * The empty string is not refused here. It is the one spelling of the empty byte
 * string, and whether a *signature* may be one is a question about length — the
 * caller's, and one it answers MALFORMED rather than NON_CANONICAL_ENCODING.
 *
 * @module verifier/base64url
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const VALUES = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * @param {string} text
 * @returns {{ ok: true, value: Uint8Array } | { ok: false, detail: string }}
 */
export function decodeBase64Url(text) {
  if (text.includes('=')) {
    return { ok: false, detail: 'padding is present; canonical base64url is unpadded' };
  }
  const remainder = text.length % 4;
  if (remainder === 1) {
    return { ok: false, detail: 'the length is 4n+1, which no base64url string can have' };
  }
  const wholeGroups = Math.floor(text.length / 4);
  const byteLength = wholeGroups * 3 + (remainder === 0 ? 0 : remainder - 1);
  const out = new Uint8Array(byteLength);
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? VALUES[code] : -1;
    if (value < 0) {
      return { ok: false, detail: `character ${i + 1} is not in the base64url alphabet` };
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (buffer >> bits) & 0xff;
      at += 1;
    }
  }
  if (bits > 0) {
    const leftover = buffer & ((1 << bits) - 1);
    if (leftover !== 0) {
      return { ok: false, detail: 'the unused trailing bits are not zero, so this is one of several spellings of the same bytes' };
    }
  }
  return { ok: true, value: out };
}
