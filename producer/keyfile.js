/**
 * The key file: a private key at rest, behind a passphrase.
 *
 * `keygen` used to write one thing — an unencrypted PKCS#8 PEM — and the tool's own
 * output told the reader to "keep it where a private key belongs" while offering
 * nothing that would help if they did not. A `.charter` file carries only the public
 * key, so the private key never travels; but it does sit on a disk, and on that disk
 * it was readable by anyone who could read the file. For a format whose whole subject
 * is authenticity, that was the weakest link in a real deployment.
 *
 * This module is the producer's answer, and it is producer-side on purpose: the
 * verifier never holds a private key, never will, and may not read a file. Everything
 * here is a pure function over bytes except the two calls that need a random source,
 * and randomness is something the producer has always been allowed.
 *
 * # Why this is not `export({ cipher, passphrase })`
 *
 * Node will encrypt a PKCS#8 key for you. It was measured before it was rejected:
 *
 *   - the KDF it writes is **scrypt with N=2048, r=8, p=1** — 2 MiB of memory and
 *     **7.4 ms** per guess on this machine, which is roughly 135 guesses per second
 *     per core for anyone holding the file;
 *   - it reads `iterations` and **ignores it**. Asked for 600000, it produced DER
 *     byte-identical to the default in the first 20 bytes — same scrypt, same N, same
 *     r, same p. A caller who passes that option is not raising the cost of anything;
 *   - the cipher is **AES-256-CBC with no MAC**, so a modified ciphertext is not
 *     detected by the decryptor: it produces different key bytes and fails later, or
 *     not at all;
 *   - `aes-256-gcm` is refused outright ("cipher parameter error"), so the choice is
 *     not available through that API at all.
 *
 * The cost of a guess is the entire defence of a passphrase-wrapped key: an attacker
 * with the file can always try passphrases offline, and nothing can stop them, so the
 * only lever is what each attempt costs. The sibling project this format was compared
 * against learned the same thing the hard way — its own audit records a stored salt
 * plus an "encryption of a known constant" verification token as an **offline
 * brute-force oracle**, "contingent on passphrase strength". At 7.4 ms the answer is
 * contingent on very little. At 366 ms, which is what N=2^17 costs, it is a different
 * question.
 *
 * So the container is written here, to the format's own rules, the way the ZIP writer
 * already is: no dependency, no library, and every field a number this project chose
 * and can point at.
 *
 * @module producer/keyfile
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

import { REASON } from '../verifier/status.js';
import { describeCause, refuse } from './errors.js';

/**
 * # The container
 *
 * An armored text file — a labelled block of base64, so it can be pasted into a form
 * and read by a person, and so a key file is never mistaken for a `.charter` file
 * (which is a ZIP) or for a standard PEM (which this is not). Inside it is one
 * fixed-layout record:
 *
 * | Offset | Size | Field | Value |
 * | --- | --- | --- | --- |
 * | 0 | 4 | magic | `CHKY` |
 * | 4 | 1 | container version | `1` |
 * | 5 | 1 | key derivation function | `1`, scrypt |
 * | 6 | 1 | cipher | `1`, AES-256-GCM |
 * | 7 | 1 | reserved | `0` |
 * | 8 | 4 | scrypt `log2(N)`, big-endian | `17` |
 * | 12 | 4 | scrypt `r`, big-endian | `8` |
 * | 16 | 4 | scrypt `p`, big-endian | `1` |
 * | 20 | 16 | salt | random |
 * | 36 | 12 | AES-GCM initialisation vector | random |
 * | 48 | 4 | ciphertext length, big-endian | the PKCS#8 DER, in bytes |
 * | 52 | 16 | AES-GCM authentication tag | |
 * | 68 | n | ciphertext: the PKCS#8 DER, encrypted | |
 *
 * **The KDF parameters are in the file.** That is what lets a file written today still
 * open when this project's default cost changes, and it is why they are not constants
 * read at open time: a reader must use the parameters the writer used, not the ones
 * this build happens to prefer.
 *
 * **Nothing identifies the key.** There is no plaintext key id and no public key in
 * the clear. It would be convenient — a reader could tell which key a file holds
 * without the passphrase — and it would publish the identity of a signer to anyone who
 * finds the file, and let them confirm that a given charter was signed by it. A key
 * file's contents are the holder's business, so the passphrase is the only thing that
 * opens it.
 *
 * **The passphrase is not checked anywhere, and the tag is the check.** The
 * authentication tag fails if the passphrase is wrong, and it fails identically if the
 * file has been altered. Those two are deliberately indistinguishable in the refusal,
 * because telling them apart is a service to whoever is guessing.
 */

/** The four bytes at the start of the record, which no other file this project writes begins with. */
export const KEY_FILE_MAGIC = 'CHKY';

