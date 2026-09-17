/**
 * The writers, for a program that is not this one.
 *
 * The companion to the root `index.js`: that one reads, this one writes. It is the
 * surface a tool needs when it wants to make a `.charter` file rather than check one —
 * a notes app that seals a note, a script that appends a nightly revision, a service
 * that mints a key per customer.
 *
 * # What it needs that the verifier does not
 *
 * A private key, a random source, and (for `--now`) a clock. `verifier/**` may have none
 * of those; `producer/**` may, and does: `node:crypto` is the only runtime module behind
 * this entry point. So this file is Node-only, and that is the whole difference between
 * the two surfaces. A browser that wants to seal imports the page's own writers instead,
 * which is what `editor/editor.js` does and why it uses Web Crypto rather than this.
 *
 * # The key is an argument, never a lookup
 *
 * Every writer here takes the key as text or as bytes that the caller read. Nothing in
 * this project opens a keyring, remembers a key between calls, or writes one anywhere but
 * where it was told to: `keygen` returns the text of a key file and stores nothing. A
 * program that uses this surface holds the key, and that is the point of it.
 *
 * @module producer/index
 */

export { edit, LATER_ACTION, NO_SUMMARY_STATED } from './edit.js';
export { generateKeyPair, loadKey } from './key.js';
export {
  CIPHER_AES_256_GCM,
  isKeyFile,
  KDF_SCRYPT,
  KEY_FILE_LABEL,
  KEY_FILE_MAGIC,
  KEY_FILE_VERSION,
  openKeyFile,
  sealKeyFile,
} from './keyfile.js';
export { readCharter, readCharterParts } from './read.js';
export { seal } from './seal.js';
export { citationItem } from './cite.js';
export { ProducerError } from './errors.js';