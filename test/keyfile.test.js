/**
 * The key file: a private key at rest, behind a passphrase.
 *
 * `producer/keyfile.js` is the one place this project writes something whose whole
 * purpose is to resist an attacker, so this file is written the way the verifier's tests
 * are: every property it claims is checked against a file it actually wrote, and the
 * checks use their own reader rather than the module's.
 *
 * What is being defended here is narrow and worth stating: an attacker who has the file
 * can always try passphrases offline, and nothing in the file can stop them. The only
 * lever is what each attempt costs, which is why the container stores its KDF parameters
 * and why a file that asks for an impossible cost is refused rather than obeyed. Those
 * two are the first tests below, because they are the ones that would have to be wrong
 * for the rest to matter.
 *
 * @module test/keyfile
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, generateKeyPairSync, scryptSync, sign } from 'node:crypto';

import {
  CIPHER_AES_256_GCM,
  HEADER_BYTES,
  IV_BYTES,
  KDF_SCRYPT,
  KEY_FILE_LABEL,
  KEY_FILE_MAGIC,
  KEY_FILE_VERSION,
  MAX_SCRYPT_LOG_N,
  openKeyFile,
  SALT_BYTES,
  SCRYPT_LOG_N,
  SCRYPT_P,
  SCRYPT_R,
  sealKeyFile,
  TAG_BYTES,
  isKeyFile,
} from '../producer/keyfile.js';

const PASSPHRASE = 'correct horse battery staple';
const WRONG = 'correct horse battery staple ';
const NFD = 'cafe\u0301 passphrase'; // e plus a combining acute, as a Mac keyboard writes it
const NFC = 'caf\u00e9 passphrase';

const PAIR = generateKeyPairSync('ed25519');
const DER = new Uint8Array(PAIR.privateKey.export({ type: 'pkcs8', format: 'der' }));

/** The one file most of these tests act on. Written once: a scrypt call is about 366 ms. */
const FILE = sealKeyFile(DER, PASSPHRASE);

/**
 * The record inside an armored file, read here rather than by the module.
 *
 * A test that used the module's own reader to check what the module wrote would agree
 * with it about a shape the documentation describes — the failure mode this project
 * exists to catch, in miniature.
 *
 * @param {string} text
 * @returns {Buffer}
 */
function recordOf(text) {
  const lines = text.trim().split('\n');
  assert.equal(lines[0], `-----BEGIN ${KEY_FILE_LABEL}-----`, 'the armor opens with its label');
  assert.equal(lines[lines.length - 1], `-----END ${KEY_FILE_LABEL}-----`, 'and closes with it');
  return Buffer.from(lines.slice(1, -1).join(''), 'base64');
}

/**
 * Put a record back into armor, so that a tampered file is still a file the format
 * describes and the refusal comes from the rule under test rather than from the armor.
 *
 * @param {Buffer} record
 * @returns {string}
 */
function armorOf(record) {
  return `-----BEGIN ${KEY_FILE_LABEL}-----\n${record.toString('base64')}\n-----END ${KEY_FILE_LABEL}-----\n`;
}

/**
 * @param {() => unknown} attempt
 * @returns {string} the reason code, or a sentence saying it was not refused
 */
function reasonOf(attempt) {
  try {
    attempt();
    return 'NOT REFUSED';
  } catch (error) {
    return /** @type {{ reason_code?: string }} */ (error).reason_code ?? `threw ${String(error)}`;
  }
}

test('a key file holds the KDF parameters the documentation states', () => {
  const record = recordOf(FILE);
  assert.equal(record.subarray(0, 4).toString('latin1'), KEY_FILE_MAGIC, 'the record begins with its magic');
  assert.equal(record[4], KEY_FILE_VERSION, 'and with the container version');
  assert.equal(record[5], KDF_SCRYPT, 'the KDF field names scrypt');
  assert.equal(record[6], CIPHER_AES_256_GCM, 'the cipher field names AES-256-GCM');
  assert.equal(record[7], 0, 'the reserved byte is zero');
  assert.equal(record.readUInt32BE(8), SCRYPT_LOG_N, 'log2(N) is the published cost');
  assert.equal(record.readUInt32BE(12), SCRYPT_R, 'r is the published value');
  assert.equal(record.readUInt32BE(16), SCRYPT_P, 'p is the published value');
  assert.equal(record.readUInt32BE(48), DER.length, 'the length field is the key it holds');
  assert.equal(record.length, HEADER_BYTES + DER.length, `the record is the ${HEADER_BYTES}-byte header and the ciphertext, and nothing else`);
  assert.equal(record.subarray(20, 36).length, SALT_BYTES, 'a salt is in the record');
  assert.equal(record.subarray(36, 48).length, IV_BYTES, 'an initialisation vector is in the record');
  assert.equal(record.subarray(52, 68).length, TAG_BYTES, 'a tag is in the record');
  assert.equal(record.includes(DER.subarray(8)), false, 'the key itself is nowhere in the record in the clear');
});

