/**
 * Keys: reading one, naming it, and signing with it.
 *
 * The verifier never holds a private key and never will — it checks signatures
 * with a public key it took out of the file, through WebCrypto, and that is all
 * it needs. The producer is the other half: it loads a private key from PEM,
 * signs with it, and derives the key's name the one way the format defines.
 *
 * The key id is derived by `deriveKeyId()` from `verifier/manifest.js` — the
 * same function `L1.MANIFEST.KEY_ID` compares against — rather than by a second
 * derivation written here. Two derivations of one name would agree until they
 * did not, and the disagreement would be about the identity of a signer.
 *
 * Loading is strict about what the format defines and generous about nothing
 * else. A private key that is not Ed25519 is refused with UNSUPPORTED_FEATURE
 * rather than being loaded and used anyway: charter/0.1 defines one algorithm,
 * and a producer that silently signed with a second one would write a file this
 * project's own verifier reports as a field it has no rule for.
 *
 * # Two forms of key file
 *
 * A key file is one of two things, and the bytes say which rather than the name:
 *
 *   - an unencrypted **PKCS#8 PEM**, which is what `openssl genpkey` writes and what
 *     `keygen` wrote before there was a second form; or
 *   - a **passphrase-protected key file**, the armored container `producer/keyfile.js`
 *     defines, which `keygen` writes when it is given a passphrase.
 *
 * The PEM is read by the runtime. The container is opened here first, and what comes
 * out of it is a PKCS#8 DER, which the runtime then reads the same way. Either way the
 * key that gets used came from a reader rather than from a guess.
 *
 * @module producer/key
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as signWith } from 'node:crypto';

import { deriveKeyId, ALGORITHM, PUBLIC_KEY_BYTES, SIGNATURE_BYTES } from '../verifier/manifest.js';
import { REASON } from '../verifier/status.js';
import { describeCause, refuse } from './errors.js';
import { isKeyFile, openKeyFile, sealKeyFile } from './keyfile.js';

/** The one key type charter/0.1 defines, as the runtime names it. */
const KEY_TYPE = 'ed25519';

/** SubjectPublicKeyInfo for Ed25519 is a fixed 12-byte prefix and then the key. */
const SPKI_BYTES = 44;

/**
 * The raw 32 bytes of an Ed25519 public key.
 *
 * @param {import('node:crypto').KeyObject} publicKey
 * @returns {Uint8Array}
 */
function rawPublicKey(publicKey) {
  const spki = publicKey.export({ format: 'der', type: 'spki' });
  if (spki.length !== SPKI_BYTES) {
    refuse(REASON.MALFORMED, `the public key is ${spki.length} bytes of SubjectPublicKeyInfo, and an Ed25519 public key is ${SPKI_BYTES}`);
  }
  return new Uint8Array(spki.subarray(spki.length - PUBLIC_KEY_BYTES));
}

/**
 * @param {import('node:crypto').KeyObject} key
 * @returns {string} the algorithm the runtime says this key uses, for a detail
 */
function describeKeyType(key) {
  const type = key.asymmetricKeyType;
  return typeof type === 'string' && type !== '' ? `a "${type}" key` : 'a key of a type this runtime does not name';
}

/**
 * Read a private key and derive the name the format gives it.
 *
 * @param {string} pemText the contents of the key file, in either of the two forms
 * @param {string} [passphrase] needed when the file is a passphrase-protected key file
 * @returns {Promise<{ private_key: import('node:crypto').KeyObject, public_key: Uint8Array, key_id: string }>}
 */
export async function loadKey(pemText, passphrase = undefined) {
  if (typeof pemText !== 'string' || pemText.trim() === '') {
    refuse(REASON.MISSING, 'the key file is empty, and a signature needs a private key', 'key');
  }
  // The armored container is opened here, with the passphrase, and what comes out is
  // the DER the runtime would have read had the key never been encrypted. A PEM skips
  // all of this: it is already what the runtime reads.
  /** @type {Uint8Array | null} */
  let der = null;
  if (isKeyFile(pemText)) {
    if (typeof passphrase !== 'string' || passphrase === '') {
      refuse(
        REASON.MISSING,
        'this is a passphrase-protected key file and no passphrase was given for it; pass --passphrase-file <file> or set CHARTER_PASSPHRASE',
        'passphrase',
      );
    }
    der = openKeyFile(pemText, passphrase);
  }

  /** @type {import('node:crypto').KeyObject} */
  let key;
  try {
    key = der === null ? createPrivateKey(pemText) : createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  } catch (cause) {
    refuse(REASON.MALFORMED, `the key file is not a private key this runtime can read (${describeCause(cause)})`, 'key');
  }
  if (key.asymmetricKeyType !== KEY_TYPE) {
    refuse(
      REASON.UNSUPPORTED_FEATURE,
      `the key file holds ${describeKeyType(key)}, and charter/0.1 defines one algorithm, "${ALGORITHM}"`,
      'key',
    );
  }

  const publicKey = rawPublicKey(createPublicKey(key));
  const keyId = await deriveKeyId(publicKey);
  if (keyId === null) {
    refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so a key id could not be derived from the key');
  }
  return Object.freeze({ private_key: key, public_key: publicKey, key_id: keyId });
}

/**
 * Sign a message with a loaded key.
 *
 * Ed25519 signatures are deterministic: signing the same bytes with the same
 * key twice produces the same 64 bytes. That is why a sealed file can be
 * reproduced byte for byte by anyone holding the same key, and it is the
 * property `test/producer.test.js` checks rather than assumes.
 *
 * @param {{ private_key: import('node:crypto').KeyObject }} loaded
 * @param {Uint8Array} message
 * @returns {Uint8Array} 64 bytes
 */
export function signBytes(loaded, message) {
  const signature = new Uint8Array(signWith(null, message, loaded.private_key));
  if (signature.length !== SIGNATURE_BYTES) {
    refuse(REASON.MALFORMED, `the runtime produced a ${signature.length}-byte signature, and an Ed25519 signature is ${SIGNATURE_BYTES} bytes`);
  }
  return signature;
}

/**
 * Make a key pair, as the text of a key file and the name the format gives the key.
 *
 * This exists so that a reader has a way to make a key that does not depend on
 * having `openssl` installed, which is the assumption the README's other
 * command makes. It generates a key and hands back its text; it stores nothing,
 * looks nothing up, and remembers nothing. A key is still the user's own.
 *
 * With a passphrase it writes the armored container `producer/keyfile.js` defines;
 * without one it writes the PKCS#8 PEM it has always written. The two are different
 * kinds of file and `private_text` is the field that holds either, because calling an
 * armored container a PEM would be the sort of small untruth this project spends its
 * tests on.
 *
 * @param {{ passphrase?: string }} [options]
 * @returns {Promise<{ private_text: string, encrypted: boolean, public_pem: string, key_id: string }>}
 */
export async function generateKeyPair(options = {}) {
  const { privateKey, publicKey } = generateKeyPairSync(KEY_TYPE);
  const keyId = await deriveKeyId(rawPublicKey(publicKey));
  if (keyId === null) {
    refuse(REASON.UNSUPPORTED_FEATURE, 'this runtime cannot compute SHA-256, so a key id could not be derived from the key');
  }
  const encrypted = typeof options.passphrase === 'string' && options.passphrase !== '';
  return Object.freeze({
    private_text: encrypted
      ? sealKeyFile(new Uint8Array(privateKey.export({ type: 'pkcs8', format: 'der' })), /** @type {string} */ (options.passphrase))
      : privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    encrypted,
    public_pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    key_id: keyId,
  });
}