/** The container's version. A change to this table's shape moves it. */
export const KEY_FILE_VERSION = 1;

/** The key derivation function the container names. `1` is scrypt, per RFC 7914. */
export const KDF_SCRYPT = 1;

/** The cipher the container names. `1` is AES-256-GCM, per NIST SP 800-38D. */
export const CIPHER_AES_256_GCM = 1;

/**
 * The scrypt cost, as `log2(N)`, `r` and `p`.
 *
 * `N = 2^17` with `r = 8` and `p = 1` is the parameter set OWASP recommends for
 * scrypt, and it costs 128 · N · r = **128 MiB** and about **366 ms** per attempt on
 * this machine — measured, not estimated, and the number the documentation quotes. It
 * is deliberately the memory that makes it expensive: a GPU or an ASIC farm is good at
 * many cheap guesses and bad at many large ones.
 */
export const SCRYPT_LOG_N = 17;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;

/** How much memory the derivation is allowed to ask for: twice what the parameters need. */
export const SCRYPT_MAX_MEMORY = 128 * (2 ** SCRYPT_LOG_N) * SCRYPT_R * 2;

/**
 * The largest cost a *file may ask this build to pay*.
 *
 * A key file is not always one you wrote. Someone can hand you one, so its parameters
 * are attacker-controlled input, and a record claiming `log2(N) = 40` is a request to
 * allocate 128 TiB. The rule is the one `verifier/limits.js` already states for an
 * artifact: a reader that can be made to allocate without bound is a reader that can be
 * made to hang, and exceeding a declared ceiling is a refusal and never a slow success.
 *
 * Two guards, because one is not enough. `MAX_SCRYPT_LOG_N` refuses an absurd `N` before
 * anything is computed, and `MAX_SCRYPT_MEMORY` refuses any combination of `log2(N)` and
 * `r` whose product is too large — which is the constraint that actually matters, since
 * `r` can raise the cost on its own.
 *
 * The memory ceiling is **four times what this project writes**: a later release may
 * raise the cost once, or twice, and its files must still open here, while a file that
 * asks for a gigabyte to be spent on one guess is refused. Both bounds are inclusive:
 * exactly the ceiling is permitted, and the refusal comes at the first value above it.
 */
export const MAX_SCRYPT_LOG_N = 20;

/** The most memory any file may ask for, whatever its parameters say. */
export const MAX_SCRYPT_MEMORY = 512 * 1024 * 1024;

/** Bytes of salt, from the random source. */
export const SALT_BYTES = 16;

/** Bytes of AES-GCM initialisation vector. Twelve is the size GCM is defined for. */
export const IV_BYTES = 12;

/** Bytes of AES-GCM authentication tag. */
export const TAG_BYTES = 16;

/** Bytes of the fixed record before the ciphertext. */
export const HEADER_BYTES = 68;

/** The armor's label. Deliberately not `PRIVATE KEY`, which would be a PEM. */
export const KEY_FILE_LABEL = 'CHARTER ENCRYPTED KEY';

/** The armored file is text, and base64 lines are wrapped at this width. */
const ARMOR_WIDTH = 64;

/** Base64 as RFC 4648 section 4 defines it, and nothing else. */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * The form of a passphrase before it becomes a key.
 *
 * NFC, and the choice is worth writing down because it is invisible until it breaks. A
 * passphrase typed on macOS arrives decomposed (NFD): `é` is `e` plus a combining
 * accent. The same passphrase typed on Linux is usually composed (NFC). Without
 * normalization those are different bytes, so a key file made on one machine would not
 * open on the other with what the user believes is the same passphrase.
 *
 * NFC rather than NFKC, deliberately: `NFKC` also folds compatibility characters, so
 * `ﬁ` would become `fi` and `①` would become `1`. That silently changes a secret the
 * user typed and can only make a passphrase easier to guess than it looked.
 *
 * @param {unknown} passphrase
 * @param {string} where a phrase for the detail message
 * @returns {string}
 */
function asPassphrase(passphrase, where) {
  if (typeof passphrase !== 'string' || passphrase === '') {
    refuse(REASON.MALFORMED, `${where} is empty, and an empty passphrase is not a passphrase: it would be the same as writing the key in the clear`, 'passphrase');
  }
  return passphrase.normalize('NFC');
}

/**
 * @param {Uint8Array} bytes
 * @param {number} at
 * @returns {number} an unsigned 32-bit big-endian integer
 */
