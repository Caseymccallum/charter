/**
 * The container corpus's record, replayed through the test runner.
 *
 * `vectors/container/run.js` is the program a reader runs: it asks the reference
 * and the Python implementation and compares both with the record. This is the
 * reference's half of the same replay through `node --test`, so that `npm test`
 * covers the corpus without needing a second language installed, plus the
 * properties that only make sense when every case is examined at once: the record
 * must still describe the bytes on disk, each case must still be one mutation of
 * the accepted artifact, and a case the record holds as an agreement must carry
 * the same answer for both implementations.
 *
 * @module test/corpus
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
const CORPUS = join(HERE, '..', 'vectors', 'container');
const RECORD = JSON.parse(readFileSync(join(CORPUS, 'expected.json'), 'utf8'));

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

test('the corpus record still describes the artifacts on disk', () => {
  assert.ok(RECORD.cases.length >= 26, `expected the corpus's cases, found ${RECORD.cases.length}`);
  const base = new Uint8Array(readFileSync(join(CORPUS, RECORD.base.file)));
  assert.equal(base.length, RECORD.base.bytes, 'the base artifact is not the length the record claims');
  assert.equal(sha256Hex(base), RECORD.base.sha256, 'the base artifact is not the one the corpus was built from');
  for (const entry of RECORD.cases) {
    const bytes = new Uint8Array(readFileSync(join(CORPUS, entry.file)));
    assert.equal(bytes.length, entry.bytes, `${entry.name}: the file is not the length the record claims`);
    assert.equal(sha256Hex(bytes), entry.sha256, `${entry.name}: the file is not the file the record claims`);
    assert.notEqual(sha256Hex(bytes), RECORD.base.sha256, `${entry.name}: a case that mutates nothing is not a mutation`);
  }
});

test('every recorded corpus answer is the answer the reference gives', async () => {
  for (const entry of RECORD.cases) {
    const bytes = new Uint8Array(readFileSync(join(CORPUS, entry.file)));
    const seen = tally(await verify(bytes));
    assert.equal(seen.verdict, entry.expected.verdict, `${entry.name}: verdict`);
    assert.equal(seen.exit_code, entry.expected.exit_code, `${entry.name}: exit code`);
    assert.deepEqual(seen.fail, entry.expected.fail, `${entry.name}: failing checks`);
    assert.deepEqual(seen.unsupported, entry.expected.unsupported, `${entry.name}: unsupported checks`);
    assert.equal(seen.skips, entry.expected.skips, `${entry.name}: checks not reached`);

    // The question the case asks must hold of the answer too: a corpus whose
    // recorded answer does not carry the defect it was built to ask about is a
    // fixture that drifted, and the builder refuses to write one — this makes
    // sure a hand-edited record cannot hide one either.
    if (entry.asked !== null) {
      assert.equal(entry.asked.verdict, entry.expected.verdict, `${entry.name}: the record asks for one verdict and states another`);
      for (const [id, code] of Object.entries(entry.asked.fail ?? {})) {
        assert.equal(entry.expected.fail[id], code, `${entry.name}: the record asks for ${id}=${code} and does not carry it`);
      }
      for (const [id, code] of Object.entries(entry.asked.unsupported ?? {})) {
        assert.equal(entry.expected.unsupported[id], code, `${entry.name}: the record asks for ${id}=${code} and does not carry it`);
      }
      for (const id of entry.asked.pass ?? []) {
        assert.equal(entry.expected.fail[id], undefined, `${entry.name}: the record asks for ${id} to pass and it fails`);
      }
    }
  }
});

test('the corpus mutates one thing at a time, and says which', () => {
  /** @type {Set<string>} */
  const names = new Set();
  /** @type {Set<string>} */
  const digests = new Set();
  for (const entry of RECORD.cases) {
    assert.equal(names.has(entry.name), false, `${entry.name}: two cases share a name`);
    names.add(entry.name);
    assert.equal(digests.has(entry.sha256), false, `${entry.name}: two cases hold the same artifact`);
    digests.add(entry.sha256);
    assert.ok(typeof entry.mutation === 'string' && entry.mutation.length > 40, `${entry.name}: a case must say what it changed`);
    assert.ok(typeof entry.question === 'string' && entry.question.length > 40, `${entry.name}: a case must say what it asks`);
    assert.ok(entry.spec === null || /^3\.\d$/.test(entry.spec), `${entry.name}: the section a case names is a section of 3`);
    assert.ok(typeof entry.note === 'string' && entry.note.length > 40, `${entry.name}: a case must say how it was settled`);
    assert.ok(Object.values(VERDICT).includes(entry.expected.verdict), `${entry.name}: ${entry.expected.verdict} is not a verdict`);
    for (const code of [...Object.values(entry.expected.fail), ...Object.values(entry.asked?.fail ?? {})]) {
      assert.ok(Object.values(REASON).includes(code), `${entry.name}: ${code} is not a reason code`);
    }
  }
  const onDisk = readdirSync(join(CORPUS, 'out')).filter((name) => name.endsWith('.charter')).sort();
  assert.deepEqual(onDisk, [...names].sort().map((name) => `${name}.charter`), 'the directory holds exactly the cases the record names');
});


test('a case the record holds as an agreement carries one answer, and a finding carries two', () => {
  let agreed = 0;
  /** @type {string[]} */
  const findings = [];
  for (const entry of RECORD.cases) {
    const same =
      entry.expected.verdict === entry.port.verdict &&
      entry.expected.exit_code === entry.port.exit_code &&
      entry.expected.skips === entry.port.skips &&
      JSON.stringify(entry.expected.fail) === JSON.stringify(entry.port.fail) &&
      JSON.stringify(entry.expected.unsupported) === JSON.stringify(entry.port.unsupported);
    assert.equal(
      entry.agreement,
      same,
      `${entry.name}: the record says the two implementations ${entry.agreement ? 'agree' : 'disagree'}, and its two answers say otherwise`,
    );
    if (same) agreed += 1;
    else {
      findings.push(entry.name);
      assert.ok(
        typeof entry.note === 'string' && /settle|disagree/i.test(entry.note),
        `${entry.name}: a recorded disagreement has to say which implementation moved`,
      );
    }
  }
  // The corpus is a finding tool, and a finding it holds is reported rather than
  // enforced — but a *new* disagreement is a failure here, because the record no
  // longer describes what the two implementations do.
  assert.equal(
    findings.length + agreed,
    RECORD.cases.length,
    'every case is either an agreement or a recorded finding',
  );
  assert.equal(
    agreed,
    RECORD.cases.length,
    `the corpus was built with every disagreement settled, and these are not: ${findings.join(', ')}`,
  );
});

test('the record says where its answers came from', () => {
  assert.equal(RECORD.format, 'charter/0.1');
  assert.ok(RECORD.built_by.includes('corpus.py'), 'the record names the program that wrote it');
  assert.ok(RECORD.note.includes('two implementations'), 'and says whose answers it holds');
  assert.ok(readFileSync(join(CORPUS, 'README.md'), 'utf8').includes('run.js'), 'the corpus is documented, and the documentation says how to re-run it');
});

