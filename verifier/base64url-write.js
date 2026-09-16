/**
 * Canonical base64url, writing direction.
 *
 * `verifier/base64url.js` decodes and refuses anything that is not the one
 * spelling of its byte string: padding, a character outside the URL-safe
 * alphabet, and above all a set of unused trailing bits that is not zero. This
 * module produces those bytes in the first place, and it produces them the one
 * way the reader accepts.
 *
 * It is not a copy of the reader and it is not the reader's twin: unpadded
 * encoding has exactly one correct output, and the only way to be wrong is to
 * emit padding or the standard alphabet. `test/producer.test.js` holds the two
 * directions together — every length from 1 to 72 bytes, encoded here and
 * decoded there, must come back unchanged — which is the round-trip rule this
 * project applies wherever one value has two directions.
 *
 * Two writers encode these bytes: the producer, which signs a manifest for a
 * file, and the editor, which signs one in a page. Both take the alphabet and
 * the rule from here rather than from a copy of it, which is why this module
 * sits in the directory a browser may import. Nothing the reading path imports
 * can reach it: `test/purity.test.js` walks the imports of `verify.js` and
 * refuses the run if that ever changes.
 *
 * @module verifier/base64url-write
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * @param {Uint8Array} bytes
 * @returns {string} unpadded base64url: no `=`, and no other spelling exists
 */
export function encodeBase64Url(bytes) {
  let out = '';
  for (let at = 0; at < bytes.length; at += 3) {
    const first = bytes[at];
    const second = bytes[at + 1];
    const third = bytes[at + 2];
    out += ALPHABET[first >> 2];
    out += ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) break;
    out += ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) break;
    out += ALPHABET[third & 0x3f];
  }
  return out;
}