function readUint32(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/**
 * @param {DataView} view
 * @param {number} at
 * @param {number} value
 * @returns {void}
 */
function writeUint32(view, at, value) {
  view.setUint32(at, value, false);
}

/**
 * Derive the 32-byte key a passphrase and a salt stand for.
 *
 * `scryptSync` blocks for about 366 ms at this project's cost. That is the point, and
 * it is also why the number is not configurable: a parameter argument would be a way to
 * write a weak file by accident, and there is no caller in this project that needs one.
 *
 * @param {string} passphrase already normalized
 * @param {Uint8Array} salt
 * @param {number} logN
 * @param {number} r
 * @param {number} p
 * @param {number} maxmem
 * @returns {Uint8Array} 32 bytes
 */
function deriveKey(passphrase, salt, logN, r, p, maxmem) {
  let derived;
  try {
    derived = scryptSync(passphrase, salt, 32, { N: 2 ** logN, r, p, maxmem });
  } catch (cause) {
    // A machine that cannot give scrypt the memory its parameters need is a runtime
    // limit, not a malformed file: the same file opens on a machine that can.
    refuse(
      REASON.UNSUPPORTED_FEATURE,
      `this runtime could not derive a key from the passphrase (${describeCause(cause)}). These parameters need ${Math.round((128 * (2 ** logN) * r) / (1024 * 1024))} MiB`,
    );
  }
  return new Uint8Array(derived);
}

/**
 * Whether this text is a key file, answered without a passphrase and without parsing.
 *
 * The caller uses it to decide whether to ask for one: a PEM needs no passphrase, and
 * this file cannot be opened without it. The check is the label, because that is what
 * the armor is for — a reader who has only the text can tell what they are holding.
 *
 * @param {unknown} text
 * @returns {boolean}
 */
export function isKeyFile(text) {
  return typeof text === 'string' && new RegExp(`^\\s*-----BEGIN ${KEY_FILE_LABEL}-----`).test(text);
}

/**
 * Wrap a record as text.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function armor(bytes) {
  const body = Buffer.from(bytes).toString('base64');
  /** @type {string[]} */
  const lines = [];
  for (let at = 0; at < body.length; at += ARMOR_WIDTH) lines.push(body.slice(at, at + ARMOR_WIDTH));
  return `-----BEGIN ${KEY_FILE_LABEL}-----\n${lines.join('\n')}\n-----END ${KEY_FILE_LABEL}-----\n`;
}

/**
 * Read a record back out of its armor.
 *
 * Strict on purpose, and every strictness has a reason: the label has to match, there
 * has to be exactly one body, the body has to be base64 and nothing else, and no line
 * may be blank. A key file a person has edited by hand is a key file that will not
 * open, and saying so at the armor beats saying so 366 ms later at the tag.
 *
 * @param {string} text
 * @returns {Uint8Array}
 */
function unarmor(text) {
  if (typeof text !== 'string') refuse(REASON.MALFORMED, 'a key file is text, and this was not', 'key');
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const begin = `-----BEGIN ${KEY_FILE_LABEL}-----`;
  const end = `-----END ${KEY_FILE_LABEL}-----`;

  const from = lines.findIndex((line) => line.trim() === begin);
  if (from === -1) {
    refuse(REASON.MALFORMED, `this file holds no "${begin}" line, so it is not a key file this format defines`, 'key');
  }
  const to = lines.findIndex((line, at) => at > from && line.trim() === end);
  if (to === -1) {
    refuse(REASON.MALFORMED, `the "${begin}" line is not closed by an "${end}" line`, 'key');
  }
  const body = lines.slice(from + 1, to);
  if (body.length === 0) refuse(REASON.MALFORMED, 'the key file holds no base64 between its two label lines', 'key');

  for (const [at, line] of body.entries()) {
    if (line.trim() === '') refuse(REASON.MALFORMED, `line ${at + 1} of the key file's body is empty`, 'key');
    if (!BASE64.test(line.trim())) {
      refuse(
        REASON.NON_CANONICAL_ENCODING,
        `line ${at + 1} of the key file's body holds a character outside the base64 alphabet, so these bytes have no canonical spelling`,
        'key',
      );
    }
  }
  return new Uint8Array(Buffer.from(body.map((line) => line.trim()).join(''), 'base64'));
}

/**
 * Put a PKCS#8 private key behind a passphrase.
 *
 * @param {Uint8Array} pkcs8Der the key, as the bytes `export({ type: 'pkcs8', format: 'der' })` gives
 * @param {string} passphrase
 * @returns {string} the armored key file, ready to write
 */
