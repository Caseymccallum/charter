/**
 * The differential probe's record, replayed through the test runner.
 *
 * `vectors/probe/run.js` is the program a reader runs: it asks the reference and
 * the Python implementation and compares both with the record. This is the same
 * replay through `node --test`, so that `npm test` covers the probe without
 * needing a second language installed, plus the properties that only make sense
 * when every case is examined at once: the record must still describe the bytes
 * on disk, the fixtures must not repeat each other, and the answers the record
 * carries must still be the answers the format gives.
 *
 * @module test/probe
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REASON, VERDICT } from '../verifier/status.js';
import { verify } from '../verifier/verify.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, '..', 'vectors', 'probe');
const RECORD = JSON.parse(readFileSync(join(PROBE, 'expected.json'), 'utf8'));

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The five things a verdict is compared by, as the record states them.
 *
 * @param {object} result
 * @returns {object}
 */
function tally(result) {
  /** @type {Record<string, string>} */
  const fail = {};
  /** @type {Record<string, string>} */
  const unsupported = {};
  let skips = 0;
  for (const check of result.checks) {
    if (check.status === 'FAIL') fail[check.id] = check.reason_code;
    else if (check.status === 'UNSUPPORTED') unsupported[check.id] = check.reason_code;
    else if (check.status === 'SKIP') skips += 1;
  }
  return { verdict: result.verdict, exit_code: result.exit_code, fail, unsupported, skips };
}

test('the probe record still describes the artifacts on disk', () => {
  assert.ok(RECORD.cases.length >= 20, `expected the probe's cases, found ${RECORD.cases.length}`);
  for (const entry of RECORD.cases) {
    const bytes = new Uint8Array(readFileSync(join(PROBE, entry.file)));
    assert.equal(bytes.length, entry.bytes, `${entry.name}: the file is not the length the record claims`);
    assert.equal(sha256Hex(bytes), entry.sha256, `${entry.name}: the file is not the file the record claims`);
  }
});

test('every recorded probe answer is the answer the format gives', async () => {
  for (const entry of RECORD.cases) {
    const bytes = new Uint8Array(readFileSync(join(PROBE, entry.file)));
    const seen = tally(await verify(bytes));
    assert.equal(seen.verdict, entry.expected.verdict, `${entry.name}: verdict`);
    assert.equal(seen.exit_code, entry.expected.exit_code, `${entry.name}: exit code`);
    assert.deepEqual(seen.fail, entry.expected.fail, `${entry.name}: failing checks`);
    assert.deepEqual(seen.unsupported, entry.expected.unsupported, `${entry.name}: unsupported checks`);
    assert.equal(seen.skips, entry.expected.skips, `${entry.name}: checks not reached`);

    // The question the case asks must hold of the answer too: a probe whose
    // recorded answer does not carry the defect it was built to ask about is a
    // fixture that drifted, and the builder refuses to write one — this makes
    // sure a hand-edited record cannot hide one either.
    assert.equal(entry.asked.verdict, entry.expected.verdict, `${entry.name}: the record asks for one verdict and states another`);
    for (const [id, code] of Object.entries(entry.asked.fail ?? {})) {
      assert.equal(entry.expected.fail[id], code, `${entry.name}: the record asks for ${id}=${code} and does not carry it`);
    }
  }
});

test('the probe asks what the kit does not, and asks it once', () => {
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {Set<string>} */
  const digests = new Set();
  for (const entry of RECORD.cases) {
    assert.equal(names.has(entry.name), false, `${entry.name}: two cases share a name`);
    names.add(entry.name);
    assert.equal(digests.has(entry.sha256), false, `${entry.name}: two cases hold the same artifact`);
    digests.add(entry.sha256);
    assert.ok(typeof entry.probe === 'string' && entry.probe.length > 40, `${entry.name}: a case must say what it asks`);
    assert.ok(Object.values(VERDICT).includes(entry.asked.verdict), `${entry.name}: ${entry.asked.verdict} is not a verdict`);
    for (const code of Object.values(entry.asked.fail ?? {})) {
      assert.ok(Object.values(REASON).includes(code), `${entry.name}: ${code} is not a reason code`);
    }
  }
  const onDisk = readdirSync(join(PROBE, 'out')).filter((name) => name.endsWith('.charter')).sort();
  assert.deepEqual(onDisk, [...names].sort().map((name) => `${name}.charter`), 'the directory holds exactly the cases the record names');
});

test('the record says where its answers came from', () => {
  assert.equal(RECORD.format, 'charter/0.1');
  assert.ok(RECORD.built_by.includes('probe.py'), 'the record names the program that wrote it');
  assert.ok(RECORD.note.includes('black box'), 'and says how those answers were taken: by running the reference, not by reading it');
  assert.ok(readFileSync(join(PROBE, 'README.md'), 'utf8').includes('run.js'), 'the probe is documented, and the documentation says how to re-run it');
});
