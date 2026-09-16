/**
 * CRC-32 (the reflected IEEE 802.3 polynomial used by ZIP).
 *
 * The verifier recomputes it rather than trusting the archive, because the
 * declared value is one of the few integrity claims the container makes on its
 * own and a container that lies about its bytes is worth refusing before its
 * content is read.
 *
 * @module verifier/crc32
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit CRC of `bytes`
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