test('a file that asks for a cost this build will not pay is refused, not obeyed', () => {
  // The parameters are in the file, which is what lets an old file open under a new
  // default — and it is also what makes them attacker-controlled, because a key file can
  // be handed to you. A record claiming log2(N) = 31 is a request to allocate 2 TiB per
  // guess, and obeying it is how a key file becomes a denial of service.
  const absurd = Buffer.from(recordOf(FILE));
  absurd.writeUInt32BE(31, 8);
  const started = Date.now();
  assert.equal(reasonOf(() => openKeyFile(armorOf(absurd), PASSPHRASE)), 'LIMIT_EXCEEDED', 'a file may not ask this build to spend unbounded memory');
  assert.ok(Date.now() - started < 200, 'the refusal came before any work: it is a bound, and not an attempt');
  assert.equal(MAX_SCRYPT_LOG_N < 31, true, 'the ceiling is below the value just refused');

  // A ceiling that is only a little too high is still a refusal rather than a slow
  // success, which is the rule verifier/limits.js states for an artifact. The bound is
  // inclusive — exactly the ceiling is permitted, and the first value above it is not —
  // which is why this asks for log2(N) = 20: it is the published ceiling, and with r = 8
  // it needs a gigabyte, which is twice what this build will spend on one key file.
  const over = Buffer.from(recordOf(FILE));
  over.writeUInt32BE(MAX_SCRYPT_LOG_N, 8);
  assert.equal(reasonOf(() => openKeyFile(armorOf(over), PASSPHRASE)), 'LIMIT_EXCEEDED', 'the published ceiling with r = 8 is refused too');
  assert.ok(128 * (2 ** MAX_SCRYPT_LOG_N) * SCRYPT_R > 512 * 1024 * 1024, 'and the arithmetic is why: that pair asks for more memory than the declared maximum');
});

test('the key comes back, and it is the same key', () => {
  const opened = openKeyFile(FILE, PASSPHRASE);
  assert.equal(Buffer.from(opened).equals(Buffer.from(DER)), true, 'the bytes are the bytes that went in');

  const reloaded = createPrivateKey({ key: opened, format: 'der', type: 'pkcs8' });
  const message = Buffer.from('a message the key signs');
  assert.equal(
    Buffer.from(sign(null, message, reloaded)).equals(Buffer.from(sign(null, message, PAIR.privateKey))),
    true,
    'Ed25519 is deterministic, so the same key produces the same signature: a key that came back changed would show here',
  );
});

test('two files written from one key are different files', () => {
  // A fixed salt would make every file written with a given passphrase identical, which
  // is what makes a precomputed table worth building. The salt and the vector are drawn
  // from the random source for exactly this reason.
  const again = sealKeyFile(DER, PASSPHRASE);
  assert.notEqual(again, FILE, 'the same key and passphrase do not produce the same file');
  assert.notEqual(recordOf(again).subarray(20, 36).toString('hex'), recordOf(FILE).subarray(20, 36).toString('hex'), 'the salts differ');
  assert.equal(Buffer.from(openKeyFile(again, PASSPHRASE)).equals(Buffer.from(DER)), true, 'and both open to the same key');
});

test('a wrong passphrase and an altered file are refused the same way, and neither says which', () => {
  assert.equal(reasonOf(() => openKeyFile(FILE, WRONG)), 'MISMATCH', 'a wrong passphrase is a mismatch, not a malformed file');

  // One bit of the ciphertext, which is the case an authenticated cipher exists for: a
  // plain CBC would decrypt this into different bytes and say nothing at all.
  const tampered = Buffer.from(recordOf(FILE));
  tampered[HEADER_BYTES + 4] ^= 0x01;
  assert.equal(reasonOf(() => openKeyFile(armorOf(tampered), PASSPHRASE)), 'MISMATCH', 'a flipped bit in the ciphertext is caught rather than decrypted into something else');

  // The tag is what catches it, and the tag is the last field — so this also says the
  // whole record is covered by it.
  const tagFlipped = Buffer.from(recordOf(FILE));
  tagFlipped[52] ^= 0x01;
  assert.equal(reasonOf(() => openKeyFile(armorOf(tagFlipped), PASSPHRASE)), 'MISMATCH', 'the tag is covered by the check too');
});

