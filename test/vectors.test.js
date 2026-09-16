/**
 * The conformance kit, replayed against the verifier.
 *
 * `vectors/run.js` is the reader's program. This is the same replay through the
 * test runner, plus the properties that only make sense when every case is
 * examined at once: the record must still describe the bytes on disk, and no
 * single-byte change to the one artifact the format is designed to accept may
 * come back VERIFIED.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verify } from '../verifier/verify.js';
import { CHECK_IDS, REASON, STATUS, VERDICT } from '../verifier/status.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, '..', 'vectors');
const RECORD = JSON.parse(readFileSync(join(KIT, 'expected.json'), 'utf8'));

/**
 * @param {string} name a case name from the record
 * @returns {{ case: any, bytes: Uint8Array }}
 */
function load(name) {
  const found = RECORD.cases.find((entry) => entry.name === name);
  assert.ok(found !== undefined, `the record names a case ${name}`);
  return { case: found, bytes: new Uint8Array(readFileSync(join(KIT, found.file))) };
}

/**
 * @param {import('../verifier/status.js').CheckResult[]} checks
 */
function tally(checks) {
  /** @type {Record<string, string>} */
  const fail = {};
  /** @type {Record<string, string>} */
  const unsupported = {};
  let skips = 0;
  for (const check of checks) {
    if (check.status === STATUS.FAIL) fail[check.id] = check.reason_code;
    else if (check.status === STATUS.UNSUPPORTED) unsupported[check.id] = check.reason_code;
    else if (check.status === STATUS.SKIP) skips += 1;
  }
  return { fail, unsupported, skips };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('the record still describes the artifacts on disk', () => {
  for (const entry of RECORD.cases) {
    const bytes = new Uint8Array(readFileSync(join(KIT, entry.file)));
    assert.equal(bytes.length, entry.bytes, `${entry.name}: the file is not the length the record claims`);
    assert.equal(sha256Hex(bytes), entry.sha256, `${entry.name}: the file is not the file the record claims`);
  }
});

test('every recorded verdict is reproduced exactly', async () => {
  for (const entry of RECORD.cases) {
    const { bytes } = load(entry.name);
    const result = await verify(bytes);
    assert.equal(result.verdict, entry.expected.verdict, `${entry.name}: verdict`);
    assert.equal(result.exit_code, entry.expected.exit_code, `${entry.name}: exit code`);
    const seen = tally(result.checks);
    assert.deepEqual(seen.fail, entry.expected.fail, `${entry.name}: failing checks`);
    assert.deepEqual(seen.unsupported, entry.expected.unsupported, `${entry.name}: unsupported checks`);
    assert.equal(seen.skips, entry.expected.skips, `${entry.name}: checks not reached`);
  }
});

test('every verdict carries every check exactly once, in registry order', async () => {
  for (const entry of RECORD.cases) {
    const { bytes } = load(entry.name);
    const result = await verify(bytes);
    assert.deepEqual(
      result.checks.map((check) => check.id),
      [...CHECK_IDS],
      `${entry.name}: the checks reported are the registered checks`,
    );
    for (const check of result.checks) {
      assert.ok(check.detail.length > 0, `${entry.name}/${check.id}: a check must say something`);
      assert.ok(Object.values(STATUS).includes(check.status));
      assert.ok(Object.values(REASON).includes(check.reason_code));
    }
    assert.ok(result.limitations.length > 0, 'the boundary of the claim travels with the verdict');
  }
});

test('the kit exercises every verdict and every way of not passing', () => {
  const verdicts = new Set(RECORD.cases.map((entry) => entry.expected.verdict));
  for (const verdict of Object.values(VERDICT)) {
    assert.ok(verdicts.has(verdict), `no case produces ${verdict}`);
  }
  const codes = new Set();
  for (const entry of RECORD.cases) {
    for (const code of Object.values(entry.expected.unsupported)) codes.add(code);
    for (const code of Object.values(entry.expected.fail)) codes.add(code);
  }
  assert.ok(codes.has(REASON.UNSUPPORTED_VERSION), 'a format version this verifier does not implement is covered');
  assert.ok(codes.has(REASON.UNSUPPORTED_FEATURE), 'a container feature this verifier does not implement is covered');
});

test('the one accepted artifact is accepted with no skipped check', async () => {
  for (const name of ['valid', 'valid-deflate']) {
    const { bytes, case: entry } = load(name);
    const result = await verify(bytes);
    assert.equal(result.verdict, VERDICT.VERIFIED, `${name}`);
    assert.equal(result.summary.pass, CHECK_IDS.length, `${name}: every check passed`);
    assert.equal(result.summary.skip + result.summary.unsupported + result.summary.fail, 0, `${name}: nothing was left unproven`);
    assert.equal(entry.expected.skips, 0);
  }
});

test('stored and deflated artifacts of the same document verify the same way', async () => {
  const stored = await verify(load('valid').bytes);
  const deflated = await verify(load('valid-deflate').bytes);
  assert.equal(stored.verdict, deflated.verdict);
  assert.equal(stored.artifact.head_content_sha256, deflated.artifact.head_content_sha256);
  assert.deepEqual(
    stored.checks.map((check) => check.status),
    deflated.checks.map((check) => check.status),
  );
});

test('no single changed byte of the accepted artifact is accepted', async () => {
  const original = load('valid').bytes;
  /** @type {string[]} */
  const accepted = [];
  for (let at = 0; at < original.length; at += 1) {
    const forged = original.slice();
    forged[at] ^= 0x01;
    const result = await verify(forged);
    if (result.verdict === VERDICT.VERIFIED) accepted.push(`byte ${at}`);
  }
  assert.deepEqual(accepted, [], `a changed byte was accepted as VERIFIED: ${accepted.join(', ')}`);
});

test('a truncated artifact is refused, not read as far as it goes', async () => {
  const original = load('valid').bytes;
  for (const length of [0, 1, 30, 100, Math.floor(original.length / 2), original.length - 1]) {
    const result = await verify(original.subarray(0, length));
    assert.notEqual(result.verdict, VERDICT.VERIFIED, `a file of ${length} byte(s) was accepted`);
    assert.ok(result.summary.fail + result.summary.unsupported > 0, `a file of ${length} byte(s) produced no finding`);
  }
});