export function sealKeyFile(pkcs8Der, passphrase) {
  if (!(pkcs8Der instanceof Uint8Array) || pkcs8Der.length === 0) {
    refuse(REASON.MALFORMED, 'a key file holds a private key, and this call was handed none', 'key');
  }
  const secret = asPassphrase(passphrase, 'the passphrase');

  const salt = new Uint8Array(randomBytes(SALT_BYTES));
  const iv = new Uint8Array(randomBytes(IV_BYTES));
  const key = deriveKey(secret, salt, SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, SCRYPT_MAX_MEMORY);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(pkcs8Der)), cipher.final()]);
  const tag = cipher.getAuthTag();

  const record = new Uint8Array(HEADER_BYTES + ciphertext.length);
  const view = new DataView(record.buffer);
  for (let at = 0; at < 4; at += 1) record[at] = KEY_FILE_MAGIC.charCodeAt(at);
  record[4] = KEY_FILE_VERSION;
  record[5] = KDF_SCRYPT;
  record[6] = CIPHER_AES_256_GCM;
  record[7] = 0;
  writeUint32(view, 8, SCRYPT_LOG_N);
  writeUint32(view, 12, SCRYPT_R);
  writeUint32(view, 16, SCRYPT_P);
  record.set(salt, 20);
  record.set(iv, 36);
  writeUint32(view, 48, ciphertext.length);
  record.set(tag, 52);
  record.set(ciphertext, HEADER_BYTES);

  return armor(record);
}

/**
 * Open a key file with a passphrase.
 *
 * The refusal for a failed tag names both possibilities and does not try to tell them
 * apart: a wrong passphrase and an altered file are the same event as far as this
 * function can see, and distinguishing them would tell whoever is guessing whether they
 * are getting warmer.
 *
 * @param {string} text the armored key file
 * @param {string} passphrase
 * @returns {Uint8Array} the PKCS#8 DER the file was written from
 */
export function openKeyFile(text, passphrase) {
  const secret = asPassphrase(passphrase, 'the passphrase');
  const record = unarmor(text);

  for (let at = 0; at < 4; at += 1) {
    if (record[at] !== KEY_FILE_MAGIC.charCodeAt(at)) {
      refuse(REASON.MALFORMED, `a key file begins with "${KEY_FILE_MAGIC}", and this one begins with something else`, 'key');
    }
  }
  if (record.length < HEADER_BYTES) {
    refuse(REASON.MALFORMED, `a key file is at least ${HEADER_BYTES} bytes and this one is ${record.length}`, 'key');
  }
  if (record[4] !== KEY_FILE_VERSION) {
    refuse(
      REASON.UNSUPPORTED_VERSION,
      `this key file is container version ${record[4]} and this build implements version ${KEY_FILE_VERSION}`,
      'key',
    );
  }
  if (record[5] !== KDF_SCRYPT) {
    refuse(REASON.UNSUPPORTED_FEATURE, `this key file names key derivation function ${record[5]}, and this build implements ${KDF_SCRYPT} (scrypt)`, 'key');
  }
  if (record[6] !== CIPHER_AES_256_GCM) {
    refuse(REASON.UNSUPPORTED_FEATURE, `this key file names cipher ${record[6]}, and this build implements ${CIPHER_AES_256_GCM} (AES-256-GCM)`, 'key');
  }
  if (record[7] !== 0) {
    refuse(REASON.MALFORMED, `byte 7 of a key file is reserved and must be 0, and this file holds ${record[7]}`, 'key');
  }

  const logN = readUint32(record, 8);
  const r = readUint32(record, 12);
  const p = readUint32(record, 16);
  if (logN > MAX_SCRYPT_LOG_N) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `this key file asks scrypt for log2(N) = ${logN}, above the declared ceiling of ${MAX_SCRYPT_LOG_N}: a file may not ask this build to allocate without bound`,
      'key',
    );
  }
  const needed = 128 * (2 ** logN) * r;
  if (logN < 1 || r < 1 || p < 1 || needed > MAX_SCRYPT_MEMORY) {
    refuse(
      REASON.LIMIT_EXCEEDED,
      `this key file's scrypt parameters (log2(N) = ${logN}, r = ${r}, p = ${p}) need ${Math.round(needed / (1024 * 1024))} MiB, which is outside what this build will spend on one key file`,
      'key',
    );
  }

  const salt = record.subarray(20, 36);
  const iv = record.subarray(36, 48);
  const length = readUint32(record, 48);
  const tag = record.subarray(52, 68);
  if (record.length !== HEADER_BYTES + length) {
    refuse(
      REASON.MALFORMED,
      `this key file says its ciphertext is ${length} bytes, and ${record.length - HEADER_BYTES} bytes follow the header`,
      'key',
    );
  }

  const key = deriveKey(secret, salt, logN, r, p, needed * 2);
  const ciphertext = record.subarray(HEADER_BYTES);
  /** @type {Buffer} */
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext)), decipher.final()]);
  } catch (cause) {
    void cause;
    refuse(
      REASON.MISMATCH,
      'this key file did not open: the passphrase is not the one it was written with, or the file has been altered since it was written. Nothing here can tell those apart, and nothing should',
      'passphrase',
    );
  }
  return new Uint8Array(plaintext);
}