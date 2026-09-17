/**
 * The one promise this project makes about a runtime it is not running on.
 *
 * SPEC.md section 12 and the README both say what happens when the runtime is
 * older than the floor: a check that cannot be performed is reported UNSUPPORTED
 * with reason `UNSUPPORTED_FEATURE`, the verdict is INCOMPLETE, and INCOMPLETE is
 * not a pass. The branch that does it is in `verifier/zip.js`, and on any machine
 * that can run this test it is unreachable — `DecompressionStream('deflate-raw')`
 * is exactly what the floor is for. So the branch is reached here by taking the
 * facility away for the length of one call, which is the only way to turn that
 * sentence into something a run has checked.
 *
 * The second test is the sharper half of the promise: the facility is per check,
 * not per artifact. An artifact whose entries are stored has no deflated entry to
 * expand, and it must still verify on a runtime without the facility — a verifier
 * that gave up on the whole file would be reporting its own limits as the file's.
 *
 * The facility is put back in a `finally`, and the last test checks that it is
 * there again, because a test that damaged the runtime for the rest of the run
 * would be worse than the branch it was written for.
 *
 * When this file was written, the first test below passed and the second one did
 * not: the branch reported `UNSUPPORTED_FEATURE` with the status `FAIL`, so a
 * runtime without the facility turned a check the reader could not do into a
 * verdict about the file (`BROKEN`, exit 2) where section 12 promises `INCOMPLETE`
 * and exit 1. The second test is the promise as an assertion, and the status in
 * `verifier/zip.js` now follows the reason code rather than the call.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REASON } from '../verifier/status.js';
import { verify } from '../verifier/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'vectors', 'out');

/**
 * @param {string} name
 * @returns {Uint8Array}
 */
function fixture(name) {
  return new Uint8Array(readFileSync(join(OUT, `${name}.charter`)));
}

/**
 * Run `work` with the runtime's deflate facility absent, and put it back.
 *
 * `delete` is the honest way to model an older runtime here: a stub that threw on
 * construction would be a second implementation of the feature's absence, and the
 * code's own `try`/`catch` is what the test is about.
 *
 * @template T
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withoutDeflate(work) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'DecompressionStream');
  assert.ok(saved !== undefined, 'this runtime has no DecompressionStream, so there is nothing to take away');
  delete globalThis.DecompressionStream;
  try {
    return await work();
  } finally {
    Object.defineProperty(globalThis, 'DecompressionStream', saved);
  }
}

test('without the runtime facility deflate needs, the branch is reached, nothing throws, and nothing unproven is passed', async () => {
  const result = await withoutDeflate(() => verify(fixture('valid-deflate')));

  // The branch reports the reason code the vocabulary reserves for a reader that
  // cannot do part of its job, and that much is true of it either way.
  const entry = result.checks.find((check) => check.id === 'L0.ZIP.ENTRY_DATA');
  assert.equal(entry.reason_code, REASON.UNSUPPORTED_FEATURE);

  // The checks that needed those bytes are unproven, not passed.
  for (const id of ['L0.ZIP.SIZES', 'L0.CONTENT.UTF8', 'L0.CONTENT.HASH', 'L1.PROVENANCE.SIGNATURES']) {
    const check = result.checks.find((one) => one.id === id);
    assert.equal(check.status, 'SKIP', `${id} reads the entry's bytes, so it cannot have run`);
    assert.equal(check.reason_code, REASON.PREREQUISITE_FAILED);
  }

  // And no check that never ran was reported as a pass.
  assert.equal(result.checks.some((check) => check.status === 'PASS' && check.id.startsWith('L1.')), false);
});

test('the promise section 12 makes about that branch: a check that cannot run is UNSUPPORTED, and the verdict is INCOMPLETE', async () => {
  const result = await withoutDeflate(() => verify(fixture('valid-deflate')));

  assert.equal(result.verdict, 'INCOMPLETE', 'a requirement that could not be established is not a pass');
  assert.equal(result.exit_code, 1, 'INCOMPLETE is exit 1, and never 0');

  const entry = result.checks.find((check) => check.id === 'L0.ZIP.ENTRY_DATA');
  assert.equal(entry.status, 'UNSUPPORTED', 'the check that reads the bytes is the one that cannot run');
  assert.equal(entry.reason_code, REASON.UNSUPPORTED_FEATURE);

  const failed = result.checks.filter((check) => check.status === 'FAIL');
  assert.deepEqual(failed.map((check) => `${check.id}:${check.reason_code}`), [], 'nothing about the file failed; the reader could not do part of its job');
});

test('a stored artifact still verifies without that facility', async () => {
  const result = await withoutDeflate(() => verify(fixture('valid')));
  assert.equal(result.verdict, 'VERIFIED', 'no entry is deflated, so there is nothing this runtime cannot do');
  assert.equal(result.exit_code, 0);
});

test('the facility is back afterwards, and the deflated artifact verifies again', async () => {
  assert.equal(typeof globalThis.DecompressionStream, 'function');
  const result = await verify(fixture('valid-deflate'));
  assert.equal(result.verdict, 'VERIFIED');
});

