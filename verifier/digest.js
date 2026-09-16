/**
 * Hashing and signature checking, through WebCrypto only.
 *
 * Nothing here decides what a mismatch means — it returns bytes or a boolean
 * and lets the checks speak. Failures are returned rather than thrown, so a
 * runtime without WebCrypto produces an UNSUPPORTED verdict instead of a crash.
 *
 * @module verifier/digest
 */

import { REASON } from './status.js';

const SUBTLE = globalThis.crypto === undefined ? null : globalThis.crypto.subtle ?? null;

/** The hash behind every digest in the format. */
export const HASH_NAME = 'SHA-256';

/** The one signature algorithm in charter/0.1. */
export const ALGORITHM_NAME = 'Ed25519';

/**
 * @returns {boolean} whether this runtime can hash and check signatures
 */
export function hasWebCrypto() {
  return SUBTLE !== null && typeof SUBTLE.digest === 'function' && typeof SUBTLE.verify === 'function';
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isUnsupported(error) {
  return error instanceof Error && error.name === 'NotSupportedError';
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array | null>}
 */
export async function sha256(bytes) {
  if (SUBTLE === null) return null;
  const digest = await SUBTLE.digest(HASH_NAME, bytes);
  return new Uint8Array(digest);
}

/**
 * @param {Uint8Array} publicKey 32 bytes
 * @param {Uint8Array} signature 64 bytes
 * @param {Uint8Array} message
 * @returns {Promise<{ ok: true, valid: boolean } | { ok: false, reason_code: string, detail: string }>}
 */
export async function verifySignature(publicKey, signature, message) {
  if (SUBTLE === null) {
    return { ok: false, reason_code: REASON.UNSUPPORTED_FEATURE, detail: 'this runtime has no WebCrypto, so Ed25519 signatures cannot be checked' };
  }
  let key;
  try {
    key = await SUBTLE.importKey('raw', publicKey, { name: ALGORITHM_NAME }, false, ['verify']);
  } catch (error) {
    if (isUnsupported(error)) {
      return { ok: false, reason_code: REASON.UNSUPPORTED_FEATURE, detail: 'this runtime cannot load an Ed25519 key, so signatures cannot be checked' };
    }
    return { ok: false, reason_code: REASON.MALFORMED, detail: `the public key is not a usable Ed25519 key (${describeError(error)})` };
  }
  try {
    const valid = await SUBTLE.verify({ name: ALGORITHM_NAME }, key, signature, message);
    return { ok: true, valid };
  } catch (error) {
    if (isUnsupported(error)) {
      return { ok: false, reason_code: REASON.UNSUPPORTED_FEATURE, detail: 'this runtime cannot check Ed25519 signatures' };
    }
    return { ok: false, reason_code: REASON.MALFORMED, detail: `the signature could not be checked (${describeError(error)})` };
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  if (error instanceof Error && typeof error.message === 'string' && error.message !== '') {
    return `${error.name}: ${error.message}`;
  }
  return 'no further detail is available from this runtime';
}