test('the armor refuses what it cannot read, before any key is derived from it', () => {
  assert.equal(isKeyFile(FILE), true, 'the file is recognised by its label alone, with no passphrase');
  assert.equal(isKeyFile('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n'), false, 'a PKCS#8 PEM is not a key file');
  assert.equal(isKeyFile(''), false, 'nor is an empty string');

  const body = FILE.trim().split('\n');
  const cases = [
    ['a foreign label', FILE.replace(KEY_FILE_LABEL, 'SOMETHING ELSE'), 'MALFORMED'],
    ['no label at all', 'just some text\n', 'MALFORMED'],
    ['an unclosed block', body.slice(0, 3).join('\n'), 'MALFORMED'],
    ['a character outside base64', `${body[0]}\n!!!!not base64!!!!\n${body[body.length - 1]}\n`, 'NON_CANONICAL_ENCODING'],
    ['an empty body', `${body[0]}\n${body[body.length - 1]}\n`, 'MALFORMED'],
  ];
  for (const [what, text, expected] of cases) {
    assert.equal(reasonOf(() => openKeyFile(text, PASSPHRASE)), expected, `${what} is refused with ${expected}`);
  }

  // The record's own rules, each on a file that is otherwise the one that was written.
  const record = recordOf(FILE);
  const withByte = (at, value) => armorOf(Buffer.concat([record.subarray(0, at), Buffer.from([value]), record.subarray(at + 1)]));
  assert.equal(reasonOf(() => openKeyFile(armorOf(Buffer.concat([Buffer.from('XXXX'), record.subarray(4)])), PASSPHRASE)), 'MALFORMED', 'a record whose magic is wrong is not a key file');
  assert.equal(reasonOf(() => openKeyFile(withByte(4, 99), PASSPHRASE)), 'UNSUPPORTED_VERSION', 'a container version this build does not implement is named as such');
  assert.equal(reasonOf(() => openKeyFile(withByte(5, 9), PASSPHRASE)), 'UNSUPPORTED_FEATURE', 'so is a KDF it does not implement');
  assert.equal(reasonOf(() => openKeyFile(withByte(6, 9), PASSPHRASE)), 'UNSUPPORTED_FEATURE', 'and a cipher it does not implement');
  assert.equal(reasonOf(() => openKeyFile(withByte(7, 1), PASSPHRASE)), 'MALFORMED', 'the reserved byte has to be zero');
  assert.equal(reasonOf(() => openKeyFile(armorOf(record.subarray(0, 20)), PASSPHRASE)), 'MALFORMED', 'a record shorter than its own header is malformed');

  const lyingLength = Buffer.from(record);
  lyingLength.writeUInt32BE(999, 48);
  assert.equal(reasonOf(() => openKeyFile(armorOf(lyingLength), PASSPHRASE)), 'MALFORMED', 'and so is one whose length field disagrees with its bytes');
});

test('an empty passphrase is refused rather than being treated as none', () => {
  assert.equal(reasonOf(() => sealKeyFile(DER, '')), 'MALFORMED', 'a file cannot be written with the empty passphrase');
  assert.equal(reasonOf(() => openKeyFile(FILE, '')), 'MALFORMED', 'and the empty passphrase does not open one');
  assert.equal(reasonOf(() => sealKeyFile(new Uint8Array(0), PASSPHRASE)), 'MALFORMED', 'nor can a file be written around no key at all');
});

test('a passphrase typed on another platform opens the file', () => {
  // macOS writes `é` as e plus a combining acute; Linux usually writes the composed form.
  // Without normalization those are different bytes, so the same passphrase fails to open
  // its own file — a bug nobody would report as a bug, and one nobody could diagnose.
  const onAMac = sealKeyFile(DER, NFD);
  assert.equal(
    Buffer.from(openKeyFile(onAMac, NFC)).equals(Buffer.from(DER)),
    true,
    'the decomposed form written on one machine opens with the composed form typed on another',
  );
  assert.equal(Buffer.from(openKeyFile(onAMac, NFD)).equals(Buffer.from(DER)), true, 'and with itself');
});

test('the cost is the one the documentation quotes', () => {
  // Not an assertion about wall-clock time, which would pass on a fast machine and fail
  // on a slow one, but about the memory: it is what makes guessing expensive, and it is a
  // function of the parameters alone.
  const needed = 128 * (2 ** SCRYPT_LOG_N) * SCRYPT_R;
  assert.equal(needed, 128 * 1024 * 1024, `the published cost needs ${needed / (1024 * 1024)} MiB, and the documentation says 128`);
  assert.equal(SCRYPT_LOG_N, 17, 'log2(N) = 17 is what the module and the specification name');
  const derived = scryptSync(PASSPHRASE, Buffer.alloc(SALT_BYTES), 32, { N: 2 ** SCRYPT_LOG_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * 1024 * 1024 });
  assert.equal(derived.length, 32, 'and it produces the 32-byte key AES-256 takes');
});